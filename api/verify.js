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
  // CORS ve Method Ayarları
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, code, token, admin_pass } = req.body;
  
  // GÜVENLİK GÜNCELLEMESİ: Şifre Vercel'deki SECURE_ADMIN_PASSWORD değişkeninden okunur.
  const GERCEK_ADMIN_SIFRESI = process.env.SECURE_ADMIN_PASSWORD; 

  // Eğer Vercel panelinde SECURE_ADMIN_PASSWORD tanımlanmadıysa veya gelen şifre boşsa/eşleşmiyorsa engelle
  if (!GERCEK_ADMIN_SIFRESI || admin_pass !== GERCEK_ADMIN_SIFRESI) {
    if (action === 'toplu_yukle' || action === 'kodlari_indir') {
      return res.status(401).json({ error: 'Yetkisiz erişim! Yönetici şifresi geçersiz.' });
    }
  }

  // ================= 1. TOPLU YÜKLEME (YENİDEN KOD ÜRETME) =================
  if (action === 'toplu_yukle') {
    try {
      const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
      
      // Her seviyenin eski listesini temizlemek için del kullanıyoruz
      for (const level of levels) {
        await redis.del(`sistem:kodlar:${level}`);
      }

      // Her seviyeyi kendi içinde küçük paketler (pipeline) halinde ekliyoruz ki sunucu şişmesin
      for (const level of levels) {
        const pipeline = redis.pipeline();
        
        for (let i = 1; i <= 300; i++) {
          const cryptoPart = generateCryptoSuffix();
          const siraNo = String(i).padStart(3, '0');
          const yeniKriptoKod = `ENG-${level}-${cryptoPart}-${siraNo}`;

          // Öğrenci giriş yaptığında seviyesini doğrulamak için anahtar
          pipeline.set(`code:${yeniKriptoKod}`, level);
          
          // CSV olarak geri indirebilmek için kümeye ekle
          pipeline.sadd(`sistem:kodlar:${level}`, yeniKriptoKod);
        }
        
        // Seviye bittiğinde Redis'e yaz
        await pipeline.exec();
      }

      return res.status(200).json({ success: true, message: '1500 adet TAHMİN EDİLEMEZ KRİPTO KOD başarıyla veritabanına yüklendi!' });
    } catch (err) {
      return res.status(500).json({ error: 'Veritabanı hatası: ' + err.message });
    }
  }

  // ================= 2. KODLARI CSV OLARAK İNDİRME =================
  if (action === 'kodlari_indir') {
    try {
      const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
      let csvContent = '\uFEFFSeviye,Aktivasyon Kodu,QR Linki\n';
      const host = req.headers['x-forwarded-proto'] + '://' + req.headers.host;

      for (const level of levels) {
        const kodlar = await redis.smembers(`sistem:kodlar:${level}`);
        if (kodlar && kodlar.length > 0) {
          // Çıktının sıralı ve şık görünmesi için sıralıyoruz
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

  // ================= 3. KOD KONTROLÜ (ÖĞRENCİ GİRİŞİ) =================
  if (action === 'kontrol_et') {
    if (!code) return res.status(400).json({ error: 'Kod eksik' });
    
    const temizKod = code.trim().toUpperCase();
    const onaylananSeviye = await redis.get(`code:${temizKod}`);

    if (onaylananSeviye) {
      const rastgeleToken = 'TOKEN_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      // Öğrenci cihazında 1 yıl boyunca geçerli olacak oturum tokenı
      await redis.set(`token:${rastgeleToken}`, onaylananSeviye, { ex: 60 * 60 * 24 * 365 });
      
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
