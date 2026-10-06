'use client';
import { useState } from 'react';
import type { NeedInput, PropertyType, TransactionType } from '@/types';
import { formatToman } from '@/lib/utils/persian';
import { PROPERTY_TYPES, PROPERTY_TYPE_LABELS, TRANSACTION_LABELS } from '@/lib/utils/labels';
import { Button, Callout, Field, Input, NumField, Select, Textarea } from '@/components/ui';

export function NeedForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial: NeedInput; submitLabel: string; onSubmit: (n: NeedInput) => Promise<void>; onCancel?: () => void;
}) {
  const [n, setN] = useState<NeedInput>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof NeedInput>(k: K, v: NeedInput[K]) => setN((p) => ({ ...p, [k]: v }));

  async function submit() {
    const errs: string[] = [];
    if (n.minArea != null && n.maxArea != null && n.minArea > n.maxArea) errs.push('حداقل متراژ نباید از حداکثر بیشتر باشد.');
    if (n.bedrooms != null && (!Number.isInteger(n.bedrooms) || n.bedrooms < 0 || n.bedrooms > 20)) errs.push('تعداد خواب نامعتبر است.');
    if (errs.length) return setErrors(errs);
    setErrors([]);
    setSaving(true);
    try {
      await onSubmit({
        ...n,
        location: n.location.trim(),
        notes: n.notes.trim(),
        // only budget fields relevant to the transaction type are kept
        maxPrice: n.transactionType === 'sale' ? n.maxPrice : null,
        maxDeposit: n.transactionType === 'rent' ? n.maxDeposit : null,
        maxRent: n.transactionType === 'rent' ? n.maxRent : null,
      });
    } catch {
      setErrors(['ذخیره‌سازی انجام نشد. دوباره تلاش کنید.']);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {errors.length > 0 && <Callout tone="error"><ul className="list-disc pe-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Callout>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="نوع معامله *">
          <Select value={n.transactionType} onChange={(e) => set('transactionType', e.target.value as TransactionType)}>
            {(['sale', 'rent'] as const).map((t) => <option key={t} value={t}>{TRANSACTION_LABELS[t]}</option>)}
          </Select>
        </Field>
        <Field label="نوع ملک">
          <Select value={n.propertyType ?? ''} onChange={(e) => set('propertyType', (e.target.value || null) as PropertyType | null)}>
            <option value="">هر نوع</option>
            {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{PROPERTY_TYPE_LABELS[t]}</option>)}
          </Select>
        </Field>
        <Field label="حداقل متراژ"><NumField value={n.minArea} onChange={(v) => set('minArea', v)} /></Field>
        <Field label="حداکثر متراژ"><NumField value={n.maxArea} onChange={(v) => set('maxArea', v)} /></Field>
        <Field label="تعداد خواب"><NumField value={n.bedrooms} onChange={(v) => set('bedrooms', v)} /></Field>
        <Field label="منطقه"><Input value={n.location} onChange={(e) => set('location', e.target.value)} /></Field>
      </div>
      <fieldset className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-slate-700">سقف بودجه (به میلیون تومان)</legend>
        {n.transactionType === 'sale' ? (
          <Field label="حداکثر قیمت" hint={n.maxPrice != null ? `= ${formatToman(n.maxPrice)}` : 'مثال: ۹۰۰۰ یعنی ۹ میلیارد'}>
            <NumField value={n.maxPrice} scale={1e6} onChange={(v) => set('maxPrice', v)} />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="حداکثر رهن" hint={n.maxDeposit != null ? `= ${formatToman(n.maxDeposit)}` : undefined}><NumField value={n.maxDeposit} scale={1e6} onChange={(v) => set('maxDeposit', v)} /></Field>
            <Field label="حداکثر اجاره" hint={n.maxRent != null ? `= ${formatToman(n.maxRent)}` : undefined}><NumField value={n.maxRent} scale={1e6} onChange={(v) => set('maxRent', v)} /></Field>
          </div>
        )}
      </fieldset>
      <Field label="یادداشت"><Textarea value={n.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={submit} disabled={saving}>{saving ? 'در حال ذخیره…' : submitLabel}</Button>
        {onCancel && <Button variant="secondary" onClick={onCancel} disabled={saving}>بازگشت</Button>}
      </div>
    </div>
  );
}
