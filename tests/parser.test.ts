import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePropertyTextSync } from '../src/lib/parser';
import { parseMoneyAt } from '../src/lib/parser/money';
import { normalizeText, toLatinDigits, toPersianDigits, formatToman, normalizeIranMobile } from '../src/lib/utils/persian';
import { gregorianToJalali } from '../src/lib/utils/date';
import { matchesQuery } from '../src/lib/utils/search';

test('digit + letter normalization', () => {
  assert.equal(toLatinDigits('۸۵ و ٢٣'), '85 و 23');
  assert.equal(toPersianDigits(120), '۱۲۰');
  assert.equal(normalizeText('كيان ۲/۵'), 'کیان 2.5');
  assert.equal(normalizeText('۱,۵۰۰,۰۰۰'), '1500000');
});

test('money formatting and mobile normalization', () => {
  assert.equal(formatToman(500e6), '۵۰۰ میلیون تومان');
  assert.equal(formatToman(12.5e9), '۱۲ میلیارد و ۵۰۰ میلیون تومان');
  assert.equal(formatToman(null), '—');
  assert.equal(normalizeIranMobile('+98 912 123 4567'), '09121234567');
  assert.equal(normalizeIranMobile('12345'), null);
});

test('money parsing', () => {
  assert.deepEqual(pick(parseMoneyAt('500', 0)), { value: 500e6, assumed: true });
  assert.deepEqual(pick(parseMoneyAt('2.5 میلیارد', 0)), { value: 2.5e9, assumed: false });
  assert.deepEqual(pick(parseMoneyAt('2 میلیارد و 500 میلیون', 0)), { value: 2.5e9, assumed: false });
  assert.deepEqual(pick(parseMoneyAt('2 میلیارد و 500', 0)), { value: 2.5e9, assumed: true });
  assert.deepEqual(pick(parseMoneyAt('1500000', 0)), { value: 1500000, assumed: false });
  assert.deepEqual(pick(parseMoneyAt('50 میلیون و 2 خواب', 0)), { value: 50e6, assumed: false });
  assert.equal(parseMoneyAt('سلام', 0), null);
});
function pick(m: ReturnType<typeof parseMoneyAt>) { return m && { value: m.value, assumed: m.assumed }; }

test('canonical demo sentence', () => {
  const r = parsePropertyTextSync('۸۵ متر دو خواب ولیعصر رهن ۵۰۰ اجاره ۱۵');
  assert.equal(r.draft.area, 85);
  assert.equal(r.draft.bedrooms, 2);
  assert.equal(r.draft.location, 'ولیعصر');
  assert.equal(r.draft.deposit, 500e6);
  assert.equal(r.draft.rent, 15e6);
  assert.equal(r.draft.transactionType, 'rent');
  assert.equal(r.draft.price, null);
  assert.equal(r.draft.parking, null); // unknown stays unknown
  assert.equal(r.draft.propertyType, null);
  assert.equal(r.assumptions.length, 2); // both money units are disclosed
});

test('sale listing with amenities and phone', () => {
  const r = parsePropertyTextSync(
    'آپارتمان ۱۲۰ متری ۳ خوابه سعادت‌آباد فروش ۱۲ میلیارد و ۵۰۰ میلیون طبقه ۴ از ۶ پارکینگ آسانسور بدون انباری آقای احمدی ۰۹۱۲-۱۲۳-۴۵۶۷');
  const d = r.draft;
  assert.equal(d.transactionType, 'sale');
  assert.equal(d.propertyType, 'apartment');
  assert.equal(d.area, 120);
  assert.equal(d.bedrooms, 3);
  assert.equal(d.location, 'سعادت‌آباد');
  assert.equal(d.price, 12.5e9);
  assert.equal(d.floor, 4);
  assert.equal(d.totalFloors, 6);
  assert.equal(d.parking, true);
  assert.equal(d.elevator, true);
  assert.equal(d.storage, false);
  assert.equal(d.contactPhone, '09121234567');
  assert.equal(d.contactName, 'آقای احمدی');
  assert.equal(r.assumptions.length, 0);
});

test('slash-separated combined rent keyword', () => {
  const r = parsePropertyTextSync('۷۰ متر یک خواب پونک رهن و اجاره ۳۰۰/۸');
  assert.equal(r.draft.deposit, 300e6);
  assert.equal(r.draft.rent, 8e6);
  assert.equal(r.draft.transactionType, 'rent');
});

test('nothing is invented', () => {
  const r = parsePropertyTextSync('سلام');
  assert.deepEqual(r.extracted, []);
  assert.equal(r.draft.area, null);
  assert.equal(r.draft.location, '');
  const r2 = parsePropertyTextSync('رهن کامل ۲ خواب');
  assert.equal(r2.draft.deposit, null);
  assert.equal(r2.draft.transactionType, 'rent');
  assert.equal(r2.draft.bedrooms, 2);
  assert.equal(parsePropertyTextSync('').draft.area, null);
});

test('explicit negation of amenities', () => {
  const r = parsePropertyTextSync('۶۰ متر بدون آسانسور پارکینگ ندارد');
  assert.equal(r.draft.elevator, false);
  assert.equal(r.draft.parking, false);
});

test('Jalali conversion and search helper', () => {
  assert.deepEqual(gregorianToJalali(2025, 3, 21), { jy: 1404, jm: 1, jd: 1 });
  assert.deepEqual(gregorianToJalali(2024, 3, 20), { jy: 1403, jm: 1, jd: 1 });
  assert.ok(matchesQuery(['ولیعصر', '۰۹۱۲۱۲۳۴۵۶۷'], 'وليعصر 0912'));
  assert.ok(!matchesQuery(['پونک'], 'ولیعصر'));
});
