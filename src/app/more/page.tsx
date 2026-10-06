'use client';
import Link from 'next/link';
import { useState } from 'react';
import { clearAllData, exportAllData, resetToDemoData } from '@/lib/db/maintenance';
import { Button, Callout, Card, PageHeader, Section } from '@/components/ui';
import { SearchIcon } from '@/components/icons';

export default function MorePage() {
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function run(fn: () => Promise<void>, ok: string) {
    try { await fn(); setMsg({ tone: 'success', text: ok }); } catch { setMsg({ tone: 'error', text: 'عملیات انجام نشد.' }); }
  }
  async function backup() {
    const blob = new Blob([await exportAllData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `rahyar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg({ tone: 'success', text: 'نسخه پشتیبان دانلود شد.' });
  }

  return (
    <>
      <PageHeader title="بیشتر" />
      <Section>
        <Link href="/search/" className="block"><Card className="flex items-center gap-3 p-4 hover:border-brand-200"><SearchIcon /><span className="font-medium">جستجو در فایل‌ها و مشتریان</span></Card></Link>
      </Section>
      {msg && <div className="px-4"><Callout tone={msg.tone}>{msg.text}</Callout></div>}
      <Section title="داده‌ها">
        <Card className="space-y-3 p-4">
          <p className="text-sm leading-7 text-slate-600">همه اطلاعات فقط روی همین دستگاه (در مرورگر) ذخیره می‌شود و بدون اینترنت هم کار می‌کند. پاک کردن داده‌های مرورگر، اطلاعات را حذف می‌کند؛ پس نسخه پشتیبان بگیرید.</p>
          <Button variant="secondary" className="w-full" onClick={backup}>دانلود نسخه پشتیبان (JSON)</Button>
          <Button variant="secondary" className="w-full" onClick={() => { if (window.confirm('همه داده‌های فعلی با داده‌های نمونه جایگزین شود؟')) run(resetToDemoData, 'داده‌های نمونه بازگردانی شد.'); }}>بازگردانی داده‌های نمونه</Button>
          <Button variant="danger" className="w-full" onClick={() => { if (window.confirm('همه فایل‌ها، مشتریان، نیازها و پیگیری‌ها برای همیشه حذف شود؟')) run(clearAllData, 'همه داده‌ها حذف شد.'); }}>حذف همه داده‌ها</Button>
        </Card>
      </Section>
      <Section title="درباره">
        <Card className="space-y-1 p-4 text-sm text-slate-600">
          <p>رهیار — نسخه MVP ۰٫۱</p>
          <p>تحلیل متن و تطبیق، قانون‌محور و محلی است؛ هیچ داده‌ای به سرور یا سرویس هوش مصنوعی ارسال نمی‌شود.</p>
        </Card>
      </Section>
    </>
  );
}
