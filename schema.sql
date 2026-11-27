-- ============================================
-- SOLA BARBER SHOP - Neon Postgres Schema
-- ============================================

CREATE TABLE IF NOT EXISTS bookings (
  id VARCHAR(20) PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  services TEXT NOT NULL,
  total_price VARCHAR(20),
  day DATE NOT NULL,
  time VARCHAR(5) NOT NULL,
  status VARCHAR(20) DEFAULT 'confirmed',
  day_label VARCHAR(100)
);

-- قيد فريد: يمنع حجزين مؤكدين في نفس اليوم والساعة
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_slot
  ON bookings(day, time) WHERE status = 'confirmed';

-- فهرس للبحث عن حجوزات رقم هاتف
CREATE INDEX IF NOT EXISTS idx_bookings_phone
  ON bookings(phone) WHERE status = 'confirmed';

-- فهرس للبحث عن حجوزات يوم معين
CREATE INDEX IF NOT EXISTS idx_bookings_day
  ON bookings(day) WHERE status = 'confirmed';
