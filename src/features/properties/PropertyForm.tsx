'use client';
import { useState } from 'react';
import type { PropertyDraft, PropertyInput, PropertyType, TransactionType } from '@/types';
import { makeTitle } from '@/lib/parser';
import { formatToman, normalizeIranMobile } from '@/lib/utils/persian';
import { PROPERTY_TYPES, PROPERTY_TYPE_LABELS, TRANSACTION_LABELS } from '@/lib/utils/labels';
import { Button, Callout, Field, Input, NumField, Select, Textarea, TriState } from '@/components/ui';

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-slate-700">{title}</legend>
      {children}
    </fieldset>
  );
}

export function PropertyForm({ initial, extracted = [], assumptions = [], submitLabel, onSubmit, onCancel }: {
  initial: PropertyDraft;
  extracted?: Array<keyof PropertyDraft>;
  assumptions?: string[];
  submitLabel: string;
  onSubmit: (input: PropertyInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [d, setD] = useState<PropertyDraft>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof PropertyDraft>(k: K, v: PropertyDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const smart = (k: keyof PropertyDraft) => extracted.includes(k);
  const showSale = d.transactionType !== 'rent';
  const showRent = d.transactionType !== 'sale';

  async function submit() {
    const errs: string[] = [];
    if (!d.transactionType) errs.push('نوع معامله را انتخاب کنید.');
    if (!d.propertyType) errs.push('نوع ملک را انتخاب کنید.');
    if (d.area != null && d.area <= 0) errs.push('متراژ باید بزرگ‌تر از صفر باشد.');
    if (d.bedrooms != null && (!Number.isInteger(d.bedrooms) || d.bedrooms < 0 || d.bedrooms > 20)) errs.push('تعداد خواب نامعتبر است.');
    let phone = d.contactPhone.trim();
    if (phone) {
      const n = normalizeIranMobile(phone);
      if (!n) errs.push('شماره موبایل معتبر نیست (مثال: ۰۹۱۲۱۲۳۴۵۶۷).');
      else phone = n;
    }
    if (errs.length || !d.transactionType || !d.propertyType) { setErrors(errs); return; }
    setErrors([]);
    setSaving(true);
    try {
      const input: PropertyInput = {
        ...d,
        transactionType: d.transactionType,
        propertyType: d.propertyType,
        contactPhone: phone,
        title: d.title.trim() || makeTitle(d),
        location: d.location.trim(),
        neighborhood: d.neighborhood.trim(),
        contactName: d.contactName.trim(),
        description: d.description.trim(),
        // keep only the fields that make sense for the transaction type
        price: d.transactionType === 'sale' ? d.price : null,
        deposit: d.transactionType === 'rent' ? d.deposit : null,
        rent: d.transactionType === 'rent' ? d.rent : null,
      };
      await onSubmit(input);
    } catch {
      setErrors(['ذخیره‌سازی انجام نشد. دوباره تلاش کنید.']);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {assumptions.length > 0 && (
        <Callout tone="warn" title="این برداشت‌ها را بررسی کنید">
          <ul className="list-disc space-y-1 pe-5">{assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </Callout>
      )}
      {errors.length > 0 && <Callout tone="error"><ul className="list-disc pe-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Callout>}

      <Group title="اطلاعات اصلی">
        <Field label="عنوان" hint="اگر خالی بگذارید، از اطلاعات فایل ساخته می‌شود." smart={smart('title')}>
          <Input value={d.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="نوع معامله *" smart={smart('transactionType')}>
            <Select value={d.transactionType ?? ''} onChange={(e) => set('transactionType', (e.target.value || null) as TransactionType | null)}>
              <option value="">انتخاب کنید</option>
              {(['sale', 'rent'] as const).map((t) => <option key={t} value={t}>{TRANSACTION_LABELS[t]}</option>)}
            </Select>
          </Field>
          <Field label="نوع ملک *" smart={smart('propertyType')}>
            <Select value={d.propertyType ?? ''} onChange={(e) => set('propertyType', (e.target.value || null) as PropertyType | null)}>
              <option value="">انتخاب کنید</option>
              {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{PROPERTY_TYPE_LABELS[t]}</option>)}
            </Select>
          </Field>
          <Field label="متراژ (متر)" smart={smart('area')}><NumField value={d.area} onChange={(v) => set('area', v)} /></Field>
          <Field label="تعداد خواب" smart={smart('bedrooms')}><NumField value={d.bedrooms} onChange={(v) => set('bedrooms', v)} /></Field>
          <Field label="منطقه / محله" smart={smart('location')}><Input value={d.location} onChange={(e) => set('location', e.target.value)} /></Field>
          <Field label="توضیح محله"><Input value={d.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} /></Field>
        </div>
      </Group>

      <Group title="قیمت (به میلیون تومان)">
        {showSale && (
          <Field label="قیمت فروش" hint={d.price != null ? `= ${formatToman(d.price)}` : 'مثال: ۱۲۵۰۰ یعنی ۱۲ میلیارد و ۵۰۰ میلیون'} smart={smart('price')}>
            <NumField value={d.price} scale={1e6} onChange={(v) => set('price', v)} />
          </Field>
        )}
        {showRent && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="رهن" hint={d.deposit != null ? `= ${formatToman(d.deposit)}` : undefined} smart={smart('deposit')}>
              <NumField value={d.deposit} scale={1e6} onChange={(v) => set('deposit', v)} />
            </Field>
            <Field label="اجاره ماهانه" hint={d.rent != null ? `= ${formatToman(d.rent)}` : undefined} smart={smart('rent')}>
              <NumField value={d.rent} scale={1e6} onChange={(v) => set('rent', v)} />
            </Field>
          </div>
        )}
      </Group>

      <Group title="ویژگی‌ها">
        <div className="grid grid-cols-2 gap-3">
          <Field label="طبقه" smart={smart('floor')}><NumField value={d.floor} onChange={(v) => set('floor', v)} /></Field>
          <Field label="تعداد کل طبقات" smart={smart('totalFloors')}><NumField value={d.totalFloors} onChange={(v) => set('totalFloors', v)} /></Field>
          <Field label="پارکینگ" smart={smart('parking')}><TriState value={d.parking} onChange={(v) => set('parking', v)} /></Field>
          <Field label="آسانسور" smart={smart('elevator')}><TriState value={d.elevator} onChange={(v) => set('elevator', v)} /></Field>
          <Field label="انباری" smart={smart('storage')}><TriState value={d.storage} onChange={(v) => set('storage', v)} /></Field>
        </div>
      </Group>

      <Group title="تماس و توضیحات">
        <div className="grid grid-cols-2 gap-3">
          <Field label="نام تماس" smart={smart('contactName')}><Input value={d.contactName} onChange={(e) => set('contactName', e.target.value)} /></Field>
          <Field label="موبایل" smart={smart('contactPhone')}><Input dir="ltr" className="text-right" inputMode="tel" value={d.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} /></Field>
        </div>
        <Field label="توضیحات"><Textarea value={d.description} onChange={(e) => set('description', e.target.value)} /></Field>
      </Group>

      <div className="flex gap-2">
        <Button className="flex-1" onClick={submit} disabled={saving}>{saving ? 'در حال ذخیره…' : submitLabel}</Button>
        {onCancel && <Button variant="secondary" onClick={onCancel} disabled={saving}>بازگشت</Button>}
      </div>
    </div>
  );
}
