'use client';
import { useState } from 'react';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import { getAIProvider, type FollowUpSuggestion } from '@/lib/ai';
import { Button, Card, Field, Select } from '@/components/ui';

export function FollowUpSuggestions() {
  const clients = useQuery(() => repositories.clients.list());
  const [clientId, setClientId] = useState('');
  const [items, setItems] = useState<FollowUpSuggestion[] | null>(null);

  async function suggest() {
    const client = clients?.find((c) => c.id === clientId);
    if (!client) return;
    const [needs, properties, followUps] = await Promise.all([
      repositories.needs.listByClient(client.id), repositories.properties.list(), repositories.followUps.listByClient(client.id),
    ]);
    setItems(await getAIProvider().suggestFollowUps({ client, needs, properties, followUps }));
  }
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold">پیشنهاد پیگیری</h2>
      <Field label="مشتری">
        <Select value={clientId} onChange={(e) => { setClientId(e.target.value); setItems(null); }}>
          <option value="">انتخاب کنید</option>{(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Button className="w-full" variant="secondary" onClick={suggest} disabled={!clientId}>پیشنهاد بده</Button>
      {items && (
        <ul className="space-y-2">
          {items.map((s, i) => (
            <li key={i} className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="font-medium">{s.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">{s.reason}</p>
              <Button size="sm" className="mt-2" href={`/followups/new/?clientId=${encodeURIComponent(clientId)}${s.propertyId ? `&propertyId=${encodeURIComponent(s.propertyId)}` : ''}&title=${encodeURIComponent(s.title)}`}>ایجاد این پیگیری</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
