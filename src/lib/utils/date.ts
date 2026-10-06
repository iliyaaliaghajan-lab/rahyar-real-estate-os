import { toPersianDigits } from './persian';

const MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

/** Gregorian → Jalali (standard algorithm). */
export function gregorianToJalali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + days));
}

function toJalaliParts(value: string | number | Date) {
  if (typeof value === 'string') {
    const [y, m, d] = value.split('-').map(Number);
    return gregorianToJalali(y, m, d);
  }
  const d = new Date(value);
  return gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** "YYYY-MM-DD" | Date | epoch ms → "۱۴۰۵/۰۷/۱۴" */
export function formatJalali(value: string | number | Date): string {
  const { jy, jm, jd } = toJalaliParts(value);
  return toPersianDigits(`${jy}/${pad(jm)}/${pad(jd)}`);
}
/** → "۱۴ مهر ۱۴۰۵" */
export function formatJalaliLong(value: string | number | Date): string {
  const { jy, jm, jd } = toJalaliParts(value);
  return `${toPersianDigits(jd)} ${MONTHS[jm - 1]} ${toPersianDigits(jy)}`;
}

/** Relative label for a due date: امروز / فردا / ۲ روز پیش ... */
export function relativeDayLabel(iso: string, today: string = todayISO()): string {
  const diff = Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  if (diff === 0) return 'امروز';
  if (diff === 1) return 'فردا';
  if (diff === -1) return 'دیروز';
  if (diff > 1) return `${toPersianDigits(diff)} روز دیگر`;
  return `${toPersianDigits(-diff)} روز پیش`;
}

export function timeAgo(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'همین الان';
  const m = Math.round(s / 60);
  if (m < 60) return `${toPersianDigits(m)} دقیقه پیش`;
  const h = Math.round(m / 60);
  if (h < 24) return `${toPersianDigits(h)} ساعت پیش`;
  const d = Math.round(h / 24);
  if (d < 30) return `${toPersianDigits(d)} روز پیش`;
  return formatJalali(ts);
}
