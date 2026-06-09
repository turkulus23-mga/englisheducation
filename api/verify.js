import { createClient } from 'redis';

let redisClient = null;
async function getRedis() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
  }
  return redisClient;
}

function generateCryptoSuffix() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return res.status(405).send('Method not allowed');
    }

    const action = req.body?.action || req.query?.admin; 
    const code = req.body?.code || req.query?.kod;
    const token = req.body?.token || req.query?.token;
    const targetLevel = (req.body?.level || req.query?.seviye || '').toUpperCase();

    const redis = await getRedis();

    // ================= 1. PARÇA PARÇA YÜKLEME =================
    if (action === 'yukle' || action === 'toplu_yukle') {
      const validLevels = ['A1', 'A2', 'B1', 'B2', 'C1'];
      if (!validLevels.includes(targetLevel)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send('<h1>❌ HATA: Lutfen gecerli bir seviye belirtin! (A1, A2, B1, B2, C1)</h1>');
      }

      await redis.del(`sistem:kodlar:${targetLevel}`);

      const multi = redis.multi();
      for (let i = 1; i <= 300; i++) {
        const cryptoPart = generateCryptoSuffix();
        const siraNo = String(i).padStart(3, '0');
        const yeniKriptoKod = `ENG-${targetLevel}-${cryptoPart}-${siraNo}`;

        multi.set(`code:${yeniKriptoKod}`, targetLevel);
        multi.sAdd(`sistem:kodlar:${targetLevel}`, yeniKriptoKod);
      }
      await multi.exec();

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`<h1>✅ BASARILI: ${targetLevel} seviyesi icin 300 adet yeni kripto kod yuklendi!</h1>`);
    }

    // ================= 2. PARÇA PARÇA CSV İNDİRME =================
    if (action === 'indir' || action === 'kodlari_indir') {
      if (!targetLevel) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send('<h1>❌ HATA: Hangi seviyeyi indireceginizi belirtmediniz!</h1>');
      }

      const kodlar = await redis.sMembers(`sistem:kodlar:${targetLevel}`);
      if (!kodlar || kodlar.length === 0) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(`<h1>❌ HATA: ${targetLevel} seviyesine ait kod bulunamadi. Once yukleme yapin!</h1>`);
      }

      kodlar.sort((a, b) => a.localeCompare(b));

      // Excel Türkçe karakterleri doğru görsün diye BOM ekliyoruz
      let csvContent = '\uFEFFSeviye,Aktivasyon Kodu,QR Linki\n';
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'englisheducation-five.vercel.app';
      const siteUrl = `${protocol}://${host}`;

      kodlar.forEach(kod => {
        csvContent += `${targetLevel},${kod},${siteUrl}/?kod=${kod}\n`;
      });

      // Tarayıcının ERR_INVALID_RESPONSE vermemesi için içeriği Buffer'a çeviriyoruz
      const csvBuffer = Buffer.from(csvContent, 'utf-8');

      // Doğru HTTP başlıkları (İngilizce karakterlerle)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=ingilizce_defteri_${targetLevel}_kodlar.csv`);
      res.setHeader('Content-Length', csvBuffer.length);
      
      // Yanıtı gönderiyoruz
      return res.status(200).end(csvBuffer);
    }

    // ================= 3. ÖĞRENCİ GİRİŞ KONTROLÜ =================
    if (action === 'kontrol_et') {
      if (!code) return res.status(400).json({ error: 'Kod eksik' });
      const temizKod = code.trim().toUpperCase();
      const onaylananSeviye = await redis.get(`code:${temizKod}`);

      if (onaylananSeviye) {
        const rastgeleToken = 'TOKEN_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        await redis.set(`token:${rastgeleToken}`, onaylananSeviye, { EX: 60 * 60 * 24 * 365 });
        return res.status(200).json({ success: true, token: rastgeleToken, level: onaylananSeviye });
      } else {
        return res.status(400).json({ error: 'Gecersiz aktivasyon kodu!' });
      }
    }

    // ================= 4. CİHAZ TOKEN DOĞRULAMA =================
    if (action === 'token_dogrula') {
      if (!token) return res.status(400).json({ error: 'Token eksik' });
      const seviye = await redis.get(`token:${token}`);
      if (seviye) {
        return res.status(200).json({ success: true, level: seviye });
      } else {
        return res.status(400).json({ error: 'Oturum gecersiz' });
      }
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send('<h1>ℹ️ Sistem Aktif.</h1>');

  } catch (error) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<h1>❌ Sunucu Hatasi: ${error.message}</h1>`);
  }
}
