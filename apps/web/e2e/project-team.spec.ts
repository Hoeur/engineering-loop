import { randomUUID } from 'node:crypto';
import type { ProjectTeam } from '@engloop/types';
import { AgentRole } from '@engloop/types';
import { expect, test } from './fixtures';

const apiUrl = (process.env.E2E_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
test.skip(
  process.env.E2E_TEAM_ACCEPTANCE_WRITE !== '1',
  'Set E2E_TEAM_ACCEPTANCE_WRITE=1 against a scratch database; unique project and agent fixtures are retained.',
);

test('edits explicit team membership and shows phase coverage without changing permissions', async ({
  page,
  request,
  authToken,
}, testInfo) => {
  const headers = { authorization: `Bearer ${authToken}` };
  const suffix = randomUUID().slice(0, 8);
  const me = await request.get(`${apiUrl}/auth/me`, { headers });
  const user = (await me.json()) as { data: { organizationId: string } };
  const created = await request.post(`${apiUrl}/projects`, {
    headers,
    data: {
      organizationId: user.data.organizationId,
      name: `Team acceptance ${suffix}`,
      slug: `team-${suffix}`,
      key: `T${suffix.toUpperCase()}`,
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const projectId = ((await created.json()) as { data: { id: string } }).data.id;
  const teamPath = `${apiUrl}/projects/${projectId}/team`;
  const agentsResponse = await request.get(`${apiUrl}/agents?projectId=${projectId}`, { headers });
  const agents = (
    (await agentsResponse.json()) as {
      data: {
        items: {
          id: string;
          role: string;
          name: string;
          permissionLevel: string;
          enabled: boolean;
        }[];
      };
    }
  ).data.items;
  const planner = agents.find((agent) => agent.enabled && agent.role === AgentRole.PLANNER)!;
  const reviewer = agents.find((agent) => agent.enabled && agent.role === AgentRole.CODE_REVIEWER)!;
  expect(planner).toBeTruthy();
  expect(reviewer).toBeTruthy();
  const phaseResponse = await request.post(`${apiUrl}/projects/${projectId}/phases`, {
    headers,
    data: { name: 'Delivery', requiredRoles: [AgentRole.PLANNER, AgentRole.CODE_REVIEWER] },
  });
  expect(phaseResponse.ok(), await phaseResponse.text()).toBe(true);
  const phaseId = ((await phaseResponse.json()) as { data: { id: string } }).data.id;
  const disabledName = `Disabled QA ${suffix}`;
  const disabled = await request.post(`${apiUrl}/agents`, {
    headers,
    data: {
      projectId,
      name: disabledName,
      providerKey: 'mock',
      role: AgentRole.QA,
      enabled: false,
    },
  });
  expect(disabled.ok(), await disabled.text()).toBe(true);
  await testInfo.attach('retained-scratch-fixtures', {
    contentType: 'application/json',
    body: JSON.stringify({ projectId, phaseId }),
  });
  await page.goto(`/projects/${projectId}`);
  const team = page.getByRole('region', { name: 'Project team' });
  await expect(team.getByText('No team members assigned.')).toBeVisible();
  await expect(team.getByText('Missing roles: PLANNER, CODE_REVIEWER')).toBeVisible();
  await team.getByRole('button', { name: 'Edit team', exact: true }).click();
  await expect(team.getByRole('checkbox', { name: new RegExp(disabledName) })).toBeDisabled();
  await team.getByRole('checkbox', { name: `${planner.name} (PLANNER)`, exact: true }).check();
  await team
    .getByRole('checkbox', { name: `${reviewer.name} (CODE_REVIEWER)`, exact: true })
    .check();
  await team.getByRole('checkbox', { name: 'PLANNER', exact: true }).check();
  await team.getByRole('button', { name: 'Save team', exact: true }).click();
  await expect(team.getByRole('button', { name: 'Edit team', exact: true })).toBeVisible();
  const savedResponse = await request.get(teamPath, { headers });
  const saved = ((await savedResponse.json()) as { data: ProjectTeam }).data;
  expect(saved.memberIds.sort()).toEqual([planner.id, reviewer.id].sort());
  expect(saved.phases[0]?.missingRoles).toEqual([]);
  expect(JSON.stringify(saved)).not.toMatch(
    /encryptedCredential|credentialIv|credentialAuthTag|systemPrompt|permissionLevel|"values"/,
  );
  const unchanged = (
    (await (await request.get(`${apiUrl}/agents/${planner.id}`, { headers })).json()) as {
      data: { permissionLevel: string };
    }
  ).data;
  expect(unchanged.permissionLevel).toBe(planner.permissionLevel);
  const phases = page.getByRole('region', { name: 'Project phases' });
  await phases.getByRole('button', { name: 'Activate phase', exact: true }).click();
  await phases.getByRole('button', { name: 'Confirm activation', exact: true }).click();
  await expect(team.getByText(/Team edits are locked/)).toBeVisible();
  const locked = await request.put(teamPath, {
    headers,
    data: { expectedVersion: saved.version, memberIds: [], requiredRoles: [] },
  });
  expect(locked.status()).toBe(409);
  await phases.getByRole('button', { name: 'Reopen draft', exact: true }).click();
  await phases.getByRole('button', { name: 'Confirm reopen', exact: true }).click();
  await expect(team.getByRole('button', { name: 'Edit team', exact: true })).toBeVisible();
  await team.getByRole('button', { name: 'Edit team', exact: true }).click();
  await team.getByRole('checkbox', { name: `${planner.name} (PLANNER)`, exact: true }).uncheck();
  await team
    .getByRole('checkbox', { name: `${reviewer.name} (CODE_REVIEWER)`, exact: true })
    .uncheck();
  await team.getByRole('checkbox', { name: 'PLANNER', exact: true }).uncheck();
  await team.getByRole('button', { name: 'Save team', exact: true }).click();
  await expect(team.getByText('No team members assigned.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await team.screenshot({ path: testInfo.outputPath('project-team.png') });
});
