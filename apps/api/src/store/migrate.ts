import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Forward-only SQL migrations.
 *
 * Each file in db/migrations runs once, in name order, inside a
 * transaction, and is recorded in schema_migrations. An advisory lock
 * stops two deploys from migrating at the same time.
 */
export async function migrate(connectionString: string, directory = 'db/migrations', log: (line: string) => void = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((row: { name: string }) => row.name));
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(directory, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
    if (applied.length === 0) log('database is up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
    await client.end();
  }
  return applied;
}
