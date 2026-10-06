import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMatch, findMatchesForNeed, suggestTopMatches } from '../src/lib/matching';
import type { Need, Property } from '../src/types';

const P: Property = {
  id: 'p1', title: 'آپارتمان ۸۵ متری', transactionType: 'rent', propertyType: 'apartment', area: 85, bedrooms: 2,
  location: 'ولیعصر', neighborhood: '', price: null, deposit: 500e6, rent: 15e6, floor: 3, totalFloors: 5,
  parking: true, elevator: true, storage: null, description: '', contactName: '', contactPhone: '', createdAt: 0, updatedAt: 0,
};
const N: Need = {
  id: 'n1', clientId: 'c1', transactionType: 'rent', propertyType: 'apartment', minArea: 80, maxArea: 100, bedrooms: 2,
  location: 'ولیعصر', maxPrice: null, maxDeposit: 600e6, maxRent: 20e6, notes: '', createdAt: 0, updatedAt: 0,
};

test('demo flow: strong match with explanations, not a probability', () => {
  const r = evaluateMatch(P, N);
  assert.equal(r.rejected, false);
  assert.ok(r.score >= 85 && r.score <= 100, `score=${r.score}`);
  assert.deepEqual(new Set(r.reasons.map((x) => x.factor)), new Set(['type', 'location', 'area', 'bedrooms', 'budget']));
  assert.ok(r.reasons.every((x) => x.status === 'match'));
  assert.equal(r.algorithm, 'rules-v1');
});

test('hard constraints reject', () => {
  assert.equal(evaluateMatch({ ...P, transactionType: 'sale' }, N).rejected, true);
  assert.equal(evaluateMatch({ ...P, propertyType: 'office' }, N).rejected, true);
  assert.equal(evaluateMatch({ ...P, area: 70 }, N).rejected, true);
  assert.equal(evaluateMatch({ ...P, area: 120 }, N).rejected, true);
  assert.equal(evaluateMatch({ ...P, deposit: 650e6 }, N).rejected, true);
  assert.equal(evaluateMatch({ ...P, rent: 25e6 }, N).rejected, true);
  const sale = evaluateMatch({ ...P, transactionType: 'sale', price: 10e9 }, { ...N, transactionType: 'sale', maxPrice: 9e9 });
  assert.equal(sale.rejected, true);
  assert.ok(sale.rejectReasons.length > 0 && sale.score === 0);
});

test('UNKNOWN never becomes MATCH', () => {
  const r = evaluateMatch({ ...P, bedrooms: null, area: null, location: '' }, N);
  assert.equal(r.rejected, false);
  const full = evaluateMatch(P, N);
  assert.ok(r.score < full.score);
  assert.deepEqual(new Set(r.unknownFactors), new Set(['منطقه', 'متراژ', 'تعداد خواب']));
  assert.ok(r.reasons.filter((x) => x.status === 'unknown').every((x) => x.points === 0));
});

test('soft mismatches lower the score without rejecting', () => {
  const loc = evaluateMatch({ ...P, location: 'پونک' }, N);
  assert.equal(loc.rejected, false);
  assert.ok(loc.score < evaluateMatch(P, N).score);
  const bed = evaluateMatch({ ...P, bedrooms: 3 }, N);
  assert.equal(bed.reasons.find((x) => x.factor === 'bedrooms')?.status, 'partial');
});

test('ranking and suggestions', () => {
  const worse: Property = { ...P, id: 'p2', location: 'پونک', rent: 19e6 };
  const rejected: Property = { ...P, id: 'p3', area: 50 };
  const res = findMatchesForNeed(N, [worse, rejected, P]);
  assert.deepEqual(res.map((x) => x.propertyId), ['p1', 'p2']);
  const top = suggestTopMatches([N], [P, worse, rejected], 60);
  assert.equal(top[0].property.id, 'p1');
});

test('need with no soft criteria scores 0, not a fake 100', () => {
  const bare: Need = { ...N, propertyType: null, minArea: null, maxArea: null, bedrooms: null, location: '', maxDeposit: null, maxRent: null };
  const r = evaluateMatch(P, bare);
  assert.equal(r.rejected, false);
  assert.equal(r.score, 0);
});
