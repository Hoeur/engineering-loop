import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { AgentRole, TaskStatus, type ProjectContract } from '@engloop/types';
import { expect, test } from './fixtures';

const apiUrl = (process.env.E2E_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
interface Phase {
  id: string;
  name: string;
  position: number;
  objective: string | null;
  deliverables: string[];
  acceptanceCriteria: string[];
  requiredRoles: AgentRole[];
  dependencyIds: string[];
}
interface Task {
  id: string;
  key: string;
  title: string;
  status: string;
  phaseId: string | null;
}

const read = async <T>(request: APIRequestContext, path: string, token: string): Promise<T> => {
  const response = await request.get(`${apiUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { data: T }).data;
};

test.skip(
  process.env.E2E_PHASE_ACCEPTANCE_WRITE !== '1',
  'Set E2E_PHASE_ACCEPTANCE_WRITE=1 against a scratch database: the API has no project/task delete route, so unique acceptance fixtures are retained.',
);

test('manages draft phases and task membership without changing task execution at every width', async ({
  page,
  request,
  authToken,
}, testInfo) => {
  const headers = { authorization: `Bearer ${authToken}` };
  const suffix = randomUUID().slice(0, 8);
  const user = await read<{ organizationId: string }>(request, '/auth/me', authToken);
  const projectResponse = await request.post(`${apiUrl}/projects`, {
    headers,
    data: {
      organizationId: user.organizationId,
      name: `Phase acceptance ${suffix}`,
      slug: `phase-acceptance-${suffix}`,
      key: `T${suffix.toUpperCase()}`,
    },
  });
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true);
  const projectId = ((await projectResponse.json()) as { data: { id: string } }).data.id;
  const path = `/projects/${projectId}/phases`;
  const taskResponse = await request.post(`${apiUrl}/tasks`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: { projectId, title: `Phase acceptance task ${suffix}` },
  });
  expect(taskResponse.ok(), await taskResponse.text()).toBe(true);
  const task = ((await taskResponse.json()) as { data: Task }).data;
  expect(task.status).toBe(TaskStatus.BACKLOG);
  const originalPhaseId = task.phaseId;
  await testInfo.attach('retained-scratch-fixture', {
    contentType: 'application/json',
    body: JSON.stringify({ projectId, taskId: task.id, apiUrl }),
  });
  const firstName = `Phase acceptance ${suffix} A`;
  const secondName = `Phase acceptance ${suffix} B`;
  const editedName = `${firstName} edited`;
  const createdIds: string[] = [];
  const phases = page.getByRole('region', { name: 'Project phases' });
  const card = (name: string) =>
    phases
      .locator('div.rounded-lg')
      .filter({ has: page.getByRole('heading', { name: new RegExp(`^\\d+\\. ${name}$`) }) })
      .filter({ has: page.getByRole('button', { name: 'Delete', exact: true }) })
      .last();

  try {
    await page.goto(`/projects/${projectId!}`);
    const contract = page.getByRole('region', { name: 'Project contract' });
    await contract.getByRole('button', { name: 'Edit contract', exact: true }).click();
    await contract
      .getByLabel('Project objective', { exact: true })
      .fill('Deliver an auditable platform');
    await contract
      .getByLabel('Requirements (one per line)')
      .fill('Preserve history\nIsolate tasks');
    await contract.getByLabel('Non-goals (one per line)').fill('Replace legacy flows');
    await contract.getByLabel('Project acceptance criteria (one per line)').fill('All gates pass');
    await contract.getByRole('button', { name: 'Save contract', exact: true }).click();
    await expect(
      contract.getByRole('button', { name: 'Edit contract', exact: true }),
    ).toBeVisible();
    await expect(
      contract.getByText('Deliver an auditable platform', { exact: true }),
    ).toBeVisible();
    expect(
      await read<ProjectContract>(request, `/projects/${projectId}/contract`, authToken),
    ).toEqual({
      objective: 'Deliver an auditable platform',
      requirements: ['Preserve history', 'Isolate tasks'],
      nonGoals: ['Replace legacy flows'],
      acceptanceCriteria: ['All gates pass'],
    });
    await expect(phases.getByRole('button', { name: 'Add phase', exact: true })).toBeVisible();
    for (const name of [firstName, secondName]) {
      await phases.getByLabel('Phase name', { exact: true }).fill(name);
      await phases
        .getByLabel('Phase objective', { exact: true })
        .fill(name === firstName ? 'Define the domain' : 'Implement the next phase');
      await phases
        .getByLabel('Deliverables (one per line)')
        .fill(name === firstName ? 'Schema artifact\nAPI contract' : 'Next deliverable');
      await phases.getByLabel('Phase acceptance criteria (one per line)').fill('Verified checks');
      await phases.getByRole('checkbox', { name: AgentRole.PLANNER, exact: true }).check();
      if (name === secondName)
        await phases.getByRole('checkbox', { name: firstName, exact: true }).check();
      await phases.getByRole('button', { name: 'Add phase', exact: true }).click();
      await expect(
        phases.getByRole('button', { name: `Move ${name} up`, exact: true }),
      ).toBeVisible();
      const items = (await read<{ items: Phase[] }>(request, path, authToken)).items;
      createdIds.push(items.find((item) => item.name === name)!.id);
    }
    await card(firstName).getByRole('button', { name: 'Edit', exact: true }).click();
    await phases.getByLabel('Phase name', { exact: true }).fill(editedName);
    await phases.getByRole('checkbox', { name: secondName, exact: true }).check();
    await phases.getByRole('button', { name: 'Save phase', exact: true }).click();
    await expect(phases.getByRole('alert')).toContainText(/cycle/i);
    await expect(phases.getByLabel('Phase name', { exact: true })).toHaveValue(editedName);
    await expect(phases.getByRole('checkbox', { name: secondName, exact: true })).toBeChecked();
    expect(
      (await read<{ items: Phase[] }>(request, path, authToken)).items.find(
        (item) => item.id === createdIds[0],
      )?.dependencyIds,
    ).toEqual([]);
    await phases.getByRole('checkbox', { name: secondName, exact: true }).uncheck();
    await phases.getByRole('button', { name: 'Save phase', exact: true }).click();
    await expect(
      phases.getByRole('button', { name: `Move ${editedName} up`, exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(contract.getByText('Preserve history', { exact: true })).toBeVisible();
    await expect(card(editedName).getByText('Schema artifact', { exact: true })).toBeVisible();
    const persisted = (await read<{ items: Phase[] }>(request, path, authToken)).items;
    expect(persisted.find((item) => item.id === createdIds[0])).toMatchObject({
      name: editedName,
      objective: 'Define the domain',
      deliverables: ['Schema artifact', 'API contract'],
      acceptanceCriteria: ['Verified checks'],
      requiredRoles: [AgentRole.PLANNER],
      dependencyIds: [],
    });
    expect(persisted.find((item) => item.id === createdIds[1])?.dependencyIds).toEqual([
      createdIds[0],
    ]);
    await phases.getByRole('button', { name: `Move ${secondName} up`, exact: true }).click();
    await expect
      .poll(async () =>
        (await read<{ items: Phase[] }>(request, path, authToken)).items
          .slice(-2)
          .map((phase) => phase.name),
      )
      .toEqual([secondName, editedName]);

    await card(editedName)
      .getByLabel('Link or move an existing project task')
      .selectOption(task!.id);
    await card(editedName).getByRole('button', { name: 'Link task', exact: true }).click();
    await expect(
      card(editedName).getByRole('button', { name: `Unlink ${task!.key}`, exact: true }),
    ).toBeVisible();
    await card(editedName)
      .getByRole('button', { name: `Unlink ${task!.key}`, exact: true })
      .click();
    await expect(
      card(editedName).getByRole('button', { name: `Unlink ${task!.key}`, exact: true }),
    ).toHaveCount(0);
    await card(secondName)
      .getByLabel('Link or move an existing project task')
      .selectOption(task!.id);
    await card(secondName).getByRole('button', { name: 'Link task', exact: true }).click();
    await expect(
      card(secondName).getByRole('button', { name: `Unlink ${task!.key}`, exact: true }),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await phases.screenshot({ path: testInfo.outputPath('draft-phase-management.png') });
    await card(secondName).getByRole('button', { name: 'Delete', exact: true }).click();
    await card(secondName).getByRole('button', { name: 'Confirm delete', exact: true }).click();
    await expect(
      phases.getByRole('button', { name: `Move ${secondName} up`, exact: true }),
    ).toHaveCount(0);
    const afterDelete = await read<Task>(request, `/tasks/${task!.id}`, authToken);
    expect(afterDelete.phaseId).toBeNull();
    expect(afterDelete.status).toBe(task!.status);
  } finally {
    const current = await read<Task>(request, `/tasks/${task!.id}`, authToken);
    if (originalPhaseId) {
      const restored = await request.put(`${apiUrl}${path}/${originalPhaseId}/tasks/${task!.id}`, {
        headers,
      });
      expect(restored.ok(), await restored.text()).toBe(true);
    } else if (current.phaseId && createdIds.includes(current.phaseId)) {
      const restored = await request.delete(
        `${apiUrl}${path}/${current.phaseId}/tasks/${task!.id}`,
        { headers },
      );
      expect(restored.ok(), await restored.text()).toBe(true);
    }
    for (const id of [...createdIds].reverse()) {
      const response = await request.delete(`${apiUrl}${path}/${id}`, { headers });
      expect(response.ok() || response.status() === 404, await response.text()).toBe(true);
    }
    const archived = await request.patch(`${apiUrl}/projects/${projectId}`, {
      headers,
      data: { status: 'ARCHIVED' },
    });
    expect(archived.ok(), await archived.text()).toBe(true);
  }
});
