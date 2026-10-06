'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { MatchResult, ReasonStatus } from '@/lib/matching';
import { toPersianDigits } from '@/lib/utils/persian';
import { Badge, Callout, Card } from '@/components/ui';

const MARK: Record<ReasonStatus, { icon: string; cls: string }> = {
  match: { icon: '✓', cls: 'text-emerald-600' },
  partial: { icon: '≈', cls: 'text-amber-600' },
  unknown: { icon: '؟', cls: 'text-slate-400' },
  mismatch: { icon: '✗', cls: 'text-red-500' },
};

/** Evidence-first match display. The percentage is explicitly a rule score, not a probability. */
export function MatchCard({ result, title, subtitle, href, children }: {
  result: MatchResult; title: string; subtitle?: string; href?: string; children?: ReactNode;
}) {
  const tone = result.score >= 80 ? 'green' : result.score >= 60 ? 'brand' : 'amber';
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {href ? <Link href={href} className="font-semibold hover:text-brand-700">{title}</Link> : <p className="font-semibold">{title}</p>}
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="shrink-0 text-center">
          <Badge tone={tone}>{toPersianDigits(result.score)}٪ تطابق</Badge>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">امتیاز تطبیق مبتنی بر قوانین</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {result.reasons.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span className={`w-4 shrink-0 text-center font-bold ${MARK[r.status].cls}`}>{MARK[r.status].icon}</span>
            <span className={r.status === 'unknown' ? 'text-slate-500' : ''}>{r.text}</span>
          </li>
        ))}
      </ul>
      {result.unknownFactors.length > 0 && (
        <div className="mt-3">
          <Callout tone="warn">اطلاعات «{result.unknownFactors.join('، ')}» در فایل ثبت نشده؛ قبل از پیشنهاد به مشتری بررسی شود.</Callout>
        </div>
      )}
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </Card>
  );
}
