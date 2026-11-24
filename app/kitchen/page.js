'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

export default function KitchenPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [realtimeStatus, setRealtimeStatus] = useState('CONNECTING');
  const [updatingIds, setUpdatingIds] = useState({});
  const [now, setNow] = useState(() => Date.now());
  const [errorMsg, setErrorMsg] = useState('');

  // ดึงรายการออเดอร์ที่ยังค้างอยู่ ('received' หรือ 'cooking') เรียงจากเก่าไปใหม่
  const fetchActiveOrders = useCallback(async () => {
    setErrorMsg('');
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id, session_id, table_number, items, status, created_at')
        .in('status', ['received', 'cooking'])
        .order('created_at', { ascending: true });

      if (error) throw error;
      setOrders(data || []);
    } catch (err) {
      console.error('Error fetching kitchen orders:', err);
      setErrorMsg(`โหลดข้อมูลออเดอร์ไม่สำเร็จ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // โหลดครั้งแรก + Subscribe Supabase Realtime
  useEffect(() => {
    fetchActiveOrders();

    // อัปเดตเวลาทุก 30 วินาที เพื่อคำนวณว่าออเดอร์รอมานานกี่นาทีแล้ว
    const clockInterval = setInterval(() => {
      setNow(Date.now());
    }, 30000);

    // เชื่อมต่อ Supabase Realtime ฟัง INSERT และ UPDATE ของตาราง orders
    const channel = supabase
      .channel('kitchen-orders-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
        },
        (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload;

          if (eventType === 'INSERT') {
            if (newRow && (newRow.status === 'received' || newRow.status === 'cooking')) {
              setOrders((prev) => {
                // ป้องกันข้อมูลซ้ำ
                if (prev.some((o) => o.id === newRow.id)) return prev;
                const next = [...prev, newRow];
                // เรียงจากเก่าไปใหม่ (ใบแรกอยู่ซ้ายบน ใบใหม่ล่าสุดอยู่ขวาสุด/ล่างสุด)
                return next.sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                );
              });
            }
          } else if (eventType === 'UPDATE') {
            if (!newRow) return;

            if (newRow.status === 'received' || newRow.status === 'cooking') {
              // อัปเดตสถานะการ์ดในจอ (เช่น เปลี่ยนเป็น cooking)
              setOrders((prev) => {
                const exists = prev.some((o) => o.id === newRow.id);
                if (exists) {
                  return prev.map((o) => (o.id === newRow.id ? newRow : o));
                }
                return [...prev, newRow].sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                );
              });
            } else {
              // ถ้า status เป็น 'served' หรืออื่นๆ ให้ลบออกจากหน้าจอทันที
              setOrders((prev) => prev.filter((o) => o.id !== newRow.id));
            }
          } else if (eventType === 'DELETE' && oldRow) {
            setOrders((prev) => prev.filter((o) => o.id !== oldRow.id));
          }
        }
      )
      .subscribe((status) => {
        setRealtimeStatus(status);
      });

    return () => {
      clearInterval(clockInterval);
      supabase.removeChannel(channel);
    };
  }, [fetchActiveOrders]);

  // กดปุ่มเปลี่ยนสถานะออเดอร์ ('cooking' หรือ 'served')
  const handleUpdateStatus = async (orderId, nextStatus) => {
    if (updatingIds[orderId]) return;

    setUpdatingIds((prev) => ({ ...prev, [orderId]: true }));
    setErrorMsg('');

    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: nextStatus })
        .eq('id', orderId);

      if (error) throw error;

      // อัปเดต UI ทันที (ไม่ต้องรอ Realtime วนกลับ จะได้รู้สึกลื่นไหล)
      if (nextStatus === 'served') {
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
      } else {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o))
        );
      }
    } catch (err) {
      console.error('Error updating order status:', err);
      setErrorMsg(`อัปเดตสถานะไม่สำเร็จ: ${err.message}`);
    } finally {
      setUpdatingIds((prev) => {
        const copy = { ...prev };
        delete copy[orderId];
        return copy;
      });
    }
  };

  // แปลงเวลาที่สั่งเป็นรูปแบบ HH:MM น.
  const formatOrderTime = (isoString) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // คำนวณจำนวนนาทีที่รอตั้งแต่สั่ง
  const getWaitMinutes = (isoString) => {
    if (!isoString) return 0;
    const diff = now - new Date(isoString).getTime();
    return Math.max(0, Math.floor(diff / 60000));
  };

  // แปลงคอลัมน์ items (jsonb) ให้เป็น Array ที่ปลอดภัยเสมอ
  const parseOrderItems = (items) => {
    if (Array.isArray(items)) return items;
    if (typeof items === 'string') {
      try {
        const parsed = JSON.parse(items);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const receivedCount = orders.filter((o) => o.status === 'received').length;
  const cookingCount = orders.filter((o) => o.status === 'cooking').length;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#18181b',
        color: '#f4f4f5',
        fontFamily: 'sans-serif',
        padding: '16px 20px 32px',
      }}
    >
      {/* แถบ Header จอครัว */}
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          backgroundColor: '#27272a',
          padding: '16px 22px',
          borderRadius: '14px',
          marginBottom: '20px',
          border: '1px solid #3f3f46',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: '1.9rem', color: '#ffffff' }}>
            🍳 จอรับออเดอร์ในครัว · สุกี้ผีน้อย
          </h1>

          {/* สถานะการเชื่อมต่อ Realtime */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '999px',
              fontSize: '0.95rem',
              fontWeight: 'bold',
              backgroundColor:
                realtimeStatus === 'SUBSCRIBED' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)',
              color: realtimeStatus === 'SUBSCRIBED' ? '#4ade80' : '#facc15',
              border: `1px solid ${realtimeStatus === 'SUBSCRIBED' ? '#22c55e' : '#eab308'}`,
            }}
          >
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: realtimeStatus === 'SUBSCRIBED' ? '#22c55e' : '#eab308',
              }}
            />
            {realtimeStatus === 'SUBSCRIBED' ? 'Realtime ออนไลน์' : 'กำลังเชื่อมต่อ...'}
          </span>
        </div>

        {/* ตัวเลขสรุปคิว + ปุ่มรีเฟรชเผื่อฉุกเฉิน */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <div
            style={{
              backgroundColor: '#3f3f46',
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '1.15rem',
              fontWeight: 'bold',
            }}
          >
            รอทำ: <span style={{ color: '#60a5fa', fontSize: '1.35rem' }}>{receivedCount}</span>
          </div>

          <div
            style={{
              backgroundColor: '#451a03',
              border: '1px solid #f59e0b',
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '1.15rem',
              fontWeight: 'bold',
              color: '#fcd34d',
            }}
          >
            กำลังทำ: <span style={{ color: '#fbbf24', fontSize: '1.35rem' }}>{cookingCount}</span>
          </div>

          <button
            type="button"
            onClick={fetchActiveOrders}
            style={{
              padding: '10px 16px',
              borderRadius: '10px',
              border: '1px solid #52525b',
              backgroundColor: '#3f3f46',
              color: '#ffffff',
              fontSize: '1rem',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            ↻ รีเฟรช
          </button>

          <Link
            href="/"
            style={{
              padding: '10px 16px',
              borderRadius: '10px',
              backgroundColor: '#3f3f46',
              color: '#d4d4d8',
              textDecoration: 'none',
              fontSize: '1rem',
              fontWeight: 'bold',
            }}
          >
            หน้าแรก
          </Link>
        </div>
      </header>

      {/* แสดง Error ถ้ามี */}
      {errorMsg && (
        <div
          style={{
            backgroundColor: '#7f1d1d',
            border: '2px solid #ef4444',
            color: '#fecaca',
            padding: '14px 18px',
            borderRadius: '12px',
            fontSize: '1.15rem',
            fontWeight: 'bold',
            marginBottom: '20px',
          }}
        >
          ⚠️ {errorMsg}
        </div>
      )}

      {/* เนื้อหาหลัก */}
      {loading ? (
        <div
          style={{
            textAlign: 'center',
            padding: '80px 20px',
            fontSize: '1.5rem',
            color: '#a1a1aa',
          }}
        >
          กำลังโหลดรายการออเดอร์...
        </div>
      ) : orders.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '100px 20px',
            backgroundColor: '#27272a',
            borderRadius: '16px',
            border: '2px dashed #3f3f46',
          }}
        >
          <div style={{ fontSize: '4rem', marginBottom: '12px' }}>✨</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#e4e4e7' }}>
            ยังไม่มีออเดอร์ค้างในครัว
          </div>
          <div style={{ fontSize: '1.15rem', color: '#a1a1aa', marginTop: '8px' }}>
            เมื่อลูกค้ากดสั่งอาหาร ออเดอร์จะเด้งขึ้นหน้านี้ทันทีอัตโนมัติ
          </div>
        </div>
      ) : (
        /* ตารางกริดแสดงการ์ดออเดอร์ (เรียงจากเก่าไปใหม่ ซ้าย -> ขวา) */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '20px',
            alignItems: 'stretch',
          }}
        >
          {orders.map((order) => {
            const isCooking = order.status === 'cooking';
            const isUpdating = !!updatingIds[order.id];
            const waitMins = getWaitMinutes(order.created_at);
            const itemsList = parseOrderItems(order.items);

            return (
              <div
                key={order.id}
                style={{
                  backgroundColor: isCooking ? '#fef3c7' : '#ffffff',
                  color: '#18181b',
                  borderRadius: '16px',
                  border: isCooking ? '4px solid #f59e0b' : '4px solid #3b82f6',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  overflow: 'hidden',
                }}
              >
                <div>
                  {/* ส่วนหัวของการ์ด: เลขโต๊ะ + เวลาที่สั่ง */}
                  <div
                    style={{
                      backgroundColor: isCooking ? '#f59e0b' : '#2563eb',
                      color: isCooking ? '#18181b' : '#ffffff',
                      padding: '14px 18px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ fontSize: '2rem', fontWeight: '900', lineHeight: 1 }}>
                      โต๊ะ {order.table_number}
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.15rem', fontWeight: 'bold' }}>
                        {formatOrderTime(order.created_at)} น.
                      </div>
                      <div
                        style={{
                          fontSize: '0.95rem',
                          fontWeight: 'bold',
                          opacity: 0.9,
                        }}
                      >
                        ({waitMins === 0 ? 'เพิ่งสั่ง' : `รอ ${waitMins} นาที`})
                      </div>
                    </div>
                  </div>

                  {/* แถบสถานะของการ์ด */}
                  <div
                    style={{
                      padding: '8px 18px',
                      backgroundColor: isCooking ? '#fde68a' : '#dbeafe',
                      color: isCooking ? '#92400e' : '#1e40af',
                      fontSize: '1.05rem',
                      fontWeight: 'bold',
                      borderBottom: '1px solid rgba(0,0,0,0.08)',
                    }}
                  >
                    {isCooking ? '🔥 กำลังปรุงอาหาร...' : '🆕 ออเดอร์เข้าใหม่ (รอเริ่มทำ)'}
                  </div>

                  {/* รายการอาหารทั้งหมดในออเดอร์ */}
                  <div style={{ padding: '16px 18px' }}>
                    <ul
                      style={{
                        listStyle: 'none',
                        margin: 0,
                        padding: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                      }}
                    >
                      {itemsList.map((item, idx) => (
                        <li
                          key={`${order.id}-item-${idx}`}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '12px',
                            paddingBottom: '10px',
                            borderBottom:
                              idx === itemsList.length - 1 ? 'none' : '1px dashed #cbd5e1',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '1.35rem',
                              fontWeight: 'bold',
                              color: '#111827',
                              lineHeight: 1.3,
                            }}
                          >
                            {item.name}
                          </span>
                          <span
                            style={{
                              fontSize: '1.45rem',
                              fontWeight: '900',
                              color: '#dc2626',
                              backgroundColor: isCooking ? '#fffbeb' : '#fee2e2',
                              padding: '4px 12px',
                              borderRadius: '8px',
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                            }}
                          >
                            × {item.quantity}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* ปุ่มดำเนินการด้านล่างการ์ด */}
                <div
                  style={{
                    padding: '14px 18px 18px',
                    display: 'grid',
                    gridTemplateColumns: isCooking ? '1fr' : '1fr 1fr',
                    gap: '10px',
                    backgroundColor: 'rgba(0,0,0,0.03)',
                  }}
                >
                  {/* แสดงปุ่ม "เริ่มทำ" เฉพาะตอนที่สถานะยังเป็น received */}
                  {!isCooking && (
                    <button
                      type="button"
                      disabled={isUpdating}
                      onClick={() => handleUpdateStatus(order.id, 'cooking')}
                      style={{
                        padding: '14px 10px',
                        borderRadius: '10px',
                        border: 'none',
                        backgroundColor: isUpdating ? '#9ca3af' : '#f59e0b',
                        color: '#18181b',
                        fontSize: '1.2rem',
                        fontWeight: 'bold',
                        cursor: isUpdating ? 'not-allowed' : 'pointer',
                      }}
                    >
                      🔥 เริ่มทำ
                    </button>
                  )}

                  {/* ปุ่ม "จัดเสิร์ฟแล้ว" */}
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => handleUpdateStatus(order.id, 'served')}
                    style={{
                      padding: '14px 10px',
                      borderRadius: '10px',
                      border: 'none',
                      backgroundColor: isUpdating ? '#9ca3af' : '#16a34a',
                      color: '#ffffff',
                      fontSize: '1.2rem',
                      fontWeight: 'bold',
                      cursor: isUpdating ? 'not-allowed' : 'pointer',
                    }}
                  >
                    ✅ จัดเสิร์ฟแล้ว
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
