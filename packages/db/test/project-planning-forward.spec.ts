import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.ENGLOOP_PLANNING_FORWARD_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))(
  'Draft planning forward migration on an explicit empty scratch DB',
  () => {
    it('preserves existing projects, phases, task membership and workflow state', async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        if (
          (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows
            .length > 0
        )
          throw new Error(
            'Forward proof requires an empty scratch database; no reset is performed',
          );
        const root = resolve('prisma/migrations');
        const names = (await readdir(root, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort();
        const migration = names.find((name) => name.endsWith('_add_phase_planning_contract'));
        if (!migration) throw new Error('Planning migration missing');
        for (const name of names.filter((name) => name < migration))
          await client.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
        await client.query(
          `INSERT INTO organizations (id,name,slug,"updatedAt") VALUES ('planning-forward-org','Preserved organization','planning-forward-org',now())`,
        );
        await client.query(
          `INSERT INTO projects (id,"organizationId",name,slug,key,"updatedAt") VALUES ('planning-forward-project','planning-forward-org','Preserved project','planning-forward-project','PF',now())`,
        );
        await client.query(
          `INSERT INTO project_phases (id,"projectId",name,position,"updatedAt") VALUES ('planning-forward-phase','planning-forward-project','Preserved phase',0,now())`,
        );
        await client.query(
          `INSERT INTO tasks (id,"projectId","phaseId",key,title,status,"updatedAt") VALUES ('planning-forward-task','planning-forward-project','planning-forward-phase','PF-1','Preserved running task','IMPLEMENTING',now())`,
        );
        const beforeTasks = (await client.query('SELECT * FROM tasks')).rows;
        const beforeProjects = (await client.query('SELECT * FROM projects')).rows;
        const beforePhases = (await client.query('SELECT * FROM project_phases')).rows;
        await client.query('BEGIN');
        await client.query(await readFile(resolve(root, migration, 'migration.sql'), 'utf8'));
        await client.query('COMMIT');
        expect((await client.query('SELECT * FROM tasks')).rows).toEqual(beforeTasks);
        expect((await client.query('SELECT * FROM projects')).rows).toEqual(
          beforeProjects.map((row: Record<string, unknown>) => ({
            ...row,
            contractObjective: null,
            contractRequirements: [],
            contractNonGoals: [],
            contractAcceptanceCriteria: [],
          })),
        );
        expect(
          (
            await client.query(
              'SELECT *, "requiredRoles"::text[] AS "requiredRoles" FROM project_phases',
            )
          ).rows,
        ).toEqual(
          beforePhases.map((row: Record<string, unknown>) => ({
            ...row,
            objective: null,
            deliverables: [],
            acceptanceCriteria: [],
            requiredRoles: [],
          })),
        );
        expect((await client.query('SELECT * FROM project_phase_dependencies')).rows).toEqual([]);
        const constraints = (
          await client.query(
            "SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'project_phase_dependencies'::regclass",
          )
        ).rows as { conname: string; definition: string }[];
        expect(
          constraints.find(
            (constraint) => constraint.conname === 'project_phase_dependencies_no_self',
          )?.definition,
        ).toContain('CHECK');
        expect(
          constraints.filter((constraint) => constraint.definition.startsWith('FOREIGN KEY')),
        ).toHaveLength(2);
        await expect(
          client.query(
            `INSERT INTO project_phase_dependencies ("projectId","phaseId","dependsOnPhaseId") VALUES ('planning-forward-project','planning-forward-phase','planning-forward-phase')`,
          ),
        ).rejects.toThrow(/check constraint/iu);
        await client.query(
          `INSERT INTO projects (id,"organizationId",name,slug,key,"updatedAt") VALUES ('planning-other-project','planning-forward-org','Other project','planning-other-project','OTHER',now())`,
        );
        await client.query(
          `INSERT INTO project_phases (id,"projectId",name,position,"updatedAt") VALUES ('planning-other-phase','planning-other-project','Other phase',0,now())`,
        );
        await expect(
          client.query(
            `INSERT INTO project_phase_dependencies ("projectId","phaseId","dependsOnPhaseId") VALUES ('planning-forward-project','planning-forward-phase','planning-other-phase')`,
          ),
        ).rejects.toThrow(/foreign key constraint/iu);
      } finally {
        await client.end();
      }
    }, 60_000);
  },
);
