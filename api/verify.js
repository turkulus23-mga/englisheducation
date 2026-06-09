import { createClient } from 'redis';

let redisClient = null;
let cachedCodes = null;

// 1. Veritabanı Bağlantısı (Kullanılmış Kod Takibi İçin)
async function getRedis() {
  if (!redisClient) {
    const redisUrl = process.env.KV_URL || process.env.REDIS_URL;
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => console.error('Redis Hatası:', err));
    await redisClient.connect();
  }
  return redisClient;
}

// 2. Vercel Env İçindeki 1500 Kodu Çözme Fonksiyonu
function getActivationCodes() {
  if (!cachedCodes) {
    try {
      const rawData = process.env.ALL_ACTIVATION_CODES || '{}';
      cachedCodes = JSON.parse(rawData);
    } catch (e) {
      console.error('Env kodları parse edilemedi:', e);
      cachedCodes = {};
    }
  }
  return cachedCodes;
}

export default async function handler(req, res) {
  // CORS ve Güvenlik Ayarları
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const action = req.body?.action || req.query?.admin; 
    const code = req.body?.code || req.query?.kod;
    const token = req.body?.token || req.query?.token;

    const allCodes = getActivationCodes();
    const redis = await getRedis();

    // ================= ÖĞRENCİ GİRİŞ KONTROLÜ (🔒 TEK SEFERLİK) =================
    if (action === 'kontrol_et') {
      if (!code) return res.status(400).json({ error: 'Kod eksik' });
      const temizKod = code.trim().toUpperCase();

      // Kontrol 1: Kod Vercel Env listesinde tanımlı bir kod mu?
      const onaylananSeviye = allCodes[temizKod];
      if (!onaylananSeviye) {
        return res.status(400).json({ error: 'Geçersiz aktivasyon kodu!' });
      }

      // Kontrol 2: Bu kod daha önce veritabanında kullanıldı olarak işaretlenmiş mi?
      const isUsed = await redis.get(`used:${temizKod}`);
      if (isUsed) {
        return res.status(400).json({ error: 'Bu aktivasyon kodu daha önce başka bir cihazda kullanılmış!' });
      }

      // 🔒 KODU ÖMÜR BOYU İMHA ETME: Kodu Redis'e "kullanıldı" olarak kalıcı kaydediyoruz
      await redis.set(`used:${temizKod}`, 'true');

      // Öğrenci cihazına uygulamada kalması için 1 yıl geçerli bir token veriyoruz
      const rastgeleToken = 'TOKEN_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      await redis.set(`token:${rastgeleToken}`, onaylananSeviye, { EX: 60 * 60 * 24 * 365 });
      
      return res.status(200).json({ success: true, token: rastgeleToken, level: onaylananSeviye });
    }

    // ================= CİHAZ TOKEN DOĞRULAMA =================
    if (action === 'token_dogrula') {
      if (!token) return res.status(400).json({ error: 'Token eksik' });
      const seviye = await redis.get(`token:${token}`);
      if (seviye) {
        return res.status(200).json({ success: true, level: seviye });
      } else {
        return res.status(400).json({ error: 'Oturum süresi dolmuş veya geçersiz!' });
      }
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send('<h1>✅ AI Teacher Sistemi Çelik Gibi Aktif!</h1>');

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
