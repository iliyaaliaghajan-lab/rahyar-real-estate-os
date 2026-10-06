import { db } from './db';
import { buildDemoData } from './demoData';

export async function loadDemoData(): Promise<void> {
  const { properties, clients, needs, followUps, activities } = buildDemoData();
  await db.transaction('rw', [db.properties, db.clients, db.needs, db.followUps, db.activities], async () => {
    await db.properties.bulkPut(properties);
    await db.clients.bulkPut(clients);
    await db.needs.bulkPut(needs);
    await db.followUps.bulkPut(followUps);
    await db.activities.bulkPut(activities);
  });
}

/** First launch: load demo data once. Never re-seeds after the user has deleted it. */
export async function ensureSeeded(): Promise<void> {
  if (await db.meta.get('seeded')) return;
  const existing = (await db.properties.count()) + (await db.clients.count());
  if (existing === 0) await loadDemoData();
  await db.meta.put({ key: 'seeded', value: true });
}
