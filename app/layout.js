export const metadata = {
  title: 'สุกี้ผีน้อย - ระบบสั่งอาหารบุฟเฟต์',
  description: 'ระบบสั่งอาหารและจัดการโต๊ะร้านสุกี้ผีน้อย',
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body style={{ margin: 0, fontFamily: 'sans-serif', backgroundColor: '#fafafa' }}>
        {children}
      </body>
    </html>
  );
}
