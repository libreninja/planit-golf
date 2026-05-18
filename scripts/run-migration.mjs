#!/usr/bin/env node
// Run migrations using Supabase service role
// Usage: node scripts/run-migration.mjs 021

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const migrationNumber = process.argv[2];
if (!migrationNumber) {
  console.error('Usage: node run-migration.mjs <migration_number>');
  console.error('Example: node run-migration.mjs 021');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false }
});

async function runMigration() {
  const migrationFile = join(__dirname, '..', 'supabase', 'migrations', `${migrationNumber}_*.sql`);

  // Find the file
  const fs = await import('fs');
  const path = await import('path');
  const migrationsDir = join(__dirname, '..', 'supabase', 'migrations');

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.startsWith(`${migrationNumber}_`))
    .filter(f => f.endsWith('.sql'));

  if (files.length === 0) {
    console.error(`Migration ${migrationNumber} not found`);
    process.exit(1);
  }

  const file = files[0];
  const sql = readFileSync(join(migrationsDir, file), 'utf-8');

  console.log(`Running migration: ${file}`);

  // Split by statement and execute
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    console.log(`  Executing statement ${i + 1}/${statements.length}...`);

    const { error } = await supabase.rpc('exec_sql', { sql: stmt + ';' });

    if (error) {
      // Try direct REST API if RPC fails
      const res = await fetch(`${SUPABASE_URL}/rest/v1/sql`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'apikey': SERVICE_KEY
        },
        body: JSON.stringify({ query: stmt + ';' })
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`  Error: ${err}`);
        process.exit(1);
      }
    }
  }

  console.log('Migration complete!');
}

runMigration().catch(console.error);
