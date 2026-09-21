import { createClient } from 'redis';
import crypto from 'crypto';

let redisClient = null;

// 5 Yıllık Süre (Saniye)
const FIVE_YEARS_IN_SECONDS = 60 * 60 * 24 * 365 * 5;

/**
 * Redis bağlantısını oluşturur / mevcut bağlantıyı kullanır.
 */
async function getRedis() {
  if (redisClient?.isOpen) {
    return redisClient;
  }

  const redisUrl = process.env.KV_URL || process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error('KV_URL veya REDIS_URL tanımlı değil.');
  }

  redisClient = createClient({
    url: redisUrl
  });

  redisClient.on('error', (err) => {
    console.error('Redis Hatası:', err);
  });

  await redisClient.connect();

  return redisClient;
}

/**
 * Aktivasyon kodlarını Environment Variable'dan alır.
 */
function getActivationCodes() {
  try {
    const rawData = process.env.ALL_ACTIVATION_CODES || '{}';
    return JSON.parse(rawData);
  } catch (e) {
    console.error('Env kodları parse edilemedi:', e);
    return {};
  }
}

/**
 * Cihazın ilerleme bilgisini Redis'ten getirir.
 */
async function getDeviceProgress(redis, deviceId) {
  if (!deviceId || deviceId === 'UNKNOWN_DEV') {
    return {};
  }

  const data = await redis.get(`progress:${deviceId}`);

  try {
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.error('Progress JSON parse hatası:', e);
    return {};
  }
}

/**
 * Vercel Cron isteğinin gerçekten Vercel tarafından
 * CRON_SECRET ile yetkilendirildiğini kontrol eder.
 */
function isAuthorizedCron(req) {
  const cronSecret = process.env.CRON_SECRET;

  // CRON_SECRET tanımlı değilse cron endpoint'i çalışmasın.
  if (!cronSecret) {
    console.error('CRON_SECRET environment variable tanımlı değil.');
    return false;
  }

  const authorization = req.headers.authorization;

  return authorization === `Bearer ${cronSecret}`;
}

export default async function handler(req, res) {
  // ================= CORS =================
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const action =
      req.body?.action ||
      req.query?.action ||
      req.query?.admin;

    const code =
      req.body?.code ||
      req.query?.kod;

    const token =
      req.body?.token ||
      req.query?.token;

    const deviceId =
      req.body?.deviceId ||
      req.query?.deviceId ||
      'UNKNOWN_DEV';

    // Redis bağlantısını al
    const redis = await getRedis();

    // ============================================================
    // VERCEL CRON / REDIS KEEPALIVE
    // ============================================================
    //
    // Vercel Cron:
    // /api/verify?action=ping
    //
    // Vercel, CRON_SECRET değerini Authorization:
    // Bearer <CRON_SECRET>
    // şeklinde gönderir.
    //
    // Böylece dışarıdan herkes Redis'e keepalive yazamaz.
    //
    if (
      action === 'ping' ||
      req.query?.ping === 'true'
    ) {
      if (!isAuthorizedCron(req)) {
        return res.status(401).json({
          success: false,
          error: 'Yetkisiz cron isteği.'
        });
      }

      const now = new Date().toISOString();

      await redis.set('keepalive', now);

      return res.status(200).json({
        success: true,
        message: 'Redis canlı tutuldu.',
        time: now
      });
    }

    const allCodes = getActivationCodes();

    // ============================================================
    // ÖĞRENCİ GİRİŞ / AKTİVASYON KODU KONTROLÜ
    // ============================================================
    if (action === 'kontrol_et') {
      if (!code) {
        return res.status(400).json({
          error: 'Kod eksik'
        });
      }

      const temizKod = String(code)
        .trim()
        .toUpperCase();

      const rawConfig = allCodes[temizKod];

      if (!rawConfig) {
        return res.status(400).json({
          error: 'Geçersiz aktivasyon kodu!'
        });
      }

      let onaylananSeviye = 'ALL';
      let allowedLanguages = ['en'];

      if (typeof rawConfig === 'object') {
        onaylananSeviye =
          rawConfig.level || 'ALL';

        allowedLanguages =
          Array.isArray(rawConfig.languages)
            ? rawConfig.languages
            : ['en'];
      } else {
        onaylananSeviye = rawConfig;
      }

      // Aktivasyon kodunu ilk kullanılan cihaza bağla
      const setSuccess = await redis.set(
        `used:${temizKod}`,
        deviceId,
        {
          NX: true
        }
      );

      if (!setSuccess) {
        const existingDevice =
          await redis.get(`used:${temizKod}`);

        if (existingDevice !== deviceId) {
          return res.status(400).json({
            error:
              'Bu aktivasyon kodu daha önce başka bir cihazda kullanılmış!'
          });
        }
      }

      // Token oluştur
      const tokenPayload = JSON.stringify({
        level: onaylananSeviye,
        languages: allowedLanguages,
        deviceId: deviceId
      });

      const rastgeleToken =
        'TOKEN_' +
        crypto.randomBytes(24).toString('hex');

      await redis.set(
        `token:${rastgeleToken}`,
        tokenPayload,
        {
          EX: FIVE_YEARS_IN_SECONDS
        }
      );

      // Mevcut ilerlemeyi getir
      const progress =
        await getDeviceProgress(
          redis,
          deviceId
        );

      return res.status(200).json({
        success: true,
        token: rastgeleToken,
        level: onaylananSeviye,
        languages: allowedLanguages,
        progress: progress
      });
    }

    // ============================================================
    // CİHAZ TOKEN DOĞRULAMA
    // ============================================================
    if (action === 'token_dogrula') {
      if (!token) {
        return res.status(400).json({
          error: 'Token eksik'
        });
      }

      const rawTokenData =
        await redis.get(`token:${token}`);

      if (!rawTokenData) {
        return res.status(400).json({
          error:
            'Oturum süresi dolmuş veya geçersiz!'
        });
      }

      let level = 'ALL';
      let languages = ['en'];
      let verifiedDeviceId = deviceId;

      try {
        if (rawTokenData.startsWith('{')) {
          const parsed =
            JSON.parse(rawTokenData);

          level =
            parsed.level || 'ALL';

          languages =
            Array.isArray(parsed.languages)
              ? parsed.languages
              : ['en'];

          verifiedDeviceId =
            parsed.deviceId || deviceId;
        } else {
          // Eski token formatı desteği
          level = rawTokenData;
        }
      } catch (e) {
        console.error(
          'Token JSON parse hatası:',
          e
        );
      }

      // Token kullanıldığında süresini 5 yıla kadar yenile
      await redis.expire(
        `token:${token}`,
        FIVE_YEARS_IN_SECONDS
      );

      const progress =
        await getDeviceProgress(
          redis,
          verifiedDeviceId
        );

      return res.status(200).json({
        success: true,
        level: level,
        languages: languages,
        progress: progress
      });
    }

    // ============================================================
    // İLERLEME KAYDETME
    // ============================================================
    if (action === 'indeks_kaydet') {
      if (
        !deviceId ||
        deviceId === 'UNKNOWN_DEV'
      ) {
        return res.status(400).json({
          error:
            'Geçersiz veya eksik cihaz kimliği'
        });
      }

      const {
        levelKey,
        vocabIndex,
        grammarIndex,
        matchIndex,
        correct,
        wrong
      } = req.body || {};

      if (!levelKey) {
        return res.status(400).json({
          error: 'Seviye belirtilmedi'
        });
      }

      const currentProgress =
        await getDeviceProgress(
          redis,
          deviceId
        );

      if (!currentProgress[levelKey]) {
        currentProgress[levelKey] = {};
      }

      if (vocabIndex !== undefined) {
        currentProgress[levelKey].vocabIndex =
          Number(vocabIndex);
      }

      if (grammarIndex !== undefined) {
        currentProgress[levelKey].grammarIndex =
          Number(grammarIndex);
      }

      if (matchIndex !== undefined) {
        currentProgress[levelKey].matchIndex =
          Number(matchIndex);
      }

      if (correct !== undefined) {
        currentProgress.correct =
          Number(correct);
      }

      if (wrong !== undefined) {
        currentProgress.wrong =
          Number(wrong);
      }

      await redis.set(
        `progress:${deviceId}`,
        JSON.stringify(currentProgress),
        {
          EX: FIVE_YEARS_IN_SECONDS
        }
      );

      return res.status(200).json({
        success: true
      });
    }

    // ============================================================
    // NORMAL / DEFAULT ERİŞİM
    // ============================================================
    //
    // Endpoint'e normal erişim olduğunda da Redis'e
    // gerçek bir SET işlemi yapılır.
    //
    await redis.set(
      'keepalive',
      new Date().toISOString()
    );

    res.setHeader(
      'Content-Type',
      'text/html; charset=utf-8'
    );

    return res
      .status(200)
      .send(
        '<h1>✅ AI Teacher Sistemi Çelik Gibi Aktif!</h1>'
      );

  } catch (error) {
    console.error(
      'API Hatası:',
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
