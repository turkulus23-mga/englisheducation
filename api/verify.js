import { kv } from '@vercel/kv';

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
    const action = req.body?.action || req.query?.admin; 
    const code = req.body?.code || req.query?.kod;
    const token = req.body?.token || req.query?.token;
    const targetLevel = (req.body?.level || req.query?.seviye || '').toUpperCase();

    // ================= 1. KODLARI VERİTABANINA YÜKLEME =================
    // Bu işlem kodları sisteme kaydeder, böylece sistem kodları TANIR.
    if (action === 'yukle' || action === 'toplu_yukle') {
      const validLevels = ['A1', 'A2', 'B1', 'B2', 'C1'];
      if (!validLevels.includes(targetLevel)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send('<h1>❌ HATA: Gecerli bir seviye belirtin! (A1, A2, B1, B2, C1)</h1>');
      }

      const pipeline = kv.pipeline();
      for (let i = 1; i <= 300; i++) {
        const cryptoPart = generateCryptoSuffix();
        const siraNo = String(i).padStart(3, '0');
        const yeniKriptoKod = `ENG-${targetLevel}-${cryptoPart}-${siraNo}`;

        // Her bir kodu sisteme seviyesiyle birlikte kaydediyoruz
        pipeline.set(`code:${yeniKriptoKod}`, targetLevel);
      }
      await pipeline.exec();

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`<h1>✅ BAŞARILI: ${targetLevel} seviyesi icin 300 adet kod sisteme yuklendi ve aktif edildi!</h1>`);
    }

    // ================= 2. ÖĞRENCİ GİRİŞ KONTROLÜ (TEK SEFERLİK) =================
    if (action === 'kontrol_et') {
      if (!code) return res.status(400).json({ error: 'Kod eksik' });
      const temizKod = code.trim().toUpperCase();
      
      // Veritabanından kodu sorgula
      const onaylananSeviye = await kv.get(`code:${temizKod}`);

      if (onaylananSeviye) {
        // 🔒 TEK SEFERLİK YAPMA: Kod doğruysa, veritabanından anında siliyoruz! 
        // Böylece ikinci bir öğrenci aynı kodu girdiğinde "Geçersiz" uyarısı alacak.
        await kv.del(`code:${temizKod}`);

        // Öğrenciye 1 yıl geçerli benzersiz bir oturum tokenı veriyoruz
        const rastgeleToken = 'TOKEN_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        await kv.set(`token:${rastgeleToken}`, onaylananSeviye, { ex: 60 * 60 * 24 * 365 });
        
        return res.status(200).json({ success: true, token: rastgeleToken, level: onaylananSeviye });
      } else {
        return res.status(400).json({ error: 'Geçersiz veya daha önce kullanılmış aktivasyon kodu!' });
      }
    }

    // ================= 3. CİHAZ TOKEN DOĞRULAMA =================
    if (action === 'token_dogrula') {
      if (!token) return res.status(400).json({ error: 'Token eksik' });
      const seviye = await kv.get(`token:${token}`);
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
