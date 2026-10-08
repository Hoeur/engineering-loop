import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.ENGLOOP_TEAM_FORWARD_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))('Project team additive migration', () => {
  it('preserves project configuration and agent/provider data with opt-in defaults', async () => {
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
      const migration = names.find((name) => name.endsWith('_cp02a_project_team'));
      if (!migration) throw new Error('Project team migration missing');
      for (const name of names.filter((name) => name < migration))
        await client.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
      await client.query(
        `INSERT INTO organizations (id,name,slug,"updatedAt") VALUES ('team-org','Preserved','team-org',now())`,
      );
      await client.query(
        `INSERT INTO projects (id,"organizationId",name,slug,key,"roleAssignments",settings,"updatedAt") VALUES ('team-project','team-org','Preserved','team-project','TEAM','{"IMPLEMENTER":"team-agent"}','{"preserved":true}',now())`,
      );
      await client.query(
        `INSERT INTO agent_providers (id,"organizationId",key,"displayName",kind,"encryptedCredential","updatedAt") VALUES ('team-provider','team-org','mock','Preserved','MOCK','preserved-secret',now())`,
      );
      await client.query(
        `INSERT INTO agents (id,"organizationId","projectId","providerId",name,role,"updatedAt") VALUES ('team-agent','team-org','team-project','team-provider','Preserved','IMPLEMENTER',now())`,
      );
      await client.query(
        `INSERT INTO project_phases (id,"projectId",name,position,status,"updatedAt") VALUES ('team-phase','team-project','Preserved phase',0,'ACTIVE',now())`,
      );
      await client.query(
        `INSERT INTO tasks (id,"projectId","phaseId",key,title,status,"updatedAt") VALUES ('team-task','team-project','team-phase','TEAM-1','Preserved task','IMPLEMENTING',now())`,
      );
      await client.query(
        `INSERT INTO workflow_runs (id,"definitionKey","projectId","taskId",status,"updatedAt") VALUES ('team-run','engineering','team-project','team-task','RUNNING',now())`,
      );
      const projects = (await client.query('SELECT * FROM projects')).rows;
      const agents = (await client.query('SELECT * FROM agents')).rows;
      const providers = (await client.query('SELECT * FROM agent_providers')).rows;
      const phases = (await client.query('SELECT * FROM project_phases')).rows;
      const tasks = (await client.query('SELECT * FROM tasks')).rows;
      const runs = (await client.query('SELECT * FROM workflow_runs')).rows;
      await client.query(await readFile(resolve(root, migration, 'migration.sql'), 'utf8'));
      expect((await client.query('SELECT * FROM projects')).rows).toEqual(
        projects.map((project: Record<string, unknown>) => ({
          ...project,
          teamConfigured: false,
          teamVersion: 0,
        })),
      );
      expect((await client.query('SELECT * FROM agents')).rows).toEqual(agents);
      expect((await client.query('SELECT * FROM agent_providers')).rows).toEqual(providers);
      expect((await client.query('SELECT * FROM project_phases')).rows).toEqual(phases);
      expect((await client.query('SELECT * FROM tasks')).rows).toEqual(tasks);
      expect((await client.query('SELECT * FROM workflow_runs')).rows).toEqual(runs);
      expect((await client.query('SELECT * FROM project_team_members')).rows).toEqual([]);
      await client.query(
        `INSERT INTO project_team_members ("projectId","agentId") VALUES ('team-project','team-agent')`,
      );
      await expect(
        client.query(
          `INSERT INTO project_team_members ("projectId","agentId") VALUES ('team-project','team-agent')`,
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        client.query(
          `INSERT INTO project_team_members ("projectId","agentId") VALUES ('team-project','missing')`,
        ),
      ).rejects.toMatchObject({ code: '23503' });
    } finally {
      await client.end();
    }
  }, 60_000);
});
