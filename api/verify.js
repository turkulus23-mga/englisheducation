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
  // GÜNCELLEME: Tarayıcıdan direkt linkle girilebilsin diye GET yöntemine de izin veriyoruz
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  // İstek POST ise body'den, tarayıcı linkinden (GET) geliyorsa query'den verileri al
  const action = req.body?.action || req.query?.admin; // ?admin=yukle veya ?admin=indir için
  const code = req.body?.code || req.query?.kod;
  const token = req.body?.token || req.query?.token;
  const admin_pass = req.body?.admin_pass || req.query?.pass; // ?pass=Şifren için

  const GERCEK_ADMIN_SIFRESI = process.env.SECURE_ADMIN_PASSWORD; 

  // Yönetici doğrulaması gereken işlemler (Yükleme ve İndirme)
  if (action === 'yukle' || action === 'toplu_yukle' || action === 'indir' || action === 'kodlari_indir') {
    if (!GERCEK_ADMIN_SIFRESI || admin_pass !== GERCEK_ADMIN_SIFRESI) {
      // Çökme olmasın diye hatayı düz metin olarak tarayıcıya basıyoruz
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<h1>❌ HATA: Yönetici şifresi geçersiz veya Vercel ayarı eksik!</h1>');
    }
  }

  // ================= 1. TOPLU YÜKLEME =================
  if (action === 'yukle' || action === 'toplu_yukle') {
    try {
      const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
      const yeniKodHaritasi = {};

      for (const level of levels) {
        for (let i = 1; i <= 300; i++) {
          const cryptoPart = generateCryptoSuffix();
          const siraNo = String(i).padStart(3, '0');
          const yeniKriptoKod = `ENG-${level}-${cryptoPart}-${siraNo}`;
          yeniKodHaritasi[yeniKriptoKod] = level;
        }
      }

      // Tek hamlede yazar, sunucu asla kilitlenmez
      await redis.set('sistem:aktif_kodlar_sozlugu', JSON.stringify(yeniKodHaritasi));

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<h1>✅ BAŞARILI: 1500 adet yeni kripto kod sunucu kilitlenmeden başarıyla yüklendi!</h1>');
    } catch (err) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<h1>❌ Veritabanı yazma hatası: ' + err.message + '</h1>');
    }
  }

  // ================= 2. KODLARI CSV OLARAK İNDİRME =================
  if (action === 'indir' || action === 'kodlari_indir') {
    try {
      const hamVeri = await redis.get('sistem:aktif_kodlar_sozlugu');
      if (!hamVeri) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send('<h1>❌ HATA: Sistemde üretilmiş kod bulunamadı. Önce yukle işlemini yapın.</h1>');
      }

      const harita = typeof hamVeri === 'string' ? JSON.parse(hamVeri) : hamVeri;
      let csvContent = '\uFEFFSeviye,Aktivasyon Kodu,QR Linki\n';
      const host = req.headers['x-forwarded-proto'] + '://' + req.headers.host;

      const sıralıKodlar = Object.keys(harita).sort((a, b) => a.localeCompare(b));

      sıralıKodlar.forEach(kod => {
        const level = harita[kod];
        csvContent += `${level},${kod},${host}/?kod=${kod}\n`;
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=ingilizce_defteri_kripto_kodlar.csv');
      return res.status(200).send(csvContent);
    } catch (err) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<h1>❌ CSV oluşturma hatası: ' + err.message + '</h1>');
    }
  }

  // ================= 3. KOD KONTROLÜ (ÖĞRENCİ GİRİŞİ - MOBİL/WEB POST) =================
  if (action === 'kontrol_et') {
    if (!code) return res.status(400).json({ error: 'Kod eksik' });
    
    const temizKod = code.trim().toUpperCase();
    const hamVeri = await redis.get('sistem:aktif_kodlar_sozlugu');
    
    if (!hamVeri) return res.status(400).json({ error: 'Sistemde lisans kodu tanımlı değil!' });
    const harita = typeof hamVeri === 'string' ? JSON.parse(hamVeri) : hamVeri;

    const onaylananSeviye = harita[temizKod];

    if (onaylananSeviye) {
      const rastgeleToken = 'TOKEN_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      await redis.set(`token:${rastgeleToken}`, onaylananSeviye, { ex: 60 * 60 * 24 * 365 });
      return res.status(200).json({ success: true, token: rastgeleToken, level: onaylananSeviye });
    } else {
      return res.status(400).json({ error: 'Geçersiz aktivasyon kodu!' });
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
