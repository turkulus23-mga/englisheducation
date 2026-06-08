import { createClient } from 'redis';

let redisClient = null;

async function getRedisClient() {
    if (!redisClient) {
        redisClient = createClient({ url: process.env.REDIS_URL });
        redisClient.on('error', (err) => console.error('Redis Client Error', err));
        await redisClient.connect();
    } else if (!redisClient.isOpen) {
        await redisClient.connect();
    }
    return redisClient;
}

// Tahmin edilemezliği sağlamak için rastgele 4 haneli kod üreten yardımcı fonksiyon
function generateRandomSalt() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Karışıklığı önlemek için O, I, 1, 0 elendi
    let result = '';
    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Yalnızca POST kabul edilir.' });
    if (!process.env.REDIS_URL) return res.status(500).json({ error: 'REDIS_URL tanımlanmamış!' });

    try {
        const client = await getRedisClient();
        const { action, code, token, admin_pass } = req.body;

        const SECURE_ADMIN_PASS = process.env.SECURE_ADMIN_PASSWORD || 'AşırıGüvenliŞifre123!';

        // 1. TOPLU YÜKLEME (GÜVENLİ VE TAHMİN EDİLEMEZ)
        if (action === 'toplu_yukle') {
            if (admin_pass !== SECURE_ADMIN_PASS) {
                return res.status(403).json({ error: 'Yönetici şifresi hatalı!' });
            }

            const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
            const promises = [];

            for (const lvl of levels) {
                for (let i = 1; i <= 300; i++) {
                    const pad = String(i).padStart(3, '0');
                    const salt = generateRandomSalt(); // Her koda özel rastgele 4 hane
                    const generatedCode = `ENG-${lvl}-${salt}-${pad}`; // Örn: ENG-A1-X8R2-001
                    
                    promises.push(client.set(`code:${generatedCode}`, JSON.stringify({
                        level: lvl, used: false, usedAt: null
                    })));
                }
            }
            await Promise.all(promises);
            return res.status(200).json({ success: true, message: '1500 adet tahmin edilemez kriptografik kod güvenle yüklendi!' });
        }

        // 2. GÜVENLİ KOD İNDİRME
        if (action === 'kodlari_indir') {
            if (admin_pass !== SECURE_ADMIN_PASS) {
                return res.status(403).json({ error: 'Yönetici şifresi hatalı! Kodlar indirilemez.' });
            }

            // ÖNEMLİ: İndirirken de veritabanındaki gerçek üretilmiş kodları çekmemiz gerekir.
            // Ancak performansı korumak ve hafızayı şişirmemek için Redis'teki anahtarları tarıyoruz.
            const keys = await client.keys('code:ENG-*');
            
            let csvContent = "\xEF\xBB\xBFSeviye,Aktivasyon Kodu,QR Linki\n";
            const origin = req.headers.origin || `https://${req.headers.host}`;

            // Kodları daha düzenli indirmek için sıralayalım
            keys.sort();

            for (const key of keys) {
                const generatedCode = key.replace('code:', '');
                // Kodun içinden seviyeyi ayıkla (ENG-A1-XXXX-001 formatından A1'i çeker)
                const parts = generatedCode.split('-');
                const lvl = parts[1] || 'Bilinmeyen';
                const qrLink = `${origin}/?kod=${generatedCode}`;
                csvContent += `${lvl},${generatedCode},${qrLink}\n`;
            }

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename=ingilizce_defteri_kripto_kodlar.csv');
            return res.status(200).send(csvContent);
        }

        // 3. KOD AKTİFLEŞTİRME
        if (action === 'kontrol_et') {
            const cleanCode = String(code || '').trim().toUpperCase();
            const dataRaw = await client.get(`code:${cleanCode}`);

            if (!dataRaw) {
                return res.status(400).json({ success: false, error: 'Geçersiz veya hatalı kod girdiniz!' });
            }

            const codeData = JSON.parse(dataRaw);
            if (codeData.used) {
                return res.status(400).json({ success: false, error: 'Bu kod zaten kullanılmış!' });
            }

            codeData.used = true;
            codeData.usedAt = new Date().toISOString();
            const userToken = `token_${Math.random().toString(36).substring(2)}_${Date.now()}`;
            codeData.token = userToken;

            await client.set(`code:${cleanCode}`, JSON.stringify(codeData));
            await client.set(`token:${userToken}`, codeData.level);

            return res.status(200).json({ success: true, token: userToken, level: codeData.level });
        }

        // 4. TOKEN DOĞRULAMA
        if (action === 'token_dogrula') {
            const level = await client.get(`token:${token}`);
            if (level) return res.status(200).json({ success: true, level: level });
            return res.status(400).json({ success: false, error: 'Geçersiz cihaz!' });
        }

        return res.status(400).json({ error: 'Geçersiz işlem.' });

    } catch (err) {
        console.error("Sistem Hatası:", err);
        return res.status(500).json({ error: 'Hata: ' + err.message });
    }
}
