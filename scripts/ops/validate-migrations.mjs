import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationDirectory = join(process.cwd(), 'apps/api/database/migrations');
const files = readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql')).sort();
if (files.length === 0) throw new Error('No SQL migration files were found.');

const firstCreator = new Map();
const failures = [];
for (const file of files) {
  const source = readFileSync(join(migrationDirectory, file), 'utf8');
  if (!source.trim()) {
    failures.push(`${file}: migration is empty`);
    continue;
  }
  const expression = /\\bCREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_$]*))/gi;
  let match;
  while ((match = expression.exec(source)) !== null) {
    const conditional = Boolean(match[1]);
    const table = (match[2] || match[3]).toLowerCase();
    const previous = firstCreator.get(table);
    if (previous && !conditional) {
      failures.push(`${file}: unconditional CREATE TABLE for "${table}" duplicates ${previous}`);
    } else if (!previous) {
      firstCreator.set(table, file);
    }
  }
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`ERROR: ${failure}\\n`);
  process.exit(1);
}
process.stdout.write(`Validated ${files.length} migration files; no empty files or duplicate unconditional table creation found.\\n`);
