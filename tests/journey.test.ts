import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoData } from '../src/lib/db/demoData';
import { parsePropertyTextSync } from '../src/lib/parser';
import { evaluateMatch, findMatchesForNeed, suggestTopMatches } from '../src/lib/matching';
import { RuleBasedProvider } from '../src/lib/ai/ruleBased';
import { addDaysISO, relativeDayLabel } from '../src/lib/utils/date';
import type { Property } from '../src/types';

const TODAY = '2026-10-06';
const demo = buildDemoData(TODAY);

test('demo data is internally consistent', () => {
  const pIds = new Set(demo.properties.map((p) => p.id));
  const cIds = new Set(demo.clients.map((c) => c.id));
  assert.ok(demo.properties.length >= 8 && demo.clients.length >= 4 && demo.needs.length >= 4);
  assert.ok(demo.needs.every((n) => cIds.has(n.clientId)));
  assert.ok(demo.followUps.every((f) => cIds.has(f.clientId) && (f.propertyId === null || pIds.has(f.propertyId))));
  assert.equal(new Set(demo.properties.map((p) => p.id)).size, demo.properties.length);
});

test('dashboard has content on first launch', () => {
  const pendingToday = demo.followUps.filter((f) => f.status === 'pending' && f.dueDate === TODAY);
  assert.ok(pendingToday.length >= 2);
  assert.ok(demo.followUps.some((f) => f.status === 'pending' && f.dueDate < TODAY)); // an overdue one
  assert.ok(suggestTopMatches(demo.needs, demo.properties).length >= 3);
  assert.ok(demo.activities.length >= 3);
});

test('demo journey: smart entry → save → client need → match → explanation', () => {
  // 1. smart entry text → extracted draft (user confirms and picks the type the parser could not know)
  const r = parsePropertyTextSync('۸۵ متر دو خواب ولیعصر رهن ۵۰۰ اجاره ۱۵');
  assert.equal(r.draft.propertyType, null); // not invented
  const saved: Property = {
    ...r.draft, id: 'new', transactionType: r.draft.transactionType!, propertyType: 'apartment',
    createdAt: 0, updatedAt: 0, title: r.draft.title,
  };
  // 2. the exact need from the brief
  const need = demo.needs.find((n) => n.id === 'demo-n1')!;
  assert.equal(need.minArea, 80); assert.equal(need.maxArea, 100); assert.equal(need.maxDeposit, 600e6); assert.equal(need.maxRent, 20e6);
  // 3. matching: the new property matches, with all four reason groups
  const res = evaluateMatch(saved, need);
  assert.equal(res.rejected, false);
  assert.ok(res.score >= 85, `score ${res.score}`);
  assert.ok(['area', 'bedrooms', 'location', 'budget'].every((f) => res.reasons.some((x) => x.factor === f && x.status === 'match')));
  // 4. among all properties, only the right ones come back, best first
  const all = [...demo.properties, saved];
  const found = findMatchesForNeed(need, all);
  assert.ok(found.length >= 2);
  assert.ok(found.every((m) => m.score <= found[0].score));
  assert.ok(!found.some((m) => m.propertyId === 'demo-p9')); // deposit ۶۵۰ > cap ۶۰۰ → hard reject
  assert.ok(!found.some((m) => m.propertyId === 'demo-p2')); // sale vs rent → hard reject
});

test('rule-based provider only states known facts', async () => {
  const ai = new RuleBasedProvider();
  const client = demo.clients[0];
  const bare: Property = { ...demo.properties[0], area: null, bedrooms: null, deposit: null, rent: null, parking: null, elevator: null, storage: null, location: '' };
  const msg = await ai.generateClientMessage({ client, property: bare });
  assert.ok(msg.includes(client.name));
  assert.ok(!/متر|خواب|رهن|اجاره|پارکینگ|آسانسور|انباری/.test(msg.replace('رهن و اجاره', '')), msg);
  const sug = await ai.suggestFollowUps({ client, needs: [], properties: demo.properties, followUps: [] });
  assert.equal(sug.length, 1);
});

test('date helpers', () => {
  assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01');
  assert.equal(relativeDayLabel(TODAY, TODAY), 'امروز');
  assert.equal(relativeDayLabel(addDaysISO(TODAY, 1), TODAY), 'فردا');
  assert.equal(relativeDayLabel(addDaysISO(TODAY, -3), TODAY), '۳ روز پیش');
});
