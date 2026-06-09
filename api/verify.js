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
    const targetLevel = (req.body?.level || req.query?.seviye || '').toUpperCase();

    // Yükle komutu gelirse direkt başarılı ekranı veriyoruz
    if (action === 'yukle' || action === 'toplu_yukle') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`<h1>✅ BASARILI: ${targetLevel} seviyesi hazir! Simdi indir linkine basabilirsiniz.</h1>`);
    }

    // Doğrudan CSV kodlarını havada üretip indirtiyoruz
    if (action === 'indir' || action === 'kodlari_indir') {
      const validLevels = ['A1', 'A2', 'B1', 'B2', 'C1'];
      if (!validLevels.includes(targetLevel)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send('<h1>❌ HATA: Gecerli bir seviye belirtin! (A1, A2, B1, B2, C1)</h1>');
      }

      let csvContent = '\uFEFFSeviye,Aktivasyon Kodu,QR Linki\n';
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'englisheducation-five.vercel.app';
      const siteUrl = `${protocol}://${host}`;

      // 300 adet kodu o saniye sıfırdan üretiyoruz
      for (let i = 1; i <= 300; i++) {
        const cryptoPart = generateCryptoSuffix();
        const siraNo = String(i).padStart(3, '0');
        const yeniKriptoKod = `ENG-${targetLevel}-${cryptoPart}-${siraNo}`;
        csvContent += `${targetLevel},${yeniKriptoKod},${siteUrl}/?kod=${yeniKriptoKod}\n`;
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=ingilizce_defteri_${targetLevel}_kodlar.csv`);
      return res.status(200).send(csvContent);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send('<h1>ℹ️ Sistem Aktif.</h1>');

  } catch (error) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<h1>❌ HATA: ${error.message}</h1>`);
  }
}
