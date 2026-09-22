import { createClient } from 'redis';

let redisClient = null;

const RATE_LIMIT_SECONDS = 60;

async function getRedis() {
  if (redisClient?.isOpen) {
    return redisClient;
  }

  const redisUrl = process.env.KV_URL || process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error('Redis bağlantı adresi tanımlı değil.');
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

export default async function handler(req, res) {
  // UptimeRobot Free HEAD kullanıyor.
  // Tarayıcı testleri için GET de kabul ediyor.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({
      success: false,
      error: 'Method Not Allowed'
    });
  }

  try {
    const redis = await getRedis();

    // Dakikada en fazla bir keepalive.
    // Gereksiz Redis SET yağmurunu önler.
    const allowed = await redis.set(
      'keepalive:rate-limit',
      '1',
      {
        NX: true,
        EX: RATE_LIMIT_SECONDS
      }
    );

    if (!allowed) {
      return res.status(429).json({
        success: false,
        error: 'Too Many Requests'
      });
    }

    const now = new Date().toISOString();

    // Redis Cloud için gerçek aktivite.
    await redis.set('keepalive', now);

    // HEAD isteğinde response body gönderilmez.
    if (req.method === 'HEAD') {
      return res.status(200).end();
    }

    // GET isteğinde JSON döndür.
    return res.status(200).json({
      success: true,
      time: now
    });

  } catch (error) {
    console.error('Keepalive Hatası:', error);

    return res.status(500).json({
      success: false,
      error: 'Keepalive başarısız.'
    });
  }
}
