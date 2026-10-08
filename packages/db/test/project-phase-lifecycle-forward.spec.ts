import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.ENGLOOP_PHASE_LIFECYCLE_FORWARD_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))('Phase lifecycle additive forward migration', () => {
  it('backfills existing phases as DRAFT without altering legacy task/workflow state', async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      if (
        (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows
          .length
      )
        throw new Error('Forward migration proof requires an empty explicit scratch database');
      const root = resolve('prisma/migrations');
      const names = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      const lifecycle = names.find((name) => name.endsWith('_add_project_phase_lifecycle'));
      if (!lifecycle) throw new Error('Lifecycle migration missing');
      for (const name of names.filter((name) => name < lifecycle))
        await client.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
      await client.query(
        `INSERT INTO organizations (id,name,slug,"updatedAt") VALUES ('lc-org','Preserved','lc-org',now())`,
      );
      await client.query(
        `INSERT INTO projects (id,"organizationId",name,slug,key,"updatedAt") VALUES ('lc-project','lc-org','Preserved','lc-project','LC',now())`,
      );
      await client.query(
        `INSERT INTO project_phases (id,"projectId",name,position,"updatedAt") VALUES ('lc-phase','lc-project','Preserved phase',0,now())`,
      );
      await client.query(
        `INSERT INTO tasks (id,"projectId","phaseId",key,title,status,"updatedAt") VALUES ('lc-task','lc-project','lc-phase','LC-1','Preserved task','IMPLEMENTING',now())`,
      );
      await client.query(
        `INSERT INTO workflow_runs (id,"definitionKey","projectId","taskId",status,"updatedAt") VALUES ('lc-run','engineering','lc-project','lc-task','RUNNING',now())`,
      );
      const beforePhase = (await client.query('SELECT * FROM project_phases')).rows;
      const beforeTask = (await client.query('SELECT * FROM tasks')).rows;
      const beforeRun = (await client.query('SELECT * FROM workflow_runs')).rows;
      await client.query(await readFile(resolve(root, lifecycle, 'migration.sql'), 'utf8'));
      expect((await client.query('SELECT * FROM project_phases')).rows).toEqual(
        beforePhase.map((phase: Record<string, unknown>) => ({ ...phase, status: 'DRAFT' })),
      );
      expect((await client.query('SELECT * FROM tasks')).rows).toEqual(beforeTask);
      expect((await client.query('SELECT * FROM workflow_runs')).rows).toEqual(beforeRun);
    } finally {
      await client.end();
    }
  }, 60_000);
});
