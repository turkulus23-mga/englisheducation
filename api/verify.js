import { createClient } from 'redis';

export default async function handler(req, res) {
    // CORS Ayarları
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Yalnızca POST istekleri kabul edilir.' });
    }

    // REDIS_URL Kontrolü
    if (!process.env.REDIS_URL) {
        return res.status(500).json({ error: 'Sunucu hatası: REDIS_URL tanımlanmamış!' });
    }

    const client = createClient({ url: process.env.REDIS_URL });
    
    try {
        await client.connect();
        const { action, code, token } = req.body;

        // 1. TOPLU KOD YÜKLEME MOTORU (IŞIK HIZI VERSİYONU)
        if (action === 'toplu_yukle') {
            if (code !== 'admin123') {
                return res.status(403).json({ error: 'Yetkisiz erişim!' });
            }

            const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
            const promises = [];

            // 1500 kodu hafızada hazırlayıp tek seferde (Parallel Promises) Redis'e fırlatıyoruz
            for (const lvl of levels) {
                for (let i = 1; i <= 300; i++) {
                    const pad = String(i).padStart(3, '0');
                    const generatedCode = `ENG-${lvl}-${pad}`; // Örn: ENG-A1-005
                    
                    // Veritabanına "kullanılmadı" olarak ekleme isteğini listeye koy
                    promises.push(client.set(`code:${generatedCode}`, JSON.stringify({
                        level: lvl,
                        used: false,
                        usedAt: null
                    })));
                }
            }

            // Tüm istekleri aynı anda çalıştır (Maksimum 2 saniye sürer)
            await Promise.all(promises);
            await client.disconnect();

            return res.status(200).json({ success: true, message: '1500 adet kod başarıyla jet hızıyla veritabanına yüklendi!' });
        }

        // 2. KOD KONTROL ET / AKTİFLEŞTİR
        if (action === 'kontrol_et') {
            const cleanCode = String(code || '').trim().toUpperCase();
            const dataRaw = await client.get(`code:${cleanCode}`);

            if (!dataRaw) {
                await client.disconnect();
                return res.status(400).json({ success: false, error: 'Geçersiz veya hatalı kod girdiniz!' });
            }

            const codeData = JSON.parse(dataRaw);

            if (codeData.used) {
                await client.disconnect();
                return res.status(400).json({ success: false, error: 'Bu kod daha önce başka bir cihazda kullanılmış!' });
            }

            // Kodu kullanıldı olarak işaretle ve cihaza özel token üret
            codeData.used = true;
            codeData.usedAt = new Date().toISOString();
            const userToken = `token_${Math.random().toString(36).substring(2)}_${Date.now()}`;
            codeData.token = userToken;

            // Güncel veriyi kaydet, token'ı da cihaza bağla
            await client.set(`code:${cleanCode}`, JSON.stringify(codeData));
            await client.set(`token:${userToken}`, codeData.level);
            await client.disconnect();

            return res.status(200).json({ success: true, token: userToken, level: codeData.level });
        }

        // 3. ONAYLI TOKEN DOĞRULAMA
        if (action === 'token_dogrula') {
            const level = await client.get(`token:${token}`);
            await client.disconnect();

            if (level) {
                return res.status(200).json({ success: true, level: level });
            } else {
                return res.status(400).json({ success: false, error: 'Oturum süresi dolmuş veya geçersiz cihaz!' });
            }
        }

        await client.disconnect();
        return res.status(400).json({ error: 'Geçersiz işlem (action) bildirildi.' });

    } catch (err) {
        try { await client.disconnect(); } catch(e){}
        return res.status(500).json({ error: 'Veritabanı bağlantı hatası: ' + err.message });
    }
}
