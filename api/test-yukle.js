import { useState } from 'react';

export default function TestYukle() {
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const kodlariYukle = async () => {
    setLoading(true);
    setStatus('Kodlar veritabanına yükleniyor, lütfen bekleyin...');
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toplu_yukle' })
      });
      const data = await res.json();
      if (data.success) {
        setStatus('✅ BAŞARILI: ' + data.message);
      } else {
        setStatus('❌ HATA: ' + data.error);
      }
    } catch (err) {
      setStatus('❌ Sistem Hatası: ' + err.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: '50px', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h2>İngilizce Defteri Veritabanı Yönetim Paneli</h2>
      <p>A1-C1 arası tüm aktivasyon kodlarını Redis'e yüklemek için aşağıdaki butona basın.</p>
      <button 
        onClick={kodlariYukle} 
        disabled={loading}
        style={{
          padding: '15px 30px',
          fontSize: '18px',
          backgroundColor: loading ? '#ccc' : '#0070f3',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer'
        }}
      >
        {loading ? 'Yükleniyor...' : 'Veritabanına Kodları Fırlat'}
      </button>
      <div style={{ marginTop: '30px', fontWeight: 'bold', color: '#333' }}>{status}</div>
    </div>
  );
}
