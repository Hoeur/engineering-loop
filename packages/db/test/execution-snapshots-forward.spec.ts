import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.ENGLOOP_SNAPSHOT_FORWARD_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))('Execution snapshots forward migration', () => {
  it('preserves legacy runs and prevents rewrites while allowing one running invocation snapshot', async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      if (
        (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows
          .length
      )
        throw new Error('Forward proof requires an empty explicit scratch database');
      const root = resolve('prisma/migrations');
      const names = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      const migration = names.find((name) => name.endsWith('_cp02c_execution_snapshots'));
      if (!migration) throw new Error('Snapshot migration missing');
      for (const name of names.filter((name) => name < migration))
        await client.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
      await client.query(
        `INSERT INTO organizations (id,name,slug,"updatedAt") VALUES ('snapshot-org','Preserved','snapshot-org',now())`,
      );
      await client.query(
        `INSERT INTO projects (id,"organizationId",name,slug,key,"updatedAt") VALUES ('snapshot-project','snapshot-org','Preserved','snapshot-project','S',now())`,
      );
      await client.query(
        `INSERT INTO tasks (id,"projectId",key,title,status,"updatedAt") VALUES ('snapshot-task','snapshot-project','S-1','Preserved','IMPLEMENTING',now())`,
      );
      await client.query(
        `INSERT INTO workflow_runs (id,"projectId","taskId","definitionKey",state,"updatedAt") VALUES ('snapshot-workflow','snapshot-project','snapshot-task','engineering-task','{"preserved":true}',now())`,
      );
      await client.query(
        `INSERT INTO agent_runs (id,"taskId",role,"providerKey",status,input,"updatedAt") VALUES ('snapshot-agent','snapshot-task','IMPLEMENTER','mock','RUNNING','{"preserved":true}',now())`,
      );
      const before = {
        tasks: (await client.query('SELECT * FROM tasks')).rows,
        workflows: (await client.query('SELECT * FROM workflow_runs')).rows,
        agents: (await client.query('SELECT * FROM agent_runs')).rows,
      };
      await client.query(await readFile(resolve(root, migration, 'migration.sql'), 'utf8'));
      expect((await client.query('SELECT * FROM tasks')).rows).toEqual(before.tasks);
      const workflows = (await client.query('SELECT * FROM workflow_runs')).rows;
      const agents = (await client.query('SELECT * FROM agent_runs')).rows;
      expect(workflows).toEqual(
        before.workflows.map((row) => ({ ...row, executionSnapshot: null })),
      );
      expect(agents).toEqual(before.agents.map((row) => ({ ...row, executionSnapshot: null })));
      await expect(
        client.query(
          `UPDATE workflow_runs SET "executionSnapshot"='{}' WHERE id='snapshot-workflow'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await client.query(
        `INSERT INTO workflow_runs (id,"projectId","taskId","definitionKey","executionSnapshot","updatedAt") VALUES ('snapshot-frozen','snapshot-project','snapshot-task','engineering-task','{"version":1}',now())`,
      );
      await expect(
        client.query(
          `UPDATE workflow_runs SET "executionSnapshot"=null WHERE id='snapshot-frozen'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await client.query(
        `UPDATE workflow_runs SET state='{"progress":true}' WHERE id='snapshot-frozen'`,
      );
      await client.query(
        `UPDATE agent_runs SET "executionSnapshot"='{"context":"frozen"}' WHERE id='snapshot-agent'`,
      );
      await expect(
        client.query(`UPDATE agent_runs SET "executionSnapshot"='{}' WHERE id='snapshot-agent'`),
      ).rejects.toMatchObject({ code: '23514' });
      await client.query(`UPDATE agent_runs SET status='SUCCEEDED' WHERE id='snapshot-agent'`);
      await client.query(
        `INSERT INTO agent_runs (id,role,"providerKey",status,"updatedAt") VALUES ('snapshot-cancelled','IMPLEMENTER','mock','CANCELLED',now())`,
      );
      await expect(
        client.query(
          `UPDATE agent_runs SET "executionSnapshot"='{}' WHERE id='snapshot-cancelled'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.end();
    }
  });
});
