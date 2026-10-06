'use client';
import { useMemo, useState } from 'react';
import type { Client, Need } from '@/types';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import { evaluateMatch, findMatchesForNeed } from '@/lib/matching';
import { getAIProvider } from '@/lib/ai';
import { formatNumberFa } from '@/lib/utils/persian';
import { Button, Callout, EmptyState } from '@/components/ui';
import { MatchCard } from './MatchCard';

/** "پیدا کردن فایل مناسب": runs the deterministic matcher live against all properties. */
export function NeedMatches({ need, client }: { need: Need; client: Client }) {
  const properties = useQuery(() => repositories.properties.list());
  const [shown, setShown] = useState(false);
  const [draft, setDraft] = useState<{ propertyId: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { matches, rejectedCount } = useMemo(() => {
    if (!properties) return { matches: [], rejectedCount: 0 };
    const m = findMatchesForNeed(need, properties);
    const rejected = properties.filter((p) => evaluateMatch(p, need).rejected).length;
    return { matches: m, rejectedCount: rejected };
  }, [properties, need]);

  async function makeDraft(propertyId: string) {
    const p = properties?.find((x) => x.id === propertyId);
    if (!p) return;
    setCopied(false);
    setDraft({ propertyId, text: await getAIProvider().generateClientMessage({ client, property: p, need }) });
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }

  if (!shown) return <Button className="w-full" onClick={() => setShown(true)} disabled={!properties}>پیدا کردن فایل مناسب</Button>;
  if (!properties) return null;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">{formatNumberFa(matches.length)} فایل مناسب • {formatNumberFa(rejectedCount)} فایل به‌دلیل قیدهای اصلی رد شد</p>
      {matches.length === 0 && <EmptyState title="فایل مناسبی پیدا نشد" hint="نوع معامله، نوع ملک، بازه متراژ و سقف بودجه قیدهای اصلی‌اند؛ می‌توانید نیاز را ویرایش کنید." />}
      {matches.map((m) => {
        const p = properties.find((x) => x.id === m.propertyId);
        if (!p) return null;
        return (
          <MatchCard key={m.propertyId} result={m} title={p.title} href={`/properties/view/?id=${encodeURIComponent(p.id)}`}>
            <Button size="sm" href={`/followups/new/?clientId=${encodeURIComponent(client.id)}&propertyId=${encodeURIComponent(p.id)}`}>ایجاد پیگیری</Button>
            <Button size="sm" variant="secondary" onClick={() => makeDraft(p.id)}>پیش‌نویس پیام</Button>
          </MatchCard>
        );
      })}
      {draft && (
        <Callout tone="info" title="پیش‌نویس پیام (قبل از ارسال بررسی و ویرایش کنید)">
          <p className="whitespace-pre-wrap">{draft.text}</p>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => copy(draft.text)}>{copied ? 'کپی شد ✓' : 'کپی متن'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>بستن</Button>
          </div>
        </Callout>
      )}
    </div>
  );
}
