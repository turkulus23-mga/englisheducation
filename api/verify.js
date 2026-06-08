import { createClient } from 'redis';

const client = createClient({
  url: process.env.REDIS_URL
});

export default async function handler(req, res) {
  // CORS Ayarları
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!client.isOpen) await client.connect();
    const { action, code, token } = req.body;

    // --- 1. TOPLU KOD YÜKLEME (GÜVENLİ HALE GETİRİLDİ) ---
    // Sadece siz yükleyebilin diye buraya geçici bir şifre koyduk (Örn: "admin123")
    if (action === "toplu_yukle" && code === "admin123") {
      const levels = { "A1": 200, "A2": 300, "B1": 400, "B2": 500, "C1": 100 };
      for (const [level, count] of Object.entries(levels)) {
        for (let i = 1; i <= count; i++) {
          const formattedId = String(i).padStart(3, '0');
          const activationCode = `ENG-${level}-${formattedId}`;
          const exists = await client.get(activationCode);
          if (!exists) await client.set(activationCode, "aktif");
        }
      }
      return res.status(200).json({ success: true, message: "Kodlar yüklendi!" });
    }

    // --- 2. İLK DEFA QR KOD OKUTMA VE AKTİVASYON ---
    if (action === "kontrol_et") {
      if (!code) return res.status(400).json({ success: false, error: "Kod eksik." });

      const status = await client.get(code);

      if (!status) return res.status(200).json({ success: false, error: "Geçersiz QR kod!" });
      if (status === "kullanildi") return res.status(200).json({ success: false, error: "Bu defter zaten aktifleştirilmiş!" });

      if (status === "aktif") {
        // Kodu kalıcı olarak harcandı yap
        await client.set(code, "kullanildi");
        
        const level = code.split('-')[1]; // A1, B2 vs.
        
        // Bu cihaza özel benzersiz bir bilet (Token) üretip veritabanına kaydediyoruz
        // Böylece tarayıcı geçmişini silse bile bu token yoksa içeri giremez!
        const cihazToken = "TKN-" + Math.random().toString(36).substring(2, 15) + "-" + level;
        await client.set(`auth_${cihazToken}`, level);

        return res.status(200).json({ success: true, token: cihazToken, level: level });
      }
    }

    // --- 3. UYGULAMAYA HER GİRİŞTE TOKEN KONTROLÜ ---
    // Kullanıcı geçmişi silse dahi, elindeki token veritabanında "auth_" ile kayıtlı mı diye bakılır
    if (action === "token_dogrula") {
      if (!token) return res.status(200).json({ success: false });
      
      const onayliSeviye = await client.get(`auth_${token}`);
      if (onayliSeviye) {
        return res.status(200).json({ success: true, level: onayliSeviye });
      }
      return res.status(200).json({ success: false });
    }

    return res.status(400).json({ success: false, error: "Geçersiz işlem." });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
