'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { toLatinDigits, toPersianDigits } from '@/lib/utils/persian';
import { ChevronIcon } from './icons';

export const cn = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ');

type BtnProps = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  href?: string;
  children: ReactNode;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

const BTN_BASE = 'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none';
const BTN_VARIANT = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50',
  ghost: 'text-brand-700 hover:bg-brand-50',
  danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50',
};
const BTN_SIZE = { md: 'h-11 px-4 text-sm', sm: 'h-9 px-3 text-xs' };

export function Button({ variant = 'primary', size = 'md', href, className, children, ...rest }: BtnProps) {
  const cls = cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className);
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button type="button" className={cls} {...rest}>{children}</button>;
}

export function PageHeader({ title, subtitle, action, back }: { title: string; subtitle?: string; action?: ReactNode; back?: string }) {
  return (
    <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-5">
      <div className="min-w-0">
        {back && (
          <Link href={back} className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-700">
            <ChevronIcon width={14} height={14} className="rotate-180" /> بازگشت
          </Link>
        )}
        <h1 className="truncate text-xl font-bold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function Section({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-4 py-3">
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between">
          {title && <h2 className="text-sm font-semibold text-slate-700">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl border border-slate-200 bg-white', className)}>{children}</div>;
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'brand' | 'amber' | 'red' | 'green' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700', brand: 'bg-brand-50 text-brand-700', amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-700', green: 'bg-emerald-50 text-emerald-700',
  };
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'error' | 'success'; title?: string; children: ReactNode }) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-900', warn: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-800', success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={cn('rounded-xl border px-3 py-2.5 text-sm leading-6', tones[tone])}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-slate-200/70', className)} />;
}
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3 px-4 py-3">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>;
}

export const inputCls =
  'h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm placeholder:text-slate-400 focus:border-brand-500';

export function Field({ label, hint, error, smart, children }: { label: string; hint?: string; error?: string; smart?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {label}
        {smart && <span title="از متن شما استخراج شد" className="rounded bg-brand-50 px-1 text-[11px] font-normal text-brand-700">✦ از متن</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputCls, 'pe-8', props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputCls, 'h-auto min-h-24 py-2 leading-7', props.className)} />;
}

/**
 * Numeric input that accepts Persian/Arabic/Latin digits. `scale` converts the displayed unit
 * to the stored unit (e.g. scale=1e6: user types million-toman, value is stored as toman).
 */
export function NumField({ value, onChange, scale = 1, placeholder, ...rest }: {
  value: number | null; onChange: (v: number | null) => void; scale?: number; placeholder?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'placeholder'>) {
  const [text, setText] = useState(value == null ? '' : toPersianDigits(value / scale));
  return (
    <Input
      {...rest}
      inputMode="decimal"
      dir="ltr"
      className="text-right"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const cleaned = toLatinDigits(raw).replace(/[٫,،/]/g, '.').replace(/[^\d.]/g, '');
        const n = cleaned === '' ? null : Number(cleaned);
        onChange(n == null || !Number.isFinite(n) ? null : Math.round(n * scale * 100) / 100);
      }}
    />
  );
}

export function TriState({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <Select value={value == null ? '' : value ? 'yes' : 'no'} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'yes')}>
      <option value="">نامشخص</option>
      <option value="yes">دارد</option>
      <option value="no">ندارد</option>
    </Select>
  );
}
