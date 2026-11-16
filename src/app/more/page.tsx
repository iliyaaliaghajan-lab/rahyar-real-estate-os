'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { clearAllData, exportAllData, resetToDemoData } from '@/lib/db/maintenance';
import {
  atomicReplaceRestore,
  buildRestorePreview,
  validateBackupInput,
  type RestorePreview,
} from '@/lib/db/backup';
import { Button, Callout, Card, PageHeader, Section } from '@/components/ui';
import { SearchIcon, UsersIcon } from '@/components/icons';

type Msg = { tone: 'success' | 'error' | 'info'; text: string };

export default function MorePage() {
  const [msg, setMsg] = useState<Msg | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [normalizedBackup, setNormalizedBackup] = useState<
    import('@/lib/db/backup').ValidationResult['normalized']
  >(null);
  const [ackedCurrentBackup, setAckedCurrentBackup] = useState(false);
  const [finalConfirm, setFinalConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function run(fn: () => Promise<void>, ok: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
    } catch {
      setMsg({ tone: 'error', text: 'عملیات انجام نشد.' });
    } finally {
      setBusy(false);
    }
  }

  async function backup() {
    if (busy) return;
    setBusy(true);
    try {
      const blob = new Blob([await exportAllData()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rahyar-backup-v2-${new Date().toISOString().slice(0, 10)}.json`;
      // Keep the element in the document briefly for mobile Safari reliability.
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Delay revoke so the browser can start the download (especially mobile).
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 2_000);
      // Browser download completion does NOT prove the user saved the file.
      setMsg({
        tone: 'info',
        text: 'درخواست دانلود نسخه پشتیبان ارسال شد. لطفاً ذخیره شدن فایل را در پوشه دانلود خود تأیید کنید.',
      });
    } catch {
      setMsg({ tone: 'error', text: 'تهیه نسخه پشتیبان ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  }

  const resetRestoreUi = useCallback(() => {
    setPreview(null);
    setNormalizedBackup(null);
    setAckedCurrentBackup(false);
    setFinalConfirm(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  async function onFileSelected(file: File | null) {
    resetRestoreUi();
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      // Validation + preview must never write to Dexie.
      const validation = await validateBackupInput(text);
      const p = await buildRestorePreview(text, validation);
      setPreview(p);
      setNormalizedBackup(validation.normalized);
      if (!p.canRestore) {
        setMsg({
          tone: 'error',
          text: `فایل نامعتبر است (${p.issues.length} خطا). هیچ داده‌ای تغییر نکرد.`,
        });
      } else {
        setMsg({
          tone: 'info',
          text: 'پیش‌نمایش آماده است. قبل از بازیابی، نسخه پشتیبان از داده‌های فعلی بگیرید و تأیید کنید.',
        });
      }
    } catch {
      setMsg({ tone: 'error', text: 'خواندن فایل ناموفق بود.' });
      resetRestoreUi();
    } finally {
      setBusy(false);
    }
  }

  async function performRestore() {
    if (!normalizedBackup || !preview?.canRestore || !ackedCurrentBackup || !finalConfirm) {
      setMsg({ tone: 'error', text: 'شرایط بازیابی کامل نیست.' });
      return;
    }
    setBusy(true);
    try {
      await atomicReplaceRestore(normalizedBackup);
      setMsg({
        tone: 'success',
        text: 'بازیابی با موفقیت انجام شد. داده‌های کسب‌وکار جایگزین شدند؛ هویت دستگاه حفظ شد.',
      });
      resetRestoreUi();
    } catch {
      setMsg({
        tone: 'error',
        text: 'بازیابی ناموفق بود. همه داده‌های قبلی و هویت دستگاه بدون تغییر باقی ماندند.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="بیشتر" />

      <Section>
        <div className="space-y-2">
          <Link href="/team/" className="block">
            <Card className="flex items-center gap-3 p-4 hover:border-brand-200">
              <UsersIcon />
              <span className="font-medium">تیم و اعضا</span>
            </Card>
          </Link>
          <Link href="/search/" className="block">
            <Card className="flex items-center gap-3 p-4 hover:border-brand-200">
              <SearchIcon />
              <span className="font-medium">جستجو در فایل‌ها و مشتریان</span>
            </Card>
          </Link>
        </div>
      </Section>

      {msg && (
        <div className="px-4">
          <Callout tone={msg.tone}>{msg.text}</Callout>
        </div>
      )}

      <Section title="داده‌ها">
        <Card className="space-y-3 p-4">
          <p className="text-sm leading-7 text-slate-600">
            همه اطلاعات فقط روی همین دستگاه (در مرورگر) ذخیره می‌شود و بدون اینترنت هم کار می‌کند.
            پاک کردن داده‌های مرورگر، اطلاعات را حذف می‌کند؛ پس نسخه پشتیبان بگیرید.
          </p>
          <Button variant="secondary" className="w-full" onClick={backup} disabled={busy}>
            دانلود نسخه پشتیبان (JSON — نسخه ۲)
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={() => {
              if (window.confirm('همه داده‌های فعلی با داده‌های نمونه جایگزین شود؟'))
                run(resetToDemoData, 'داده‌های نمونه بازگردانی شد.');
            }}
          >
            بازگردانی داده‌های نمونه
          </Button>
          <Button
            variant="danger"
            className="w-full"
            disabled={busy}
            onClick={() => {
              if (window.confirm('همه فایل‌ها، مشتریان، نیازها و پیگیری‌ها برای همیشه حذف شود؟'))
                run(clearAllData, 'همه داده‌ها حذف شد.');
            }}
          >
            حذف همه داده‌ها
          </Button>
        </Card>
      </Section>

      <Section title="بازیابی از نسخه پشتیبان">
        <Card className="space-y-3 p-4">
          <p className="text-sm leading-7 text-slate-600">
            فایل پشتیبان را انتخاب کنید. ابتدا فقط پیش‌نمایش نمایش داده می‌شود و هیچ داده‌ای نوشته
            نمی‌شود. برای ادامه باید از داده‌های فعلی نسخه پشتیبان بگیرید و دو بار تأیید کنید.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="block w-full text-sm"
            disabled={busy}
            onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
          />

          {preview && (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p>
                <span className="font-medium">نسخه قالب:</span> {preview.formatVersion}
                {preview.formatVersion === 1 ? ' (قدیمی — سازگار)' : ''}
              </p>
              <p>
                <span className="font-medium">زمان خروجی:</span>{' '}
                {preview.exportedAt || '—'}
              </p>
              <p>
                <span className="font-medium">شناسه دستگاه مبدأ:</span>{' '}
                {preview.sourceDeviceInstanceId ?? '—'}
              </p>
              <p>
                <span className="font-medium">تبار داده:</span> {preview.dataLineageId ?? '—'}
              </p>
              {preview.checksumValid !== null && (
                <p>
                  <span className="font-medium">کنترل یکپارچگی:</span>{' '}
                  {preview.checksumValid ? 'معتبر' : 'نامعتبر'}
                </p>
              )}
              {preview.formatVersion === 1 && (
                <p className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
                  نسخه پشتیبان ۱ فاقد checksum است؛ ساختار داده بررسی می‌شود، اما
                  دستکاری یا اصالت فایل از طریق checksum قابل تشخیص نیست.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="font-medium mb-1">در فایل</p>
                  <ul className="space-y-0.5 text-slate-600">
                    <li>ملک: {preview.counts.properties}</li>
                    <li>مشتری: {preview.counts.clients}</li>
                    <li>نیاز: {preview.counts.needs}</li>
                    <li>پیگیری: {preview.counts.followUps}</li>
                    <li>فعالیت: {preview.counts.activities}</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium mb-1">فعلی دستگاه</p>
                  <ul className="space-y-0.5 text-slate-600">
                    <li>ملک: {preview.currentCounts.properties}</li>
                    <li>مشتری: {preview.currentCounts.clients}</li>
                    <li>نیاز: {preview.currentCounts.needs}</li>
                    <li>پیگیری: {preview.currentCounts.followUps}</li>
                    <li>فعالیت: {preview.currentCounts.activities}</li>
                  </ul>
                </div>
              </div>

              {preview.issues.length > 0 && (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-red-800">
                  <p className="font-medium mb-1">خطاهای اعتبارسنجی</p>
                  <ul className="list-disc pr-4 space-y-0.5 max-h-40 overflow-auto">
                    {preview.issues.slice(0, 20).map((iss, i) => (
                      <li key={i}>
                        {iss.path}: {iss.message}
                      </li>
                    ))}
                    {preview.issues.length > 20 && (
                      <li>… و {preview.issues.length - 20} مورد دیگر</li>
                    )}
                  </ul>
                </div>
              )}

              {preview.canRestore && (
                <div className="space-y-3 border-t border-slate-200 pt-3">
                  <p className="text-sm text-amber-800 leading-6">
                    هشدار: بازیابی، تمام داده‌های کسب‌وکار فعلی را با محتوای فایل جایگزین می‌کند.
                    هویت این دستگاه حفظ می‌شود؛ تبار داده به مقدار فایل به‌روز می‌شود.
                  </p>
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={busy}
                    onClick={async () => {
                      await backup();
                    }}
                  >
                    دانلود نسخه پشتیبان از داده‌های فعلی
                  </Button>
                  <label className="flex items-start gap-2 text-sm leading-6">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={ackedCurrentBackup}
                      disabled={busy}
                      onChange={(e) => {
                        setAckedCurrentBackup(e.target.checked);
                        if (!e.target.checked) setFinalConfirm(false);
                      }}
                    />
                    <span>
                      تأیید می‌کنم که از داده‌های فعلی نسخه پشتیبان گرفته‌ام (یا نیازی به آن ندارم) و
                      ذخیره شدن فایل را بررسی کرده‌ام. دانلود خودکار مرورگر به‌تنهایی کافی نیست.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm leading-6">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={finalConfirm}
                      disabled={busy || !ackedCurrentBackup}
                      onChange={(e) => setFinalConfirm(e.target.checked)}
                    />
                    <span>
                      تأیید نهایی: می‌خواهم داده‌های کسب‌وکار فعلی را با محتوای این فایل جایگزین کنم.
                    </span>
                  </label>
                  <Button
                    variant="danger"
                    className="w-full"
                    disabled={busy || !ackedCurrentBackup || !finalConfirm}
                    onClick={performRestore}
                  >
                    اجرای بازیابی (جایگزینی)
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={busy}
                    onClick={resetRestoreUi}
                  >
                    انصراف
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      </Section>

      <Section title="درباره">
        <Card className="space-y-1 p-4 text-sm text-slate-600">
          <p>اتحاد — نسخه در حال توسعه (چندکاربره)</p>
          <p>تحلیل متن و تطبیق در نسخه فعلی قانون‌محور و محلی است.</p>
        </Card>
      </Section>
    </>
  );
}
