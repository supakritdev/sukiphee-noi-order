'use client';

import { use, useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';

export default function OrderPage({ params }) {
  // Unwrap params ที่เป็น Promise ด้วย use() ตามข้อกำหนด Next.js 15+
  const { tableNumber } = use(params);

  // State สำหรับ Session ของโต๊ะ
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [isCheckedOut, setIsCheckedOut] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // State สำหรับหมวดหมู่และรายการอาหาร
  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);

  // State สำหรับตะกร้าสินค้า: [{ id, name, quantity }]
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderToast, setOrderToast] = useState('');

  // State สำหรับหน้าต่างเรียกเก็บเงิน
  const [showBillModal, setShowBillModal] = useState(false);
  const [closingSession, setClosingSession] = useState(false);

  // โหลดข้อมูล Session และเมนูอาหารเมื่อเข้าหน้าเว็บ
  useEffect(() => {
    if (!tableNumber) return;

    const initPageData = async () => {
      setLoading(true);
      setErrorMsg('');

      try {
        const tableNum = Number(tableNumber);
        if (isNaN(tableNum)) {
          setSession(null);
          setLoading(false);
          return;
        }

        // 1. ตรวจสอบ session ที่เปิดอยู่ของโต๊ะนี้
        const { data: openSessions, error: sessionError } = await supabase
          .from('sessions')
          .select('id, table_number, adult_count, child_count, status, created_at')
          .eq('table_number', tableNum)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(1);

        if (sessionError) throw sessionError;

        if (!openSessions || openSessions.length === 0) {
          setSession(null);
          setLoading(false);
          return;
        }

        const activeSession = openSessions[0];
        setSession(activeSession);

        // 2. ดึงหมวดหมู่อาหาร (เรียงตาม sort_order) และรายการเมนูทั้งหมด
        const [catRes, itemRes] = await Promise.all([
          supabase
            .from('menu_categories')
            .select('id, name, sort_order')
            .order('sort_order', { ascending: true }),
          supabase.from('menu_items').select('id, category_id, name'),
        ]);

        if (catRes.error) throw catRes.error;
        if (itemRes.error) throw itemRes.error;

        const fetchedCategories = catRes.data || [];
        setCategories(fetchedCategories);
        setMenuItems(itemRes.data || []);

        if (fetchedCategories.length > 0) {
          setSelectedCategoryId(fetchedCategories[0].id);
        }
      } catch (err) {
        console.error('Error loading order page:', err);
        setErrorMsg(`เกิดข้อผิดพลาดในการโหลดข้อมูล: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    initPageData();
  }, [tableNumber]);

  // คำนวณจำนวนรวมทั้งหมดในตะกร้า (สูงสุด 10 ชิ้น/รายการต่อการส่ง 1 ครั้ง)
  const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  // ดึงจำนวนที่เลือกไว้ของเมนูแต่ละชิ้น
  const getItemQtyInCart = (itemId) => {
    const found = cart.find((c) => c.id === itemId);
    return found ? found.quantity : 0;
  };

  // แสดงแจ้งเตือนสั้นๆ ด้านบนจอ
  const showToast = (msg) => {
    setOrderToast(msg);
    setTimeout(() => {
      setOrderToast((prev) => (prev === msg ? '' : prev));
    }, 3000);
  };

  // เพิ่มรายการลงตะกร้า (+1)
  const handleAddItem = (item) => {
    if (totalCartItems >= 10) {
      showToast('⚠️ สั่งได้สูงสุด 10 รายการต่อ 1 รอบครับ');
      return;
    }

    setCart((prevCart) => {
      const existingIndex = prevCart.findIndex((c) => c.id === item.id);
      if (existingIndex > -1) {
        const currentQty = prevCart[existingIndex].quantity;
        if (currentQty >= 5) {
          showToast('⚠️ เมนูนี้เลือกได้สูงสุด 5 ที่ต่อรอบครับ');
          return prevCart;
        }
        const updated = [...prevCart];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: currentQty + 1,
        };
        return updated;
      }
      return [...prevCart, { id: item.id, name: item.name, quantity: 1 }];
    });
  };

  // ลดจำนวนในตะกร้า (-1)
  const handleDecreaseItem = (itemId) => {
    setCart((prevCart) => {
      const existingIndex = prevCart.findIndex((c) => c.id === itemId);
      if (existingIndex === -1) return prevCart;

      const currentQty = prevCart[existingIndex].quantity;
      if (currentQty <= 1) {
        return prevCart.filter((c) => c.id !== itemId);
      }
      const updated = [...prevCart];
      updated[existingIndex] = {
        ...updated[existingIndex],
        quantity: currentQty - 1,
      };
      return updated;
    });
  };

  // กดปุ่ม "ส่งออเดอร์"
  const handleSubmitOrder = async () => {
    if (!session || cart.length === 0 || submittingOrder) return;

    setSubmittingOrder(true);
    setErrorMsg('');

    try {
      // แปลงข้อมูลตะกร้าให้อยู่ในรูปแบบ [{ name, quantity }] สำหรับคอลัมน์ jsonb
      const formattedItems = cart.map(({ name, quantity }) => ({
        name,
        quantity,
      }));

      const { error: insertError } = await supabase.from('orders').insert([
        {
          session_id: session.id,
          table_number: Number(tableNumber),
          items: formattedItems,
          status: 'received',
        },
      ]);

      if (insertError) throw insertError;

      // ส่งสำเร็จ -> เคลียร์ตะกร้า ปิดลิ้นชักตะกร้า และแสดงข้อความแจ้งเตือน
      setCart([]);
      setIsCartOpen(false);
      showToast('✅ ส่งออเดอร์แล้ว');
    } catch (err) {
      console.error('Error submitting order:', err);
      setErrorMsg(`ส่งออเดอร์ไม่สำเร็จ: ${err.message}`);
    } finally {
      setSubmittingOrder(false);
    }
  };

  // กดยืนยันเรียกเก็บเงิน (ปิด Session)
  const handleConfirmCheckout = async () => {
    if (!session || closingSession) return;

    setClosingSession(true);
    setErrorMsg('');

    try {
      const { error: updateError } = await supabase
        .from('sessions')
        .update({ status: 'closed' })
        .eq('id', session.id)
        .eq('status', 'open');

      if (updateError) throw updateError;

      setShowBillModal(false);
      setIsCartOpen(false);
      setCart([]);
      setIsCheckedOut(true);
    } catch (err) {
      console.error('Error closing session:', err);
      setErrorMsg(`ไม่สามารถดำเนินการเรียกเก็บเงินได้: ${err.message}`);
      setShowBillModal(false);
    } finally {
      setClosingSession(false);
    }
  };

  // ------------------------------------------------------------------
  // 1. หน้าจอระหว่างกำลังโหลดข้อมูล
  // ------------------------------------------------------------------
  if (loading) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#fafafa',
          fontFamily: 'sans-serif',
          fontSize: '1.25rem',
          color: '#555',
        }}
      >
        กำลังโหลดเมนูโต๊ะ {tableNumber}...
      </main>
    );
  }

  // ------------------------------------------------------------------
  // 2. หน้าจอหลังลูกค้ากดยืนยันเรียกเก็บเงินสำเร็จ
  // ------------------------------------------------------------------
  if (isCheckedOut) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#fff8f8',
          padding: '24px',
          textAlign: 'center',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: '4.5rem', marginBottom: '16px' }}>👻🙏</div>
        <h1 style={{ fontSize: '2rem', color: '#d32f2f', margin: '0 0 12px 0' }}>
          ขอบคุณที่ใช้บริการ
        </h1>
        <p style={{ fontSize: '1.15rem', color: '#555', margin: 0, lineHeight: 1.6 }}>
          สุกี้ผีน้อย ยินดีให้บริการครับ
          <br />
          พนักงานกำลังนำบิลไปที่โต๊ะ {tableNumber}
        </p>
      </main>
    );
  }

  // ------------------------------------------------------------------
  // 3. หน้าจอเมื่อไม่พบ Session ที่เปิดอยู่ของโต๊ะนี้
  // ------------------------------------------------------------------
  if (!session) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#fafafa',
          padding: '24px',
          textAlign: 'center',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: '4rem', marginBottom: '16px' }}>🚫</div>
        <h1
          style={{
            fontSize: '1.65rem',
            color: '#212121',
            margin: '0 0 12px 0',
            lineHeight: 1.4,
          }}
        >
          โต๊ะนี้ยังไม่เปิดใช้งาน กรุณาแจ้งพนักงาน
        </h1>
        <p style={{ fontSize: '1.05rem', color: '#757575', margin: 0 }}>
          (โต๊ะหมายเลข {tableNumber})
        </p>
      </main>
    );
  }

  // กรองเมนูตามหมวดหมู่ที่เลือกอยู่
  const filteredItems = menuItems.filter((item) => item.category_id === selectedCategoryId);

  // คำนวณยอดชำระเงิน
  const adultTotal = (session.adult_count || 0) * 289;
  const childTotal = (session.child_count || 0) * 145;
  const grandTotal = adultTotal + childTotal;

  // ------------------------------------------------------------------
  // 4. หน้าจอสั่งอาหารหลัก
  // ------------------------------------------------------------------
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f5f5f5',
        fontFamily: 'sans-serif',
        paddingBottom: '110px', // เว้นพื้นที่ให้แถบตะกร้าลอยด้านล่าง
      }}
    >
      {/* Header ด้านบน (Sticky) */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          backgroundColor: '#d32f2f',
          color: '#ffffff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        <div
          style={{
            maxWidth: '600px',
            margin: '0 auto',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
              👻 สุกี้ผีน้อย · โต๊ะ {tableNumber}
            </div>
            <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
              ผู้ใหญ่ {session.adult_count} · เด็ก {session.child_count}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowBillModal(true)}
            style={{
              backgroundColor: '#ffffff',
              color: '#d32f2f',
              border: 'none',
              borderRadius: '20px',
              padding: '8px 16px',
              fontSize: '0.95rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
            }}
          >
            💰 เรียกเก็บเงิน
          </button>
        </div>

        {/* แถบแท็บหมวดหมู่อาหาร */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderBottom: '1px solid #e0e0e0',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <div
            style={{
              maxWidth: '600px',
              margin: '0 auto',
              display: 'flex',
              padding: '0 8px',
            }}
          >
            {categories.map((cat) => {
              const isActive = cat.id === selectedCategoryId;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(cat.id)}
                  style={{
                    flex: '1 0 auto',
                    padding: '14px 16px',
                    fontSize: '1rem',
                    fontWeight: isActive ? 'bold' : 'normal',
                    color: isActive ? '#d32f2f' : '#555555',
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderBottom: isActive ? '3px solid #d32f2f' : '3px solid transparent',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Toast แจ้งเตือนด้านบน */}
      {orderToast && (
        <div
          style={{
            position: 'fixed',
            top: '115px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
            backgroundColor: orderToast.startsWith('✅') ? '#2e7d32' : '#323232',
            color: '#ffffff',
            padding: '12px 24px',
            borderRadius: '30px',
            fontSize: '1.05rem',
            fontWeight: 'bold',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            whiteSpace: 'nowrap',
          }}
        >
          {orderToast}
        </div>
      )}

      {/* แจ้ง Error ถ้ามี */}
      {errorMsg && (
        <div
          style={{
            maxWidth: '600px',
            margin: '12px auto 0',
            padding: '12px 16px',
            backgroundColor: '#ffebee',
            color: '#c62828',
            borderRadius: '8px',
            fontWeight: 'bold',
          }}
        >
          ⚠️ {errorMsg}
        </div>
      )}

      {/* รายการเมนูในหมวดที่เลือก */}
      <main style={{ maxWidth: '600px', margin: '0 auto', padding: '16px' }}>
        {filteredItems.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '40px 16px',
              color: '#757575',
              fontSize: '1.1rem',
            }}
          >
            ยังไม่มีรายการอาหารในหมวดนี้
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredItems.map((item) => {
              const qty = getItemQtyInCart(item.id);
              return (
                <div
                  key={item.id}
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '14px',
                    padding: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                    border: qty > 0 ? '2px solid #ffcdd2' : '1px solid #eeeeee',
                  }}
                >
                  <div
                    style={{
                      fontSize: '1.15rem',
                      fontWeight: 'bold',
                      color: '#212121',
                      lineHeight: 1.3,
                    }}
                  >
                    {item.name}
                  </div>

                  {/* ปุ่มควบคุมจำนวน (นิ้วโป้งกดง่าย) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                    {qty > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDecreaseItem(item.id)}
                          aria-label="ลดจำนวน"
                          style={{
                            width: '42px',
                            height: '42px',
                            borderRadius: '50%',
                            border: '2px solid #d32f2f',
                            backgroundColor: '#ffffff',
                            color: '#d32f2f',
                            fontSize: '1.4rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          −
                        </button>
                        <span
                          style={{
                            fontSize: '1.25rem',
                            fontWeight: 'bold',
                            minWidth: '24px',
                            textAlign: 'center',
                            color: '#212121',
                          }}
                        >
                          {qty}
                        </span>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => handleAddItem(item)}
                      disabled={qty >= 5 || totalCartItems >= 10}
                      aria-label="เพิ่มลงตะกร้า"
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        border: 'none',
                        backgroundColor:
                          qty >= 5 || totalCartItems >= 10 ? '#bdbdbd' : '#d32f2f',
                        color: '#ffffff',
                        fontSize: '1.5rem',
                        fontWeight: 'bold',
                        cursor:
                          qty >= 5 || totalCartItems >= 10 ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 5px rgba(211,47,47,0.3)',
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* แถบตะกร้าลอยด้านล่างจอ */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 80,
          backgroundColor: '#ffffff',
          borderTop: '1px solid #e0e0e0',
          padding: '12px 16px',
          boxShadow: '0 -4px 12px rgba(0,0,0,0.08)',
        }}
      >
        <div
          style={{
            maxWidth: '600px',
            margin: '0 auto',
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
          }}
        >
          {/* ปุ่มเปิดดูรายละเอียดในตะกร้า */}
          <button
            type="button"
            onClick={() => totalCartItems > 0 && setIsCartOpen(true)}
            disabled={totalCartItems === 0}
            style={{
              flex: 1,
              padding: '14px 16px',
              borderRadius: '12px',
              border: '2px solid #d32f2f',
              backgroundColor: totalCartItems > 0 ? '#fff5f5' : '#f5f5f5',
              borderColor: totalCartItems > 0 ? '#d32f2f' : '#cccccc',
              color: totalCartItems > 0 ? '#d32f2f' : '#888888',
              fontSize: '1.05rem',
              fontWeight: 'bold',
              cursor: totalCartItems > 0 ? 'pointer' : 'default',
              textAlign: 'left',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>🛒 ตะกร้า ({totalCartItems}/10)</span>
            {totalCartItems > 0 && <span style={{ fontSize: '0.85rem' }}>ดูรายการ ▲</span>}
          </button>

          {/* ปุ่มส่งออเดอร์ทันที */}
          <button
            type="button"
            onClick={handleSubmitOrder}
            disabled={totalCartItems === 0 || submittingOrder}
            style={{
              padding: '14px 22px',
              borderRadius: '12px',
              border: 'none',
              backgroundColor:
                totalCartItems === 0 || submittingOrder ? '#bdbdbd' : '#2e7d32',
              color: '#ffffff',
              fontSize: '1.1rem',
              fontWeight: 'bold',
              cursor:
                totalCartItems === 0 || submittingOrder ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {submittingOrder ? 'กำลังส่ง...' : 'ส่งออเดอร์'}
          </button>
        </div>
      </div>

      {/* Bottom Sheet แสดงรายการในตะกร้าแบบละเอียด */}
      {isCartOpen && (
        <div
          onClick={() => setIsCartOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.55)',
            zIndex: 120,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#ffffff',
              width: '100%',
              maxWidth: '600px',
              borderTopLeftRadius: '20px',
              borderTopRightRadius: '20px',
              padding: '20px 16px 24px',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid #eeeeee',
                paddingBottom: '12px',
                marginBottom: '12px',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '1.3rem', color: '#212121' }}>
                รายการที่เลือก ({totalCartItems}/10 รายการ)
              </h2>
              <button
                type="button"
                onClick={() => setIsCartOpen(false)}
                style={{
                  background: '#eeeeee',
                  border: 'none',
                  borderRadius: '50%',
                  width: '36px',
                  height: '36px',
                  fontSize: '1.2rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, marginBottom: '16px' }}>
              {cart.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom: '1px solid #f0f0f0',
                  }}
                >
                  <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#212121' }}>
                    {item.name}
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      type="button"
                      onClick={() => handleDecreaseItem(item.id)}
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '50%',
                        border: '2px solid #d32f2f',
                        backgroundColor: '#fff',
                        color: '#d32f2f',
                        fontSize: '1.3rem',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                      }}
                    >
                      −
                    </button>
                    <span style={{ fontSize: '1.2rem', fontWeight: 'bold', minWidth: '22px', textAlign: 'center' }}>
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAddItem(item)}
                      disabled={item.quantity >= 5 || totalCartItems >= 10}
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '50%',
                        border: 'none',
                        backgroundColor:
                          item.quantity >= 5 || totalCartItems >= 10 ? '#bdbdbd' : '#d32f2f',
                        color: '#fff',
                        fontSize: '1.3rem',
                        fontWeight: 'bold',
                        cursor:
                          item.quantity >= 5 || totalCartItems >= 10 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleSubmitOrder}
              disabled={submittingOrder || totalCartItems === 0}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: submittingOrder ? '#9e9e9e' : '#2e7d32',
                color: '#ffffff',
                fontSize: '1.25rem',
                fontWeight: 'bold',
                cursor: submittingOrder ? 'not-allowed' : 'pointer',
              }}
            >
              {submittingOrder ? 'กำลังส่งออเดอร์...' : `ยืนยันส่งออเดอร์ (${totalCartItems} รายการ)`}
            </button>
          </div>
        </div>
      )}

      {/* Modal ยืนยันการเรียกเก็บเงิน */}
      {showBillModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            zIndex: 150,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '18px',
              padding: '24px 20px',
              maxWidth: '420px',
              width: '100%',
              boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            }}
          >
            <h2
              style={{
                margin: '0 0 16px 0',
                fontSize: '1.45rem',
                color: '#212121',
                textAlign: 'center',
              }}
            >
              💰 สรุปยอดชำระเงิน โต๊ะ {tableNumber}
            </h2>

            <div
              style={{
                backgroundColor: '#f8f9fa',
                padding: '16px',
                borderRadius: '12px',
                marginBottom: '20px',
                fontSize: '1.1rem',
                lineHeight: 1.8,
                color: '#333',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>ผู้ใหญ่ ({session.adult_count} × 289 บาท)</span>
                <strong>{adultTotal.toLocaleString()} บาท</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>เด็ก ({session.child_count} × 145 บาท)</span>
                <strong>{childTotal.toLocaleString()} บาท</strong>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid #ddd', margin: '10px 0' }} />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '1.35rem',
                  color: '#d32f2f',
                }}
              >
                <strong>ยอดสุทธิ</strong>
                <strong>{grandTotal.toLocaleString()} บาท</strong>
              </div>
            </div>

            <p
              style={{
                fontSize: '0.95rem',
                color: '#666',
                textAlign: 'center',
                margin: '0 0 20px 0',
              }}
            >
              เมื่อกดยืนยันแล้ว ระบบจะปิดโต๊ะและไม่สามารถสั่งอาหารเพิ่มได้อีก
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <button
                type="button"
                disabled={closingSession}
                onClick={() => setShowBillModal(false)}
                style={{
                  padding: '14px',
                  borderRadius: '12px',
                  border: 'none',
                  backgroundColor: '#e0e0e0',
                  color: '#212121',
                  fontSize: '1.1rem',
                  fontWeight: 'bold',
                  cursor: closingSession ? 'not-allowed' : 'pointer',
                }}
              >
                ยกเลิก
              </button>

              <button
                type="button"
                disabled={closingSession}
                onClick={handleConfirmCheckout}
                style={{
                  padding: '14px',
                  borderRadius: '12px',
                  border: 'none',
                  backgroundColor: closingSession ? '#9e9e9e' : '#d32f2f',
                  color: '#ffffff',
                  fontSize: '1.1rem',
                  fontWeight: 'bold',
                  cursor: closingSession ? 'not-allowed' : 'pointer',
                }}
              >
                {closingSession ? 'กำลังดำเนินการ...' : 'ยืนยันเช็กบิล'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
