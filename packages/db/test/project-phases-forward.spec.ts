import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.ENGLOOP_PHASE_FORWARD_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))(
  'Project phases forward migration on an explicit empty scratch DB',
  () => {
    it('preserves existing project/task data and adds null membership', async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        const tables = await client.query(
          "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
        );
        if (tables.rows.length > 0)
          throw new Error(
            'Forward proof requires an empty scratch database; no reset is performed',
          );
        const root = resolve('prisma/migrations');
        const migrations = (await readdir(root, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort();
        const phaseMigration = migrations.find((name) => name.endsWith('_add_project_phases'));
        if (!phaseMigration) throw new Error('Project phase migration is missing');
        for (const name of migrations.filter((name) => name < phaseMigration)) {
          await client.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
        }
        await client.query(
          `INSERT INTO organizations (id,name,slug,"updatedAt") VALUES ('forward-org','Preserved organization','forward-org',now())`,
        );
        await client.query(
          `INSERT INTO projects (id,"organizationId",name,slug,key,"updatedAt") VALUES ('forward-project','forward-org','Preserved project','forward-project','FWD',now())`,
        );
        await client.query(
          `INSERT INTO tasks (id,"projectId",key,title,status,"updatedAt") VALUES ('forward-task','forward-project','FWD-1','Preserved existing task','BACKLOG',now())`,
        );
        const before = (await client.query('SELECT * FROM tasks')).rows;
        const beforeProject = (await client.query('SELECT * FROM projects')).rows;
        await client.query('BEGIN');
        await client.query(await readFile(resolve(root, phaseMigration, 'migration.sql'), 'utf8'));
        await client.query('COMMIT');
        const after = (await client.query('SELECT * FROM tasks')).rows as Record<string, unknown>[];
        expect(after).toEqual(
          before.map((row: Record<string, unknown>) => ({ ...row, phaseId: null })),
        );
        expect((await client.query('SELECT * FROM projects')).rows).toEqual(beforeProject);
        expect((await client.query('SELECT * FROM project_phases')).rows).toEqual([]);
      } finally {
        await client.end();
      }
    }, 60_000);
  },
);
