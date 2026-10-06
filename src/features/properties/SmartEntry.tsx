'use client';
import { useState } from 'react';
import type { Property } from '@/types';
import type { ParseResult } from '@/lib/parser';
import { getAIProvider } from '@/lib/ai';
import { repositories } from '@/lib/repositories';
import { Button, Callout, Card, Textarea } from '@/components/ui';
import { SparkleIcon } from '@/components/icons';
import { PropertyForm } from './PropertyForm';

const EXAMPLES = [
  '۸۵ متر دو خواب ولیعصر رهن ۵۰۰ اجاره ۱۵',
  'آپارتمان ۱۲۰ متری ۳ خوابه سعادت‌آباد فروش ۱۲ میلیارد و ۵۰۰ میلیون طبقه ۴ از ۶ پارکینگ آسانسور',
];

export function SmartEntry({ onSaved }: { onSaved: (p: Property) => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [run, setRun] = useState(0);
  const [busy, setBusy] = useState(false);

  async function analyze() {
    setBusy(true);
    try {
      setResult(await getAIProvider().parsePropertyText(text));
      setRun((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        {result.extracted.length === 0
          ? <Callout tone="warn">چیزی از متن شناسایی نشد. می‌توانید فرم را دستی پر کنید یا متن را کامل‌تر بنویسید.</Callout>
          : <Callout tone="info" title="اطلاعات استخراج‌شده">فقط مواردی که در متن بود پر شده‌اند. نشانه «✦ از متن» را ببینید؛ همه فیلدها قابل ویرایش‌اند و چیزی ذخیره نمی‌شود مگر تأیید کنید.</Callout>}
        <PropertyForm
          key={run}
          initial={result.draft}
          extracted={result.extracted}
          assumptions={result.assumptions}
          submitLabel="تأیید و ذخیره"
          onCancel={() => setResult(null)}
          onSubmit={async (input) => onSaved(await repositories.properties.create(input))}
        />
      </div>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <label className="block text-sm font-medium text-slate-700" htmlFor="smart-text">مشخصات فایل را همان‌طور که می‌گویید بنویسید</label>
      <Textarea id="smart-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="مثال: ۸۵ متر دو خواب ولیعصر رهن ۵۰۰ اجاره ۱۵" className="min-h-28" />
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">
            نمونه: {ex.length > 28 ? ex.slice(0, 28) + '…' : ex}
          </button>
        ))}
      </div>
      <Button className="w-full" onClick={analyze} disabled={busy || !text.trim()}>
        <SparkleIcon width={18} height={18} /> {busy ? 'در حال تحلیل…' : 'تحلیل متن'}
      </Button>
      <p className="text-xs text-slate-500">تحلیل روی همین دستگاه و بدون اینترنت انجام می‌شود. اطلاعات نامشخص خالی می‌ماند.</p>
    </Card>
  );
}
