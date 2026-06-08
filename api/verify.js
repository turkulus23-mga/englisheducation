import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.REDIS_URL,
  token: process.env.REDIS_TOKEN,
});

function generateCryptoSuffix() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, code, token, admin_pass } = req.body;
  const GERCEK_ADMIN_SIFRESI = process.env.ADMIN_PASS || "MGA_Teacher_2026"; 

  // ================= 1. TOPLU YÜKLEME =================
  if (action === 'toplu_yukle') {
    if (admin_pass !== GERCEK_ADMIN_SIFRESI) {
      return res.status(401).json({ error: 'Yetkisiz erişim!' });
    }

    try {
      // Önce veritabanını temizleyelim
      await redis.flushdb();

      const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
      
      // Vercel'in 10 saniye limitine takılmamak ve Redis'i yormamak için 
      // her seviyeyi ayrı ayrı küçük pipeline'lar halinde gönderiyoruz
      for (const level of levels) {
        const pipeline = redis.pipeline();
        for (let i = 1; i <= 300; i++) {
          const cryptoPart = generateCryptoSuffix();
          const siraNo = String(i).padStart(3, '0');
          const yeniKriptoKod = `ENG-${level}-${cryptoPart}-${siraNo}`;

          // Ana doğrulamayı sakla
          pipeline.set(`code:${yeniKriptoKod}`, level);
          // CSV indirme motoru için kodu listeye ekle
          pipeline.sadd(`sistem:kodlar:${level}`, yeniKriptoKod);
        }
        await pipeline.exec(); // Her seviye bittiğinde Redis'e yaz ve rahatlat
      }

      return res.status(200).json({ success: true, message: '1500 adet kriptografik kod sunucuyu yormadan güvenle yüklendi!' });
    } catch (err) {
      return res.status(500).json({ error: 'Veritabanı hatası: ' + err.message });
    }
  }

  // ================= 2. KODLARI CSV OLARAK İNDİRME =================
  if (action === 'kodlari_indir') {
    if (admin_pass !== GERCEK_ADMIN_SIFRESI) {
      return res.status(401).json({ error: 'Yetkisiz erişim!' });
    }

    try {
      const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
      let csvContent = '\uFEFFSeviye,Aktivasyon Kodu,QR Linki\n';
      const host = req.headers['x-forwarded-proto'] + '://' + req.headers.host;

      // Her seviyedeki kodları sırayla çekip CSV'ye ekliyoruz
      for (const level of levels) {
        const kodlar = await redis.smembers(`sistem:kodlar:${level}`);
        if (kodlar && kodlar.length > 0) {
          // Kodların sonundaki sıra numarasına göre sıralı görünmesi için küçük bir sort
          kodlar.sort((a, b) => a.localeCompare(b));
          kodlar.forEach(kod => {
            csvContent += `${level},${kod},${host}/?kod=${kod}\n`;
          });
        }
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=ingilizce_defteri_kripto_kodlar.csv');
      return res.status(200).send(csvContent);
    } catch (err) {
      return res.status(500).json({ error: 'CSV oluşturma hatası: ' + err.message });
    }
  }

  // ================= 3. KOD KONTROLÜ =================
  if (action === 'kontrol_et') {
    if (!code) return res.status(400).json({ error: 'Kod eksik' });
    
    const temizKod = code.trim().toUpperCase();
    const onaylananSeviye = await redis.get(`code:${temizKod}`);

    if (onaylananSeviye) {
      const rastgeleToken = 'TOKEN_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      await redis.set(`token:${rastgeleToken}`, onaylananSeviye, { ex: 60 * 60 * 24 * 365 });
      return res.status(200).json({ success: true, token: rastgeleToken, level: onaylananSeviye });
    } else {
      return res.status(400).json({ error: 'Geçersiz veya kullanılmış aktivasyon kodu!' });
    }
  }

  // ================= 4. TOKEN DOĞRULAMA =================
  if (action === 'token_dogrula') {
    if (!token) return res.status(400).json({ error: 'Token eksik' });
    
    const seviye = await redis.get(`token:${token}`);
    if (seviye) {
      return res.status(200).json({ success: true, level: seviye });
    } else {
      return res.status(400).json({ error: 'Oturum geçersiz' });
    }
  }

  return res.status(400).json({ error: 'Geçersiz işlem' });
}
