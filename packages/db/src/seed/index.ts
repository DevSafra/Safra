import { createDatabase } from '../client.js';
import { seed, warnIfNoFxRate } from './seed.js';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required.');
  }

  console.log('Seeding reference data...');
  const db = createDatabase(connectionString, 1);

  try {
    await seed(db);
    await warnIfNoFxRate(db);
    console.log('Seed complete.');
  } finally {
    // The pg Pool keeps the process alive otherwise.
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
