import { createClient } from 'redis';

// Serverless ortamlarda bağlantı havuzunu korumak için client'ı globalde tutuyoruz
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

export default async function handler(req, res) {
    // CORS Ayarları
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Yalnızca POST kabul edilir.' });
    if (!process.env.REDIS_URL) return res.status(500).json({ error: 'REDIS_URL tanımlanmamış!' });

    try {
        const client = await getRedisClient();
        const { action, code, token, admin_pass } = req.body;

        // GÜVENLİ ŞİFRE KONTROLÜ (Vercel Panelinden SECURE_ADMIN_PASSWORD adıyla ekleyin)
        const SECURE_ADMIN_PASS = process.env.SECURE_ADMIN_PASSWORD || 'AşırıGüvenliŞifre123!';

        // 1. TOPLU YÜKLEME
        if (action === 'toplu_yukle') {
            if (admin_pass !== SECURE_ADMIN_PASS) {
                return res.status(403).json({ error: 'Yönetici şifresi hatalı!' });
            }

            const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
            const promises = [];

            for (const lvl of levels) {
                for (let i = 1; i <= 300; i++) {
                    const pad = String(i).padStart(3, '0');
                    const generatedCode = `ENG-${lvl}-${pad}`;
                    promises.push(client.set(`code:${generatedCode}`, JSON.stringify({
                        level: lvl, used: false, usedAt: null
                    })));
                }
            }
            await Promise.all(promises);
            return res.status(200).json({ success: true, message: '1500 kod güvenle yüklendi!' });
        }

        // 2. GÜVENLİ KOD İNDİRME
        if (action === 'kodlari_indir') {
            if (admin_pass !== SECURE_ADMIN_PASS) {
                return res.status(403).json({ error: 'Yönetici şifresi hatalı! Kodlar indirilemez.' });
            }

            const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
            // UTF-8 BOM ekliyoruz ki Excel Türkçe karakterleri bozmasın
            let csvContent = "\xEF\xBB\xBFSeviye,Aktivasyon Kodu,QR Linki\n";
            const origin = req.headers.origin || `https://${req.headers.host}`;

            for (const lvl of levels) {
                for (let i = 1; i <= 300; i++) {
                    const pad = String(i).padStart(3, '0');
                    const generatedCode = `ENG-${lvl}-${pad}`;
                    const qrLink = `${origin}/?kod=${generatedCode}`;
                    csvContent += `${lvl},${generatedCode},${qrLink}\n`;
                }
            }

            // Dosyayı tarayıcıya güvenli stream olarak basıyoruz
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename=ingilizce_defteri_aktivasyon_kodlari.csv');
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

            // Değişiklikleri kaydet
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
