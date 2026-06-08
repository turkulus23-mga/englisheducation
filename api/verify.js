import { createClient } from 'redis';

const client = createClient({
  url: process.env.REDIS_URL
});

client.on('error', err => console.log('Redis Client Error', err));

export default async function handler(req, res) {
  // CORS ayarları (Düz HTML sitemizin bu API ile konuşabilmesi için)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Yalnızca POST istekleri desteklenir.' });
  }

  try {
    if (!client.isOpen) await client.connect();
    
    const { action, code } = req.body;

    // --- TOPLU KOD YÜKLEME ---
    if (action === "toplu_yukle") {
      const levels = { "A1": 200, "A2": 300, "B1": 400, "B2": 500, "C1": 100 };
      for (const [level, count] of Object.entries(levels)) {
        for (let i = 1; i <= count; i++) {
          const formattedId = String(i).padStart(3, '0');
          const activationCode = `ENG-${level}-${formattedId}`;
          
          // Eğer kod veritabanında yoksa "aktif" olarak ekle (Eski yüklenenleri ezmez)
          const exists = await client.get(activationCode);
          if (!exists) {
            await client.set(activationCode, "aktif");
          }
        }
      }
      return res.status(200).json({ success: true, message: "Kodlar güvenli kasaya kilitlendi!" });
    }

    // --- KOD KONTROL ETME ---
    if (action === "kontrol_et") {
      if (!code) return res.status(400).json({ success: false, error: "Kod boş olamaz." });

      const status = await client.get(code);

      if (!status) {
        return res.status(200).json({ success: false, error: "Geçersiz veya hatalı kod!" });
      }

      if (status === "kullanildi") {
        return res.status(200).json({ success: false, error: "Bu QR kod daha önce aktifleştirilmiş!" });
      }

      if (status === "aktif") {
        // Kodu kalıcı olarak harcandı işaretle (Geçmişi silse de kurtulamaz)
        await client.set(code, "kullanildi");
        const detectedLevel = code.split('-')[1]; 
        return res.status(200).json({ success: true, level: detectedLevel });
      }
    }

    return res.status(400).json({ success: false, error: "Geçersiz işlem." });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

