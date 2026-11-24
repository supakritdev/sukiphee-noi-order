import Link from 'next/link';

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '2.5rem', color: '#d32f2f', marginBottom: '8px' }}>
        👻 สุกี้ผีน้อย
      </h1>
      <p style={{ color: '#555', marginBottom: '32px' }}>
        ระบบสั่งอาหารบุฟเฟต์ (Deploy Ready)
      </p>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/generate-qr"
          style={{
            padding: '14px 28px',
            backgroundColor: '#d32f2f',
            color: '#fff',
            textDecoration: 'none',
            borderRadius: '8px',
            fontWeight: 'bold',
          }}
        >
          สร้าง QR Code เปิดโต๊ะ (/generate-qr)
        </Link>

        <Link
          href="/kitchen"
          style={{
            padding: '14px 28px',
            backgroundColor: '#212121',
            color: '#fff',
            textDecoration: 'none',
            borderRadius: '8px',
            fontWeight: 'bold',
          }}
        >
          หน้าจอครัว (/kitchen)
        </Link>
      </div>
    </main>
  );
}
