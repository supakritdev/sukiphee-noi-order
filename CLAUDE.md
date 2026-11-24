# สุกี้ผีน้อย (Suki Phi Noi) - Project Guidelines & Architecture

## Tech Stack
- **Framework:** Next.js (App Router, **JavaScript only** — ห้ามใช้ TypeScript)
- **Database & Realtime:** Supabase (`@supabase/supabase-js`)
- **Deployment:** Vercel

## Important Next.js Version Rules
- โปรเจกต์นี้ใช้ **Next.js เวอร์ชันล่าสุด (Next.js 15+ / React 19)**
- **Dynamic Route `params` และ `searchParams` เป็น Promise เสมอ**
  - ใน Client Component (`'use client'`) ต้อง unwrap `params` ด้วย `use()` จาก React เสมอ เช่น:
    ```javascript
    'use client';
    import { use } from 'react';

    export default function OrderPage({ params }) {
      const { sessionId } = use(params);
      // ...
    }
    ```
  - ใน Server Component ต้องใช้ `await params` ก่อนเข้าถึงค่าเสมอ

## Environment Variables
ตั้งค่าใน `.env.local` (สำหรับรันในเครื่อง) และใน Vercel Project Settings:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Database Schema Reference (Supabase)
ตารางที่มีอยู่แล้วในฐานข้อมูล (ห้ามแก้ไขชื่อคอลัมน์):
1. `sessions`
   - `id` (uuid / primary key)
   - `table_number` (text / int)
   - `adult_count` (int)
   - `child_count` (int)
   - `status` (text — เช่น `'active'`, `'closed'`)
   - `created_at` (timestamptz)
2. `menu_categories`
   - `id` (uuid / int)
   - `name` (text)
   - `sort_order` (int)
3. `menu_items`
   - `id` (uuid / int)
   - `category_id` (foreign key -> `menu_categories.id`)
   - `name` (text)
4. `orders`
   - `id` (uuid / primary key)
   - `session_id` (foreign key -> `sessions.id`)
   - `table_number` (text / int)
   - `items` (jsonb — เก็บรายการอาหารที่สั่งในรอบนั้น)
   - `status` (text — เช่น `'pending'`, `'served'`)
   - `created_at` (timestamptz)
