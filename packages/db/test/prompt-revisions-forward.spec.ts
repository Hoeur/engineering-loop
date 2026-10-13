import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.ENGLOOP_PROMPT_FORWARD_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))('Prompt revisions additive migration', () => {
  it('preserves existing project and task data and enforces revision uniqueness', async () => {
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
      const migration = names.find((name) => name.endsWith('_cp02b_prompt_revisions'));
      if (!migration) throw new Error('Prompt revision migration missing');
      for (const name of names.filter((name) => name < migration))
        await client.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
      await client.query(
        `INSERT INTO organizations (id,name,slug,"updatedAt") VALUES ('prompt-org','Preserved','prompt-org',now())`,
      );
      await client.query(
        `INSERT INTO projects (id,"organizationId",name,slug,key,settings,"updatedAt") VALUES ('prompt-project','prompt-org','Preserved','prompt-project','P','{"preserved":true}',now())`,
      );
      await client.query(
        `INSERT INTO tasks (id,"projectId",key,title,status,"updatedAt") VALUES ('prompt-task','prompt-project','P-1','Preserved','IMPLEMENTING',now())`,
      );
      const projects = (await client.query('SELECT * FROM projects')).rows;
      const tasks = (await client.query('SELECT * FROM tasks')).rows;
      await client.query(await readFile(resolve(root, migration, 'migration.sql'), 'utf8'));
      expect((await client.query('SELECT * FROM projects')).rows).toEqual(projects);
      expect((await client.query('SELECT * FROM tasks')).rows).toEqual(tasks);
      expect((await client.query('SELECT * FROM prompt_templates')).rows).toEqual([]);
      await client.query(
        `INSERT INTO prompt_templates (id,"projectId",name,role) VALUES ('template','prompt-project','Prompt','IMPLEMENTER')`,
      );
      await client.query(
        `INSERT INTO prompt_revisions (id,"templateId",revision,body) VALUES ('revision','template',1,'Preserved text')`,
      );
      await expect(
        client.query(
          `INSERT INTO prompt_revisions (id,"templateId",revision,body) VALUES ('duplicate','template',1,'Other')`,
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        client.query(
          `INSERT INTO prompt_revisions (id,"templateId",revision,body) VALUES ('orphan','missing',1,'Other')`,
        ),
      ).rejects.toMatchObject({ code: '23503' });
    } finally {
      await client.end();
    }
  }, 60000);
});
