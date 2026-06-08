import { createClient } from 'redis';
import { NextResponse } from 'next/server';

// Redis istemcisini Vercel'in otomatik tanıdığı REDIS_URL ile başlatıyoruz
const client = createClient({
  url: process.env.REDIS_URL
});

client.on('error', err => console.log('Redis Client Error', err));

export async function POST(request) {
  try {
    if (!client.isOpen) await client.connect();
    
    const body = await request.json();
    const { action, code } = body;

    // --- 1. GİZLİ ADIM: TOPLU KOD YÜKLEME SİSTEMİ ---
    // Tarayıcıdan bu API'ye "yukle" komutu geldiğinde kodları veritabanına yazar
    if (action === "toplu_yukle") {
      const levels = {
        "A1": 200,
        "A2": 300,
        "B1": 400,
        "B2": 500,
        "C1": 100
      };

      // Döngüyle tüm kodları (Örn: ENG-A1-001: "aktif") Redis'e yüklüyoruz
      for (const [level, count] of Object.entries(levels)) {
        for (let i = 1; i <= count; i++) {
          const formattedId = String(i).padStart(3, '0'); // 001, 002 gibi
          const activationCode = `ENG-${level}-${formattedId}`;
          await client.set(activationCode, "aktif");
        }
      }
      return NextResponse.json({ success: true, message: "Tüm aktivasyon kodları başarıyla veritabanına yüklendi!" });
    }

    // --- 2. ASIL ADIM: MÜŞTERİ KOD DOĞRULAMA SİSTEMİ ---
    if (action === "kontrol_et") {
      if (!code) return NextResponse.json({ success: false, error: "Lütfen bir kod girin." });

      // Veritabanından kodun durumunu sorgula
      const status = await client.get(code);

      if (!status) {
        return NextResponse.json({ success: false, error: "Geçersiz veya hatalı kod girdiniz!" });
      }

      if (status === "kullanildi") {
        return NextResponse.json({ success: false, error: "Bu kod daha önce başka bir cihazda kullanılmıştır!" });
      }

      if (status === "aktif") {
        // Kodu kullanıldı olarak işaretle
        await client.set(code, "kullanildi");
        
        // Müşterinin seviyesini kodun içinden oku (ENG-A1-005 -> A1)
        const detectedLevel = code.split('-')[1]; 

        return NextResponse.json({ 
          success: true, 
          message: "Giriş başarılı! Modül açılıyor...",
          level: detectedLevel 
        });
      }
    }

    return NextResponse.json({ success: false, error: "Geçersiz işlem." });

  } catch (error) {
    return NextResponse.json({ success: false, error: error.message });
  }
}

