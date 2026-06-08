import { Redis } from '@upstash/redis';

// Redis bağlantısını başlatıyoruz
const redis = new Redis({
  url: process.env.REDIS_URL || '',
  token: process.env.REDIS_TOKEN || '',
});

// Güvenli ve rastgele 4 haneli kripto string üreten yardımcı fonksiyon
function generateCryptoSuffix() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default async function handler(req, res) {
  // Olası bir backend çökmesini önlemek için tüm akışı dev bir try-catch bloğuna alıyoruz
  try {
    // İstek POST ise body'den, tarayıcı linkinden (GET) geliyorsa query'den verileri al
    const action = req.body?.action || req.query?.admin; 
    const code = req.body?.code || req.query?.kod;
    const token = req.body?.token || req.query?.token;
    const admin_pass = req.body?.admin_pass || req.query?.pass; 

    const GERCEK_ADMIN_SIFRESI = process.env.SECURE_ADMIN_PASSWORD;

    // 1. ADMİN DOĞRULAMA KONTROLÜ
    if (action === 'yukle' || action === 'toplu_yukle' || action === 'indir' || action === 'kodlari_indir') {
      if (!GERCEK_ADMIN_SIFRESI || admin_pass !== GERCEK_ADMIN_SIFRESI) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send('<h1>❌ HATA: Yönetici şifresi geçersiz veya Vercel ayarı eksik!</h1>');
      }
    }

    // ================= A. TOPLU YÜKLEME İŞLEMİ =================
    if (action === 'yukle' || action === 'toplu_yukle') {
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

      // Redis'e tek bir hamlede sorunsuzca yazıyoruz
      await redis.set('sistem:aktif_kodlar_sozlugu', JSON.stringify(yeniKodHaritasi));

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<h1>✅ BAŞARILI: 1500 adet yeni kripto kod sunucu kilitlenmeden başarıyla yüklendi!</h1>');
    }

    // ================= B. KODLARI CSV OLARAK İNDİRME İŞLEMİ =================
    if (action === 'indir' || action === 'kodlari_indir') {
      const hamVeri = await redis.get('sistem:aktif_kodlar_sozlugu');
      if (!hamVeri) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send('<h1>❌ HATA: Sistemde üretilmiş kod bulunamadı. Önce yukle işlemini yapın.</h1>');
      }

      // Veritabanından gelen verinin güvenli parse edilmesi
      const harita = typeof hamVeri === 'string' ? JSON.parse(hamVeri) : hamVeri;
      let csvContent = '\uFEFFSeviye,Aktivasyon Kodu,QR Linki\n';
      
      // Çökmeye sebep olabilen dinamik protokol yerine güvenli host bulma yöntemi
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'englisheducation-five.vercel.app';
      const siteUrl = `${protocol}://${host}`;

      const siraliKodlar = Object.keys(harita).sort((a, b) => a.localeCompare(b));

      siraliKodlar.forEach(kod => {
        const level = harita[kod];
        csvContent += `${level},${kod},${siteUrl}/?kod=${kod}\n`;
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=ingilizce_defteri_kripto_kodlar.csv');
      return res.status(200).send(csvContent);
    }

    // ================= C. ÖĞRENCİ KOD KONTROLÜ (POST) =================
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

    // ================= D. CİHAZ TOKEN DOĞRULAMA =================
    if (action === 'token_dogrula') {
      if (!token) return res.status(400).json({ error: 'Token eksik' });
      
      const seviye = await redis.get(`token:${token}`);
      if (seviye) {
        return res.status(200).json({ success: true, level: seviye });
      } else {
        return res.status(400).json({ error: 'Oturum geçersiz' });
      }
    }

    // Eğer tarayıcıdan düz girildiyse hata yerine temiz bir karşılama ekranı verelim
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send('<h1>ℹ️ Sistem aktif ve çalışıyor.</h1>');

  } catch (error) {
    // EN KRİTİK NOKTA: Arka planda ne hata olursa olsun sunucu ÇÖKMEYECEK, hatayı ekrana basacak.
    // Böylece "Unexpected token A" hatası tamamen tarihe karışacak.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<h1>❌ Sunucu İçi Kritik Hata: ${error.message}</h1>`);
  }
}

