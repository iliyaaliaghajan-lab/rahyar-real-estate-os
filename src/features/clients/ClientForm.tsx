'use client';
import { useState } from 'react';
import type { ClientInput } from '@/types';
import { normalizeIranMobile } from '@/lib/utils/persian';
import { Button, Callout, Field, Input, Textarea } from '@/components/ui';

export function ClientForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial?: ClientInput; submitLabel: string; onSubmit: (c: ClientInput) => Promise<void>; onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join('، '));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const errs: string[] = [];
    if (!name.trim()) errs.push('نام مشتری را وارد کنید.');
    let p = phone.trim();
    if (p) {
      const n = normalizeIranMobile(p);
      if (!n) errs.push('شماره موبایل معتبر نیست (مثال: ۰۹۱۲۱۲۳۴۵۶۷).');
      else p = n;
    }
    if (errs.length) return setErrors(errs);
    setErrors([]);
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(), phone: p, notes: notes.trim(),
        tags: tags.split(/[,،]/).map((t) => t.trim()).filter(Boolean),
      });
    } catch {
      setErrors(['ذخیره‌سازی انجام نشد. دوباره تلاش کنید.']);
      setSaving(false);
    }
  }
  return (
    <div className="space-y-4">
      {errors.length > 0 && <Callout tone="error"><ul className="list-disc pe-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Callout>}
      <Field label="نام *"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
      <Field label="موبایل"><Input dir="ltr" className="text-right" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="برچسب‌ها" hint="با ویرگول جدا کنید؛ مثال: مستأجر، فوری"><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
      <Field label="یادداشت"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={submit} disabled={saving}>{saving ? 'در حال ذخیره…' : submitLabel}</Button>
        {onCancel && <Button variant="secondary" onClick={onCancel} disabled={saving}>بازگشت</Button>}
      </div>
    </div>
  );
}
