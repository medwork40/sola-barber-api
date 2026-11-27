// SOLA BARBER SHOP API - CommonJS Version
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const SLOTS = ['11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'];

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function ok(res, obj, code = 200) {
  cors(res);
  res.status(code).json(obj);
}

function tzNow() {
  try {
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Casablanca',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    const g = t => (p.find(x => x.type === t) || {}).value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour')}:${g('minute')}` };
  } catch (e) {
    const d = new Date();
    return {
      date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
      hm: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    };
  }
}

function pastSlot(day, time, now) {
  now = now || tzNow();
  if (day < now.date) return true;
  if (day > now.date) return false;
  return time <= now.hm;
}

function normPhone(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.startsWith('00212')) d = d.substring(5);
  else if (d.startsWith('212') && d.length > 9) d = d.substring(3);
  return d.length > 9 ? d.substring(d.length - 9) : d;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function sendTg(html) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: html, parse_mode: 'HTML' })
    });
    return r.ok;
  } catch (e) { return false; }
}

async function getStats() {
  const now = tzNow();
  const [tot, cli, tod, rows] = await Promise.all([
    sql`SELECT COUNT(*)::int AS c FROM bookings WHERE status = 'confirmed'`,
    sql`SELECT COUNT(DISTINCT phone)::int AS c FROM bookings WHERE status = 'confirmed'`,
    sql`SELECT COUNT(*)::int AS c FROM bookings WHERE status = 'confirmed' AND day = ${now.date}::date`,
    sql`SELECT time FROM bookings WHERE status = 'confirmed' AND day = ${now.date}::date`
  ]);
  const times = rows.map(r => r.time);
  let free = 0;
  SLOTS.forEach(t => { if (!times.includes(t) && !pastSlot(now.date, t, now)) free++; });
  return { success: true, total: tot[0].c, clients: cli[0].c, today: tod[0].c, availableToday: free, slotsToday: SLOTS.length };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const path = (req.url || '/').split('?')[0].replace(/^\/api/, '') || '/';
  const query = Object.fromEntries(new URLSearchParams((req.url || '').split('?')[1] || ''));

  try {
    if (path === '/' || path === '' || path === '/ping') {
      return ok(res, { success: true, message: 'pong', service: 'sola-barber-api' });
    }

    if (path === '/stats') {
      return ok(res, await getStats());
    }

    if (path === '/availability') {
      const day = String(query.day || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        return ok(res, { success: false, bookedTimes: [], pastTimes: [] });
      }
      const rows = await sql`SELECT time FROM bookings WHERE day = ${day}::date AND status = 'confirmed'`;
      const now = tzNow();
      const past = (day <= now.date) ? SLOTS.filter(t => pastSlot(day, t, now)) : [];
      return ok(res, { success: true, day, bookedTimes: rows.map(r => r.time), pastTimes: past });
    }

    if (path === '/mybooking') {
      const phone = normPhone(String(query.phone || ''));
      if (phone.length < 9) return ok(res, { success: false, activeBooking: null });
      const now = tzNow();
      const rows = await sql`
        SELECT id, name, phone, services, COALESCE(total_price,'') AS total,
               TO_CHAR(day,'YYYY-MM-DD') AS day, time, COALESCE(day_label,'') AS "dayLabel"
        FROM bookings WHERE phone = ${phone} AND status = 'confirmed'
          AND (day > ${now.date}::date OR (day = ${now.date}::date AND time > ${now.hm}))
        ORDER BY day, time LIMIT 1`;
      return ok(res, { success: true, activeBooking: rows[0] || null });
    }

    if (path === '/cancel') {
      const id = String(query.bookingId || '').trim();
      const phone = normPhone(String(query.phone || ''));
      if (!id || !phone) return ok(res, { success: false, message: 'يرجى إدخال رقم الحجز ورقم الهاتف.' });
      const upd = await sql`
        UPDATE bookings SET status = 'cancelled'
        WHERE id = ${id} AND phone = ${phone} AND status = 'confirmed'
        RETURNING id, name, services, TO_CHAR(day,'YYYY-MM-DD') AS day, time`;
      if (!upd.length) {
        const ex = await sql`SELECT status FROM bookings WHERE id = ${id} AND phone = ${phone} LIMIT 1`;
        if (ex.length && ex[0].status === 'cancelled') return ok(res, { success: false, message: 'ملغي مسبقاً.' });
        return ok(res, { success: false, message: 'لم يتم العثور على الحجز.' });
      }
      const b = upd[0];
      await sendTg('❌ <b>تم إلغاء حجز</b>\n🆔 <code>'+esc(b.id)+'</code>\n👤 '+esc(b.name)+'\n💈 '+esc(b.services)+'\n📅 '+esc(b.day)+' 🕐 '+esc(b.time));
      return ok(res, { success: true, message: 'تم الإلغاء' });
    }

    if (path === '/book') {
      if (req.method !== 'POST') return ok(res, { success: false, message: 'POST فقط' }, 405);
      const d = req.body || {};
      const name = String(d.name || '').trim();
      const phone = normPhone(String(d.phone || ''));
      const services = String(d.services || '').trim();
      const day = String(d.day || '').trim();
      const dayLabel = String(d.dayLabel || '').trim();
      const time = String(d.time || '').trim();
      const total = (d.totalPrice == null || d.totalPrice === '') ? '' : String(d.totalPrice);

      if (!name || !phone || !services || !day || !time) return ok(res, { success: false, message: 'أكمل البيانات.' });
      if (phone.length < 9) return ok(res, { success: false, message: 'رقم الهاتف غير صحيح.' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return ok(res, { success: false, message: 'تاريخ غير صالح.' });
      if (!SLOTS.includes(time)) return ok(res, { success: false, message: 'الساعة خارج أوقات العمل.' });

      const now = tzNow();
      const active = await sql`
        SELECT id, name, phone, services, COALESCE(total_price,'') AS total,
               TO_CHAR(day,'YYYY-MM-DD') AS day, time, COALESCE(day_label,'') AS "dayLabel"
        FROM bookings WHERE phone = ${phone} AND status = 'confirmed'
          AND (day > ${now.date}::date OR (day = ${now.date}::date AND time > ${now.hm}))
        LIMIT 1`;
      if (active.length) return ok(res, { success: false, code: 'ACTIVE', message: 'لديك حجز قائم.', activeBooking: active[0] });

      const bookedRows = await sql`SELECT time FROM bookings WHERE day = ${day}::date AND status = 'confirmed'`;
      const bookedTimes = bookedRows.map(r => r.time);
      const pastTimes = (day <= now.date) ? SLOTS.filter(t => pastSlot(day, t, now)) : [];

      if (pastSlot(day, time, now)) return ok(res, { success: false, code: 'PAST', message: 'الوقت انتهى.', bookedTimes, pastTimes });
      if (bookedTimes.includes(time)) return ok(res, { success: false, code: 'TAKEN', message: 'محجوز مسبقاً.', bookedTimes, pastTimes });

      let id = '';
      for (let k = 0; k < 50; k++) {
        const cand = 'SOLA-' + Math.floor(1000 + Math.random() * 9000);
        const ex = await sql`SELECT 1 FROM bookings WHERE id = ${cand} LIMIT 1`;
        if (!ex.length) { id = cand; break; }
      }
      if (!id) id = 'SOLA-' + String(Date.now()).slice(-6);

      try {
        await sql`INSERT INTO bookings (id, name, phone, services, total_price, day, time, status, day_label)
          VALUES (${id}, ${name}, ${phone}, ${services}, ${total ? total + ' DH' : ''}, ${day}::date, ${time}, 'confirmed', ${dayLabel})`;
      } catch (e) {
        if (e.code === '23505') return ok(res, { success: false, code: 'TAKEN', message: 'محجوز مسبقاً.', bookedTimes, pastTimes });
        throw e;
      }

      await sendTg('🔔 <b>حجز جديد</b>\n🆔 <code>'+esc(id)+'</code>\n👤 '+esc(name)+'\n📱 '+esc(phone)+'\n💈 '+esc(services)+'\n📅 '+esc(day)+' 🕐 '+esc(time));
      const st = await getStats();
      return ok(res, { success: true, bookingId: id, message: 'تم الحجز', stats: st });
    }

    ok(res, { success: false, message: 'Endpoint غير موجود: ' + path }, 404);
  } catch (err) {
    console.error(err);
    ok(res, { success: false, message: 'خطأ: ' + (err && err.message) }, 500);
  }
}
