import type { Activity, Client, FollowUp, Need, Property } from '../../types';
import { addDaysISO, todayISO } from '../utils/date';

const M = 1e6;
const B = 1e9;
const day = 86400000;

function prop(id: string, o: Partial<Property> & Pick<Property, 'title' | 'transactionType' | 'propertyType'>, ageDays: number): Property {
  const t = Date.now() - ageDays * day;
  return {
    id, area: null, bedrooms: null, location: '', neighborhood: '', price: null, deposit: null, rent: null,
    floor: null, totalFloors: null, parking: null, elevator: null, storage: null, description: '',
    contactName: '', contactPhone: '', createdAt: t, updatedAt: t, ...o,
  };
}
function client(id: string, name: string, phone: string, tags: string[], notes: string, ageDays: number): Client {
  const t = Date.now() - ageDays * day;
  return { id, name, phone, tags, notes, createdAt: t, updatedAt: t };
}
function need(id: string, clientId: string, o: Partial<Need> & Pick<Need, 'transactionType'>, ageDays: number): Need {
  const t = Date.now() - ageDays * day;
  return {
    id, clientId, propertyType: null, minArea: null, maxArea: null, bedrooms: null, location: '',
    maxPrice: null, maxDeposit: null, maxRent: null, notes: '', createdAt: t, updatedAt: t, ...o,
  };
}

export interface DemoData { properties: Property[]; clients: Client[]; needs: Need[]; followUps: FollowUp[]; activities: Activity[] }

/** Pure builder (no storage): realistic Persian demo records, dates relative to `today`. */
export function buildDemoData(today: string = todayISO()): DemoData {
  const properties: Property[] = [
    prop('demo-p1', { title: 'آپارتمان ۸۵ متری ۲ خوابه ولیعصر', transactionType: 'rent', propertyType: 'apartment', area: 85, bedrooms: 2, location: 'ولیعصر', deposit: 500 * M, rent: 15 * M, floor: 3, totalFloors: 5, parking: true, elevator: true, storage: true, description: 'نوساز، نورگیر عالی، آماده تحویل.', contactName: 'آقای کریمی', contactPhone: '09121110001' }, 1),
    prop('demo-p2', { title: 'آپارتمان ۱۲۰ متری ۳ خوابه سعادت‌آباد', transactionType: 'sale', propertyType: 'apartment', area: 120, bedrooms: 3, location: 'سعادت‌آباد', price: 11.4 * B, floor: 4, totalFloors: 7, parking: true, elevator: true, storage: true, description: 'سند تک‌برگ، بازسازی‌شده.', contactName: 'خانم رحیمی', contactPhone: '09121110002' }, 2),
    prop('demo-p3', { title: 'آپارتمان ۶۵ متری ۱ خوابه پونک', transactionType: 'rent', propertyType: 'apartment', area: 65, bedrooms: 1, location: 'پونک', deposit: 300 * M, rent: 9 * M, floor: 2, totalFloors: 4, parking: true, elevator: false, description: 'مناسب زوج یا مجرد.', contactName: 'آقای صالحی', contactPhone: '09121110003' }, 3),
    prop('demo-p4', { title: 'آپارتمان ۹۵ متری ۲ خوابه ولیعصر', transactionType: 'sale', propertyType: 'apartment', area: 95, bedrooms: 2, location: 'ولیعصر', price: 8.9 * B, floor: 5, totalFloors: 6, parking: true, elevator: true, contactName: 'آقای امیری', contactPhone: '09121110004' }, 4),
    prop('demo-p5', { title: 'آپارتمان ۱۱۰ متری ۲ خوابه شهرک غرب', transactionType: 'rent', propertyType: 'apartment', area: 110, bedrooms: 2, location: 'شهرک غرب', deposit: 700 * M, rent: 25 * M, floor: 6, totalFloors: 9, parking: true, elevator: true, storage: true, contactName: 'خانم نوری', contactPhone: '09121110005' }, 5),
    prop('demo-p6', { title: 'خانه ویلایی ۲۰۰ متری نیاوران', transactionType: 'sale', propertyType: 'house', area: 200, bedrooms: 4, location: 'نیاوران', price: 38 * B, parking: true, description: 'حیاط‌دار، دو نبش.', contactName: 'آقای فرهادی', contactPhone: '09121110006' }, 6),
    prop('demo-p7', { title: 'دفتر ۷۰ متری ونک', transactionType: 'rent', propertyType: 'office', area: 70, location: 'ونک', deposit: 400 * M, rent: 18 * M, floor: 7, totalFloors: 10, parking: true, elevator: true, contactName: 'آقای حیدری', contactPhone: '09121110007' }, 7),
    prop('demo-p8', { title: 'مغازه ۳۵ متری تجریش', transactionType: 'sale', propertyType: 'shop', area: 35, location: 'تجریش', price: 14 * B, contactName: 'خانم قاسمی', contactPhone: '09121110008' }, 8),
    prop('demo-p9', { title: 'آپارتمان ۹۲ متری ۲ خوابه ولیعصر', transactionType: 'rent', propertyType: 'apartment', area: 92, bedrooms: 2, location: 'ولیعصر', deposit: 650 * M, rent: 12 * M, floor: 2, totalFloors: 5, parking: true, elevator: false, contactName: 'آقای توکلی', contactPhone: '09121110009' }, 9),
    prop('demo-p10', { title: 'زمین ۳۰۰ متری لواسان', transactionType: 'sale', propertyType: 'land', area: 300, location: 'لواسان', price: 21 * B, description: 'مجوز ساخت دارد.', contactName: 'آقای سلیمانی', contactPhone: '09121110010' }, 10),
  ];
  const clients: Client[] = [
    client('demo-c1', 'مریم احمدی', '09121234501', ['مستأجر', 'فوری'], 'دنبال خانه نزدیک مترو است؛ ماه آینده اسباب‌کشی می‌کند.', 6),
    client('demo-c2', 'علی رضایی', '09121234502', ['خریدار'], 'خانواده سه‌نفره؛ پیش‌پرداخت آماده است.', 5),
    client('demo-c3', 'سارا محمدی', '09121234503', ['مستأجر'], 'مجرد، شاغل در منطقه غرب تهران.', 4),
    client('demo-c4', 'حسین نوری', '09121234504', ['دفتر کار'], 'استارتاپ کوچک، ۶ نفره.', 3),
    client('demo-c5', 'نگین صادقی', '09121234505', ['خریدار', 'سرمایه‌گذار'], 'ملک ویلایی برای سکونت دائم.', 2),
  ];
  const needs: Need[] = [
    need('demo-n1', 'demo-c1', { transactionType: 'rent', propertyType: 'apartment', minArea: 80, maxArea: 100, bedrooms: 2, location: 'ولیعصر', maxDeposit: 600 * M, maxRent: 20 * M }, 6),
    need('demo-n2', 'demo-c2', { transactionType: 'sale', propertyType: 'apartment', minArea: 100, maxArea: 140, bedrooms: 3, location: 'سعادت‌آباد', maxPrice: 13 * B }, 5),
    need('demo-n3', 'demo-c2', { transactionType: 'sale', propertyType: 'apartment', minArea: 80, maxArea: 100, bedrooms: 2, location: 'ولیعصر', maxPrice: 9 * B, notes: 'گزینه دوم برای سرمایه‌گذاری' }, 5),
    need('demo-n4', 'demo-c3', { transactionType: 'rent', propertyType: 'apartment', minArea: 55, maxArea: 75, bedrooms: 1, location: 'پونک', maxDeposit: 350 * M, maxRent: 10 * M }, 4),
    need('demo-n5', 'demo-c4', { transactionType: 'rent', propertyType: 'office', minArea: 50, maxArea: 90, location: 'ونک', maxDeposit: 500 * M, maxRent: 20 * M }, 3),
    need('demo-n6', 'demo-c5', { transactionType: 'sale', propertyType: 'house', minArea: 150, maxArea: 250, location: 'نیاوران', maxPrice: 40 * B }, 2),
  ];
  const fu = (id: string, title: string, clientId: string, propertyId: string | null, dueDate: string, status: FollowUp['status'], notes = ''): FollowUp => ({
    id, title, clientId, propertyId, dueDate, status, notes, createdAt: Date.now() - day, updatedAt: Date.now() - day,
  });
  const followUps: FollowUp[] = [
    fu('demo-f1', 'تماس با مریم احمدی و ارسال فایل ولیعصر', 'demo-c1', 'demo-p1', today, 'pending'),
    fu('demo-f2', 'هماهنگی بازدید آپارتمان سعادت‌آباد', 'demo-c2', 'demo-p2', today, 'pending'),
    fu('demo-f3', 'پیگیری نظر سارا محمدی درباره فایل پونک', 'demo-c3', 'demo-p3', addDaysISO(today, 1), 'pending'),
    fu('demo-f4', 'ارسال مشخصات دفتر ونک', 'demo-c4', 'demo-p7', addDaysISO(today, -1), 'pending'),
    fu('demo-f5', 'تماس اولیه با نگین صادقی', 'demo-c5', null, addDaysISO(today, -2), 'completed'),
  ];
  const now = Date.now();
  const activities: Activity[] = [
    { id: 'demo-a1', type: 'property', text: 'فایل جدید ثبت شد: آپارتمان ۸۵ متری ۲ خوابه ولیعصر', createdAt: now - 3600e3 },
    { id: 'demo-a2', type: 'need', text: 'نیاز جدید ثبت شد برای مریم احمدی', createdAt: now - 5 * 3600e3 },
    { id: 'demo-a3', type: 'client', text: 'مشتری جدید ثبت شد: نگین صادقی', createdAt: now - 26 * 3600e3 },
    { id: 'demo-a4', type: 'followup', text: 'پیگیری انجام شد: تماس اولیه با نگین صادقی', createdAt: now - 30 * 3600e3 },
    { id: 'demo-a5', type: 'property', text: 'فایل جدید ثبت شد: دفتر ۷۰ متری ونک', createdAt: now - 7 * day },
  ];

  return { properties, clients, needs, followUps, activities };
}
