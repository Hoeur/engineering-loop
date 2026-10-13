import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.ENGLOOP_TEAM_FORWARD_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))(
  'Team forward migration on an explicit empty scratch DB',
  () => {
    it('adds empty membership and requirements while preserving agents, configs, phases and running history', async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        if (
          (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows
            .length
        )
          throw new Error(
            'Forward proof requires an empty scratch database; no reset is performed',
          );
        const root = resolve('prisma/migrations');
        const names = (await readdir(root, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort();
        const migration = names.find((name) => name.endsWith('_add_project_team'));
        if (!migration) throw new Error('Team migration missing');
        for (const name of names.filter((name) => name < migration))
          await client.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
        await client.query(
          `INSERT INTO organizations (id,name,slug,"updatedAt") VALUES ('org','Preserved','team-forward',now())`,
        );
        await client.query(
          `INSERT INTO projects (id,"organizationId",name,slug,key,"roleAssignments","updatedAt") VALUES ('project','org','Preserved','team','TF','{"PLANNER":"mock"}',now())`,
        );
        await client.query(
          `INSERT INTO project_phases (id,"projectId",name,position,status,"requiredRoles","updatedAt") VALUES ('phase','project','Build',0,'ACTIVE',ARRAY['PLANNER']::"AgentRole"[],now())`,
        );
        await client.query(
          `INSERT INTO tasks (id,"projectId","phaseId",key,title,status,"updatedAt") VALUES ('task','project','phase','TF-1','Running','IMPLEMENTING',now())`,
        );
        await client.query(
          `INSERT INTO agent_providers (id,"organizationId",key,"displayName",kind,"updatedAt") VALUES ('provider','org','mock','Mock','MOCK',now())`,
        );
        await client.query(
          `INSERT INTO agents (id,"organizationId","providerId",name,role,"updatedAt") VALUES ('agent','org','provider','Planner','PLANNER',now())`,
        );
        await client.query(
          `INSERT INTO agent_configurations (id,"agentId",version,values) VALUES ('config','agent',1,'{"private":"preserved"}')`,
        );
        await client.query(
          `INSERT INTO workflow_runs (id,"projectId","taskId","definitionKey",status,"updatedAt") VALUES ('workflow','project','task','engineering-task','RUNNING',now())`,
        );
        const tables = [
          'organizations',
          'project_phases',
          'tasks',
          'agent_providers',
          'agents',
          'agent_configurations',
          'workflow_runs',
        ];
        const before = new Map<string, unknown>();
        for (const table of tables)
          before.set(table, (await client.query(`SELECT * FROM ${table}`)).rows);
        const project = (await client.query('SELECT * FROM projects')).rows;
        for (const name of names.filter((name) => name >= migration))
          await client.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
        for (const table of tables)
          expect((await client.query(`SELECT * FROM ${table}`)).rows).toEqual(before.get(table));
        expect(
          (
            await client.query(
              'SELECT *, "teamRequiredRoles"::text[] AS "teamRequiredRoles" FROM projects',
            )
          ).rows,
        ).toEqual(
          project.map((row: Record<string, unknown>) => ({
            ...row,
            teamRequiredRoles: [],
            teamConfigured: false,
            teamVersion: 0,
          })),
        );
        expect((await client.query('SELECT * FROM project_team_members')).rows).toEqual([]);
        await client.query(
          `INSERT INTO project_team_members ("projectId","agentId") VALUES ('project','agent')`,
        );
        await expect(
          client.query(
            `INSERT INTO project_team_members ("projectId","agentId") VALUES ('project','agent')`,
          ),
        ).rejects.toThrow(/duplicate key/iu);
        await expect(
          client.query(
            `INSERT INTO project_team_members ("projectId","agentId") VALUES ('project','missing')`,
          ),
        ).rejects.toThrow(/foreign key/iu);
      } finally {
        await client.end();
      }
    }, 60_000);
  },
);
