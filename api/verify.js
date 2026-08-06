import { createClient } from 'redis';
import crypto from 'crypto';

let redisClient = null;
let cachedCodes = null;

// 5 Yıllık Süre (Saniye cinsinden: 5 * 365 * 24 * 60 * 60)
const FIVE_YEARS_IN_SECONDS = 60 * 60 * 24 * 365 * 5;

async function getRedis() {
  if (!redisClient) {
    const redisUrl = process.env.KV_URL || process.env.REDIS_URL;
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => console.error('Redis Hatası:', err));
    await redisClient.connect();
  }
  return redisClient;
}

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

async function getDeviceProgress(redis, deviceId) {
  if (!deviceId || deviceId === "UNKNOWN_DEV") return {};
  const data = await redis.get(`progress:${deviceId}`);
  try {
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const action = req.body?.action || req.query?.admin; 
    const code = req.body?.code || req.query?.kod;
    const token = req.body?.token || req.query?.token;
    const deviceId = req.body?.deviceId || "UNKNOWN_DEV";

    const allCodes = getActivationCodes();
    const redis = await getRedis();

    // ================= ÖĞRENCİ GİRİŞ KONTROLÜ =================
    if (action === 'kontrol_et') {
      if (!code) return res.status(400).json({ error: 'Kod eksik' });
      const temizKod = code.trim().toUpperCase();

      const onaylananSeviye = allCodes[temizKod];
      if (!onaylananSeviye) {
        return res.status(400).json({ error: 'Geçersiz aktivasyon kodu!' });
      }

      // KOD KİLİTLEME (RACE CONDITION ÇÖZÜMÜ)
      const setSuccess = await redis.set(`used:${temizKod}`, deviceId, { NX: true });
      
      if (!setSuccess) {
        const existingDevice = await redis.get(`used:${temizKod}`);
        if (existingDevice !== deviceId) {
          return res.status(400).json({ error: 'Bu aktivasyon kodu daha önce başka bir cihazda kullanılmış!' });
        }
      }

      // 5 YILLIK TOKEN ÜRETİMİ
      const tokenPayload = JSON.stringify({ level: onaylananSeviye, deviceId: deviceId });
      const rastgeleToken = 'TOKEN_' + crypto.randomBytes(24).toString('hex');
      await redis.set(`token:${rastgeleToken}`, tokenPayload, { EX: FIVE_YEARS_IN_SECONDS });
      
      const progress = await getDeviceProgress(redis, deviceId);

      return res.status(200).json({ success: true, token: rastgeleToken, level: onaylananSeviye, progress: progress });
    }

    // ================= CİHAZ TOKEN DOĞRULAMA =================
    if (action === 'token_dogrula') {
      if (!token) return res.status(400).json({ error: 'Token eksik' });
      const rawTokenData = await redis.get(`token:${token}`);
      
      if (rawTokenData) {
        let level = rawTokenData;
        let verifiedDeviceId = deviceId;

        try {
          if (rawTokenData.startsWith('{')) {
            const parsed = JSON.parse(rawTokenData);
            level = parsed.level;
            verifiedDeviceId = parsed.deviceId || deviceId;
          }
        } catch (e) {}

        // Her doğrulamada token süresini 5 yıl daha uzatıyoruz (Sürekli aktif kalması için)
        await redis.expire(`token:${token}`, FIVE_YEARS_IN_SECONDS);

        const progress = await getDeviceProgress(redis, verifiedDeviceId);
        return res.status(200).json({ success: true, level: level, progress: progress });
      } else {
        return res.status(400).json({ error: 'Oturum süresi dolmuş veya geçersiz!' });
      }
    }

    // ================= İLERLEME KAYDETME =================
    if (action === 'indeks_kaydet') {
      if (!deviceId || deviceId === "UNKNOWN_DEV") {
        return res.status(400).json({ error: 'Geçersiz veya eksik cihaz kimliği' });
      }

      const { levelKey, vocabIndex, grammarIndex, matchIndex, correct, wrong } = req.body;
      if (!levelKey) return res.status(400).json({ error: 'Seviye belirtilmedi' });

      const currentProgress = await getDeviceProgress(redis, deviceId);

      if (!currentProgress[levelKey]) currentProgress[levelKey] = {};
      
      if (vocabIndex !== undefined) currentProgress[levelKey].vocabIndex = Number(vocabIndex);
      if (grammarIndex !== undefined) currentProgress[levelKey].grammarIndex = Number(grammarIndex);
      if (matchIndex !== undefined) currentProgress[levelKey].matchIndex = Number(matchIndex);
      
      if (correct !== undefined) currentProgress.correct = Number(correct);
      if (wrong !== undefined) currentProgress.wrong = Number(wrong);

      // İlerleme kaydedilirken süreyi 5 yıl olarak yeniliyoruz
      await redis.set(`progress:${deviceId}`, JSON.stringify(currentProgress), { EX: FIVE_YEARS_IN_SECONDS });

      return res.status(200).json({ success: true });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send('<h1>✅ AI Teacher Sistemi Çelik Gibi Aktif!</h1>');

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
