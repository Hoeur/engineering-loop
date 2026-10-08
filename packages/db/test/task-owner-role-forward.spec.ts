import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.ENGLOOP_OWNER_ROLE_FORWARD_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))('Task owner role additive migration', () => {
  it('preserves existing phased tasks and workflow history with null owner roles', async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      if (
        (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows
          .length
      )
        throw new Error('Forward proof requires an empty explicit scratch database');
      const root = resolve('prisma/migrations');
      const names = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      const migration = names.find((name) => name.endsWith('_add_planned_task_owner_role'));
      if (!migration) throw new Error('Owner role migration missing');
      for (const name of names.filter((name) => name < migration))
        await client.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
      await client.query(
        `INSERT INTO organizations (id,name,slug,"updatedAt") VALUES ('or-org','Preserved','or-org',now())`,
      );
      await client.query(
        `INSERT INTO projects (id,"organizationId",name,slug,key,"updatedAt") VALUES ('or-project','or-org','Preserved','or-project','OR',now())`,
      );
      await client.query(
        `INSERT INTO project_phases (id,"projectId",name,position,status,"updatedAt") VALUES ('or-phase','or-project','Preserved phase',0,'ACTIVE',now())`,
      );
      await client.query(
        `INSERT INTO tasks (id,"projectId","phaseId",key,title,status,"updatedAt") VALUES ('or-task','or-project','or-phase','OR-1','Preserved task','IMPLEMENTING',now())`,
      );
      await client.query(
        `INSERT INTO workflow_runs (id,"definitionKey","projectId","taskId",status,"updatedAt") VALUES ('or-run','engineering','or-project','or-task','RUNNING',now())`,
      );
      const phases = (await client.query('SELECT * FROM project_phases')).rows;
      const tasks = (await client.query('SELECT * FROM tasks')).rows;
      const runs = (await client.query('SELECT * FROM workflow_runs')).rows;
      await client.query(await readFile(resolve(root, migration, 'migration.sql'), 'utf8'));
      expect((await client.query('SELECT * FROM tasks')).rows).toEqual(
        tasks.map((task: Record<string, unknown>) => ({ ...task, ownerRole: null })),
      );
      expect((await client.query('SELECT * FROM project_phases')).rows).toEqual(phases);
      expect((await client.query('SELECT * FROM workflow_runs')).rows).toEqual(runs);
    } finally {
      await client.end();
    }
  }, 60_000);
});
