import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.REDIS_URL,
  token: process.env.REDIS_TOKEN,
});

// Güvenli ve rastgele 4 haneli kripto string üreten yardımcı fonksiyon
function generateCryptoSuffix() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Karışıklık olmasın diye 0, 1, O, I hariç
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

  // ================= 1. TOPLU YÜKLEME (YENİDEN KOD ÜRETME) =================
  if (action === 'toplu_yukle') {
    if (admin_pass !== GERCEK_ADMIN_SIFRESI) {
      return res.status(401).json({ error: 'Yetkisiz erişim!' });
    }

    try {
      const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
      const pipeline = redis.pipeline();
      
      // Güvenlik için önce tüm eski verileri temizliyoruz
      await redis.flushdb();

      // Toplam kodları takip etmek için bir liste tutacağız
      const tumKodlar = [];

      for (const level of levels) {
        for (let i = 1; i <= 300; i++) {
          // Örn: ENG-A1-X7B9-001 (Kesinlikle ardışık değil, her seviye için benzersiz)
          const cryptoPart = generateCryptoSuffix();
          const siraNo = String(i).padStart(3, '0');
          const yeniKriptoKod = `ENG-${level}-${cryptoPart}-${siraNo}`;

          // Redis'e kaydet (Değer olarak sadece seviyesini yazıyoruz: "A1")
          pipeline.set(`code:${yeniKriptoKod}`, level);
          
          // Listeye ekle (İndirme işleminde kolaylık olsun diye)
          tumKodlar.push({ kod: yeniKriptoKod, level: level });
        }
      }

      // Üretilen tüm kod listesini tek seferde bir anahtara gömüyoruz (İndirirken bozulmasın diye)
      pipeline.set('sistem:tum_kod_listesi', JSON.stringify(tumKodlar));
      
      // Tüm işlemleri tek seferde Redis'e gönder
      await pipeline.exec();

      return res.status(200).json({ success: true, message: '1500 adet TAHMİN EDİLEMEZ YENİ KRİPTO KOD başarıyla veritabanına yüklendi!' });
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
      const hamVeri = await redis.get('sistem:tum_kod_listesi');
      if (!hamVeri) {
        return res.status(404).json({ error: 'Sistemde üretilmiş kod bulunamadı. Önce yukle işlemini yapın.' });
      }

      const kodlar = typeof hamVeri === 'string' ? JSON.parse(hamVeri) : hamVeri;
      
      // UTF-8 BOM ekleyerek Excel'de Türkçe karakterlerin bozulmasını önlüyoruz
      let csvContent = '\uFEFFSeviye,Aktivasyon Kodu,QR Linki\n';
      
      const host = req.headers['x-forwarded-proto'] + '://' + req.headers.host;

      kodlar.forEach(item => {
        csvContent += `${item.level},${item.kod},${host}/?kod=${item.kod}\n`;
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=ingilizce_defteri_yeni_kripto_kodlar.csv');
      return res.status(200).send(csvContent);
    } catch (err) {
      return res.status(500).json({ error: 'CSV oluşturma hatası: ' + err.message });
    }
  }

  // ================= 3. KOD KONTROLÜ (ÖĞRENCİ GİRİŞİ) =================
  if (action === 'kontrol_et') {
    if (!code) return res.status(400).json({ error: 'Kod eksik' });
    
    const temizKod = code.trim().toUpperCase();
    const onaylananSeviye = await redis.get(`code:${temizKod}`);

    if (onaylananSeviye) {
      // Güvenli bir token üretip tarayıcıya veriyoruz
      const rastgeleToken = 'TOKEN_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      await redis.set(`token:${rastgeleToken}`, onaylananSeviye, { ex: 60 * 60 * 24 * 365 }); // 1 Yıl Geçerli
      
      return res.status(200).json({ success: true, token: rastgeleToken, level: onaylananSeviye });
    } else {
      return res.status(400).json({ error: 'Geçersiz veya kullanılmış aktivasyon kodu!' });
    }
  }

  // ================= 4. CİHAZ TOKEN DOĞRULAMA =================
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

