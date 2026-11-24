'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

export default function GenerateQRPage() {
  // ข้อมูลฟอร์ม
  const [tableNumber, setTableNumber] = useState('');
  const [adultCount, setAdultCount] = useState('2');
  const [childCount, setChildCount] = useState('0');

  // สถานะการทำงาน
  const [loading, setLoading] = useState(false);
  const [closingOld, setClosingOld] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // State สำหรับ Session เก่าที่เปิดค้างอยู่ & กล่องยืนยันปิดโต๊ะ
  const [existingSession, setExistingSession] = useState(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // State สำหรับผลลัพธ์ QR Code ที่เปิดสำเร็จ
  const [createdInfo, setCreatedInfo] = useState(null);
  const [copied, setCopied] = useState(false);

  // กดปุ่ม "เปิดโต๊ะ"
  const handleOpenTable = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setExistingSession(null);
    setCreatedInfo(null);

    const tableNum = Number(tableNumber);
    const adults = Number(adultCount);
    const children = Number(childCount);

    if (!tableNumber || isNaN(tableNum) || tableNum <= 0) {
      setErrorMsg('กรุณากรอกเลขโต๊ะให้ถูกต้อง');
      return;
    }
    if (isNaN(adults) || adults < 0 || isNaN(children) || children < 0 || adults + children === 0) {
      setErrorMsg('กรุณาระบุจำนวนลูกค้าอย่างน้อย 1 คน');
      return;
    }

    setLoading(true);
    try {
      // 1. เช็กว่ามี session ที่ table_number ตรงกัน และ status = 'open' อยู่หรือไม่
      const { data: openSessions, error: checkError } = await supabase
        .from('sessions')
        .select('id, table_number, adult_count, child_count, created_at')
        .eq('table_number', tableNum)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);

      if (checkError) throw checkError;

      if (openSessions && openSessions.length > 0) {
        // พบโต๊ะเปิดค้างอยู่ -> แสดงกล่องเตือน
        setExistingSession(openSessions[0]);
        setLoading(false);
        return;
      }

      // 2. ไม่มีโต๊ะเปิดค้าง -> สร้าง Session ใหม่
      const { data: newSession, error: insertError } = await supabase
        .from('sessions')
        .insert([
          {
            table_number: tableNum,
            adult_count: adults,
            child_count: children,
            status: 'open',
          },
        ])
        .select()
        .single();

      if (insertError) throw insertError;

      // สร้าง URL เต็มของเว็บปัจจุบัน + /order/[เลขโต๊ะ]
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const orderUrl = `${origin}/order/${tableNum}`;

      setCreatedInfo({
        session: newSession,
        tableNumber: tableNum,
        adultCount: adults,
        childCount: children,
        orderUrl,
      });
    } catch (err) {
      console.error('Error opening table:', err);
      setErrorMsg(`เกิดข้อผิดพลาด: ${err.message || 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้'}`);
    } finally {
      setLoading(false);
    }
  };

  // คำนวณจำนวนนาทีที่เปิดโต๊ะเก่ามาแล้ว
  const getElapsedMinutes = (createdAt) => {
    if (!createdAt) return 0;
    const diffMs = Date.now() - new Date(createdAt).getTime();
    return Math.max(0, Math.floor(diffMs / 60000));
  };

  // กดปุ่ม "ยืนยันปิดโต๊ะเดิม" ใน Confirm Dialog
  const handleConfirmCloseOldSession = async () => {
    if (!existingSession) return;
    setClosingOld(true);
    setErrorMsg('');

    try {
      // อัปเดต status = 'closed' เฉพาะแถวนั้น และเช็กซ้ำว่า status ยังเป็น 'open' อยู่
      const { data: updatedRows, error: updateError } = await supabase
        .from('sessions')
        .update({ status: 'closed' })
        .eq('id', existingSession.id)
        .eq('status', 'open')
        .select();

      if (updateError) throw updateError;

      if (!updatedRows || updatedRows.length === 0) {
        setErrorMsg('โต๊ะเดิมถูกปิดไปแล้วก่อนหน้านี้ สามารถกด "เปิดโต๊ะ" ได้เลย');
      }

      // ปิดกล่องยืนยัน, เอากล่องเตือนออก, คงค่าในฟอร์มไว้ให้พนักงานกด "เปิดโต๊ะ" อีกครั้ง
      setShowConfirmModal(false);
      setExistingSession(null);
    } catch (err) {
      console.error('Error closing old session:', err);
      setErrorMsg(`ปิดโต๊ะเดิมไม่สำเร็จ: ${err.message}`);
      setShowConfirmModal(false);
    } finally {
      setClosingOld(false);
    }
  };

  // คัดลอกลิงก์
  const handleCopyLink = async () => {
    if (!createdInfo?.orderUrl) return;
    try {
      await navigator.clipboard.writeText(createdInfo.orderUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback กรณีเบราว์เซอร์บล็อก clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = createdInfo.orderUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ล้างฟอร์มเพื่อเปิดโต๊ะใหม่
  const handleResetForm = () => {
    setCreatedInfo(null);
    setExistingSession(null);
    setErrorMsg('');
    setTableNumber('');
    setAdultCount('2');
    setChildCount('0');
    setCopied(false);
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: '#f5f5f5',
        padding: '20px 16px',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ maxWidth: '520px', margin: '0 auto' }}>
        {/* แถบหัวข้อด้านบน */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
          }}
        >
          <h1 style={{ fontSize: '1.75rem', color: '#d32f2f', margin: 0 }}>
            👻 เปิดโต๊ะ / สร้าง QR
          </h1>
          <Link
            href="/"
            style={{
              fontSize: '1rem',
              color: '#424242',
              textDecoration: 'none',
              padding: '8px 14px',
              backgroundColor: '#e0e0e0',
              borderRadius: '8px',
              fontWeight: 'bold',
            }}
          >
            ← หน้าแรก
          </Link>
        </div>

        {/* ข้อความแจ้ง Error ทั่วไป */}
        {errorMsg && (
          <div
            style={{
              backgroundColor: '#ffebee',
              border: '2px solid #d32f2f',
              color: '#b71c1c',
              padding: '16px',
              borderRadius: '10px',
              marginBottom: '20px',
              fontSize: '1.1rem',
              fontWeight: 'bold',
            }}
          >
            ⚠️ {errorMsg}
          </div>
        )}

        {/* กล่องเตือนเมื่อพบว่าโต๊ะนี้มี Session เปิดค้างอยู่แล้ว */}
        {existingSession && (
          <div
            style={{
              backgroundColor: '#fff3e0',
              border: '3px solid #e65100',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '24px',
              boxShadow: '0 4px 12px rgba(230, 81, 0, 0.15)',
            }}
          >
            <div
              style={{
                fontSize: '1.25rem',
                fontWeight: 'bold',
                color: '#bf360c',
                marginBottom: '12px',
                lineHeight: 1.4,
              }}
            >
              🚨 โต๊ะนี้มีลูกค้าอยู่ระหว่างทานอาหาร กรุณาปิดออเดอร์เดิมก่อน
            </div>

            <div
              style={{
                fontSize: '1.05rem',
                color: '#4e342e',
                backgroundColor: '#ffe0b2',
                padding: '10px 14px',
                borderRadius: '8px',
                marginBottom: '16px',
              }}
            >
              โต๊ะ <strong>{existingSession.table_number}</strong> · ผู้ใหญ่{' '}
              <strong>{existingSession.adult_count}</strong> · เด็ก{' '}
              <strong>{existingSession.child_count}</strong> (เปิดมาแล้ว{' '}
              <strong>{getElapsedMinutes(existingSession.created_at)} นาที</strong>)
            </div>

            <button
              type="button"
              onClick={() => setShowConfirmModal(true)}
              style={{
                width: '100%',
                padding: '14px',
                fontSize: '1.2rem',
                fontWeight: 'bold',
                backgroundColor: '#d84315',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                cursor: 'pointer',
              }}
            >
              ปิดออเดอร์เดิม
            </button>
          </div>
        )}

        {/* ส่วนแสดงผล QR Code เมื่อสร้าง Session ใหม่สำเร็จ */}
        {createdInfo ? (
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '28px 20px',
              textAlign: 'center',
              boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
              border: '2px solid #2e7d32',
            }}
          >
            <div
              style={{
                display: 'inline-block',
                backgroundColor: '#e8f5e9',
                color: '#1b5e20',
                fontWeight: 'bold',
                fontSize: '1.1rem',
                padding: '6px 16px',
                borderRadius: '20px',
                marginBottom: '16px',
              }}
            >
              ✅ เปิดโต๊ะสำเร็จ
            </div>

            {/* รูป QR Code */}
            <div
              style={{
                backgroundColor: '#fff',
                padding: '12px',
                display: 'inline-block',
                border: '2px solid #eeeeee',
                borderRadius: '12px',
                marginBottom: '16px',
              }}
            >
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
                  createdInfo.orderUrl
                )}`}
                alt={`QR Code โต๊ะ ${createdInfo.tableNumber}`}
                width={260}
                height={260}
                style={{ display: 'block' }}
              />
            </div>

            {/* ข้อความสรุปโต๊ะและจำนวนคน */}
            <div
              style={{
                fontSize: '1.65rem',
                fontWeight: 'bold',
                color: '#212121',
                marginBottom: '14px',
              }}
            >
              โต๊ะ {createdInfo.tableNumber} · ผู้ใหญ่ {createdInfo.adultCount} · เด็ก{' '}
              {createdInfo.childCount}
            </div>

            {/* ลิงก์เต็ม + ปุ่มคัดลอกลิงก์ */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                backgroundColor: '#f5f5f5',
                padding: '12px',
                borderRadius: '10px',
                marginBottom: '24px',
                border: '1px solid #e0e0e0',
              }}
            >
              <span
                style={{
                  fontSize: '1rem',
                  color: '#1565c0',
                  fontWeight: 'bold',
                  wordBreak: 'break-all',
                }}
              >
                {createdInfo.orderUrl}
              </span>
              <button
                type="button"
                onClick={handleCopyLink}
                style={{
                  padding: '6px 12px',
                  fontSize: '0.95rem',
                  fontWeight: 'bold',
                  backgroundColor: copied ? '#2e7d32' : '#424242',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {copied ? '✓ คัดลอกแล้ว' : 'คัดลอกลิงก์'}
              </button>
            </div>

            {/* ปุ่มเปิดโต๊ะใหม่ */}
            <button
              type="button"
              onClick={handleResetForm}
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '1.25rem',
                fontWeight: 'bold',
                backgroundColor: '#d32f2f',
                color: '#fff',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
              }}
            >
              + เปิดโต๊ะใหม่
            </button>
          </div>
        ) : (
          /* ฟอร์มกรอกข้อมูลเปิดโต๊ะ */
          <form
            onSubmit={handleOpenTable}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '24px 20px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            }}
          >
            {/* ช่อง 1: เลขโต๊ะ */}
            <div style={{ marginBottom: '20px' }}>
              <label
                htmlFor="tableNumber"
                style={{
                  display: 'block',
                  fontSize: '1.25rem',
                  fontWeight: 'bold',
                  color: '#212121',
                  marginBottom: '8px',
                }}
              >
                เลขโต๊ะ
              </label>
              <input
                id="tableNumber"
                type="number"
                inputMode="numeric"
                min="1"
                required
                placeholder="เช่น 7"
                value={tableNumber}
                onChange={(e) => {
                  setTableNumber(e.target.value);
                  if (existingSession) setExistingSession(null);
                }}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '14px 16px',
                  fontSize: '1.5rem',
                  fontWeight: 'bold',
                  border: '2px solid #bdbdbd',
                  borderRadius: '10px',
                }}
              />
            </div>

            {/* ช่อง 2 & 3: จำนวนผู้ใหญ่ และ จำนวนเด็ก */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '16px',
                marginBottom: '28px',
              }}
            >
              <div>
                <label
                  htmlFor="adultCount"
                  style={{
                    display: 'block',
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    color: '#212121',
                    marginBottom: '8px',
                  }}
                >
                  จำนวนผู้ใหญ่
                </label>
                <input
                  id="adultCount"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  required
                  value={adultCount}
                  onChange={(e) => setAdultCount(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '14px 16px',
                    fontSize: '1.4rem',
                    fontWeight: 'bold',
                    border: '2px solid #bdbdbd',
                    borderRadius: '10px',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="childCount"
                  style={{
                    display: 'block',
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    color: '#212121',
                    marginBottom: '8px',
                  }}
                >
                  จำนวนเด็ก
                </label>
                <input
                  id="childCount"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  required
                  value={childCount}
                  onChange={(e) => setChildCount(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '14px 16px',
                    fontSize: '1.4rem',
                    fontWeight: 'bold',
                    border: '2px solid #bdbdbd',
                    borderRadius: '10px',
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '1.35rem',
                fontWeight: 'bold',
                backgroundColor: loading ? '#9e9e9e' : '#d32f2f',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'กำลังตรวจสอบ...' : 'เปิดโต๊ะ'}
            </button>
          </form>
        )}
      </div>

      {/* Confirm Dialog สำหรับยืนยันปิดโต๊ะเดิม */}
      {showConfirmModal && existingSession && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '440px',
              width: '100%',
              border: '3px solid #d32f2f',
              boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            }}
          >
            <h2
              style={{
                fontSize: '1.45rem',
                color: '#b71c1c',
                marginTop: 0,
                marginBottom: '16px',
              }}
            >
              ⚠️ ยืนยันการปิดโต๊ะเดิม
            </h2>

            <div
              style={{
                backgroundColor: '#ffebee',
                padding: '16px',
                borderRadius: '10px',
                marginBottom: '20px',
                fontSize: '1.2rem',
                color: '#212121',
                lineHeight: 1.6,
              }}
            >
              <div>
                <strong>เลขโต๊ะ:</strong> โต๊ะ {existingSession.table_number}
              </div>
              <div>
                <strong>จำนวนลูกค้า:</strong> ผู้ใหญ่ {existingSession.adult_count} · เด็ก{' '}
                {existingSession.child_count}
              </div>
              <div style={{ color: '#c62828', fontWeight: 'bold', marginTop: '4px' }}>
                ⏱ เปิดมาแล้ว {getElapsedMinutes(existingSession.created_at)} นาที
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
              }}
            >
              <button
                type="button"
                disabled={closingOld}
                onClick={() => setShowConfirmModal(false)}
                style={{
                  padding: '14px',
                  fontSize: '1.15rem',
                  fontWeight: 'bold',
                  backgroundColor: '#e0e0e0',
                  color: '#212121',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: closingOld ? 'not-allowed' : 'pointer',
                }}
              >
                ยกเลิก
              </button>

              <button
                type="button"
                disabled={closingOld}
                onClick={handleConfirmCloseOldSession}
                style={{
                  padding: '14px',
                  fontSize: '1.15rem',
                  fontWeight: 'bold',
                  backgroundColor: closingOld ? '#9e9e9e' : '#d32f2f',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: closingOld ? 'not-allowed' : 'pointer',
                }}
              >
                {closingOld ? 'กำลังปิด...' : 'ยืนยันปิดโต๊ะเดิม'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
