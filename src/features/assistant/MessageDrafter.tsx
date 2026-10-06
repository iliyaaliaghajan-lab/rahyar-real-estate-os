'use client';
import { useState } from 'react';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import { evaluateMatch } from '@/lib/matching';
import { getAIProvider } from '@/lib/ai';
import { toPersianDigits } from '@/lib/utils/persian';
import { Button, Callout, Card, Field, Select, Textarea } from '@/components/ui';

export function MessageDrafter() {
  const clients = useQuery(() => repositories.clients.list());
  const properties = useQuery(() => repositories.properties.list());
  const needs = useQuery(() => repositories.needs.list());
  const [clientId, setClientId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);

  async function generate() {
    const client = clients?.find((c) => c.id === clientId);
    const property = properties?.find((p) => p.id === propertyId);
    if (!client || !property) return;
    const clientNeeds = (needs ?? []).filter((n) => n.clientId === client.id);
    const results = clientNeeds.map((n) => ({ n, r: evaluateMatch(property, n) })).filter((x) => !x.r.rejected).sort((a, b) => b.r.score - a.r.score);
    setNote(clientNeeds.length === 0 ? 'برای این مشتری نیازی ثبت نشده؛ تطبیق انجام نشد.'
      : results.length === 0 ? 'این فایل با هیچ‌یک از نیازهای ثبت‌شده این مشتری مطابقت ندارد (رد در قیدهای اصلی).'
      : `امتیاز تطبیق مبتنی بر قوانین: ${toPersianDigits(results[0].r.score)}٪`);
    setCopied(false);
    setText(await getAIProvider().generateClientMessage({ client, property, need: results[0]?.n ?? null }));
  }
  async function copy() { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } }

  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold">پیش‌نویس پیام برای مشتری</h2>
      <Field label="مشتری">
        <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">انتخاب کنید</option>{(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="فایل">
        <Select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
          <option value="">انتخاب کنید</option>{(properties ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </Select>
      </Field>
      <Button className="w-full" onClick={generate} disabled={!clientId || !propertyId}>ساخت پیش‌نویس</Button>
      {text && (
        <div className="space-y-2">
          {note && <Callout tone="info">{note}</Callout>}
          <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-40" aria-label="پیش‌نویس پیام" />
          <p className="text-xs text-slate-500">فقط اطلاعات ثبت‌شده در فایل استفاده شده است. پیام هیچ‌جا ارسال نمی‌شود؛ پس از بررسی کپی کنید.</p>
          <Button variant="secondary" onClick={copy}>{copied ? 'کپی شد ✓' : 'کپی متن'}</Button>
        </div>
      )}
    </Card>
  );
}
