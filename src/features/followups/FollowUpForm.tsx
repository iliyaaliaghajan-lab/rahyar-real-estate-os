'use client';
import { useState } from 'react';
import type { Client, FollowUpInput, Property } from '@/types';
import { formatJalaliLong, relativeDayLabel } from '@/lib/utils/date';
import { Button, Callout, Field, Input, Select, Textarea } from '@/components/ui';

export function FollowUpForm({ initial, clients, properties, onSubmit, onCancel }: {
  initial: FollowUpInput; clients: Client[]; properties: Property[];
  onSubmit: (f: FollowUpInput) => Promise<void>; onCancel: () => void;
}) {
  const [f, setF] = useState<FollowUpInput>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FollowUpInput>(k: K, v: FollowUpInput[K]) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    const errs: string[] = [];
    if (!f.title.trim()) errs.push('عنوان پیگیری را وارد کنید.');
    if (!f.clientId) errs.push('مشتری را انتخاب کنید.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dueDate)) errs.push('تاریخ پیگیری را انتخاب کنید.');
    if (errs.length) return setErrors(errs);
    setErrors([]);
    setSaving(true);
    try { await onSubmit({ ...f, title: f.title.trim(), notes: f.notes.trim() }); }
    catch { setErrors(['ذخیره‌سازی انجام نشد. دوباره تلاش کنید.']); setSaving(false); }
  }
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(f.dueDate);
  return (
    <div className="space-y-4">
      {errors.length > 0 && <Callout tone="error"><ul className="list-disc pe-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Callout>}
      <Field label="عنوان *"><Input value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
      <Field label="مشتری *">
        <Select value={f.clientId} onChange={(e) => set('clientId', e.target.value)}>
          <option value="">انتخاب کنید</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="فایل مرتبط (اختیاری)">
        <Select value={f.propertyId ?? ''} onChange={(e) => set('propertyId', e.target.value || null)}>
          <option value="">بدون فایل</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </Select>
      </Field>
      <Field label="تاریخ پیگیری *" hint={validDate ? `${formatJalaliLong(f.dueDate)} (${relativeDayLabel(f.dueDate)})` : undefined}>
        <Input type="date" dir="ltr" className="text-right" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
      </Field>
      <Field label="یادداشت"><Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={submit} disabled={saving}>{saving ? 'در حال ذخیره…' : 'ذخیره پیگیری'}</Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>انصراف</Button>
      </div>
    </div>
  );
}
