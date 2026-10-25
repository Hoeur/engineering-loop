import { expect, test } from '@playwright/test';

// Browser contract coverage uses intercepted API responses and never invokes a provider.
test('creates, revises, reads history and previews project prompts without overflow', async ({
  page,
}, testInfo) => {
  const templates: { id: string; name: string; role: string; currentRevision: number }[] = [];
  const bodies = new Map<number, string>();
  let expectedRevision: number | undefined;
  await page.addInitScript(() => localStorage.setItem('engloop.auth.token', 'ui-contract-test'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    let data: unknown = { items: [], meta: { unread: 0 } };
    if (path === '/auth/me') data = { id: 'user', role: 'OWNER', name: 'Test owner' };
    else if (path === '/projects/project-one')
      data = {
        id: 'project-one',
        name: 'Prompt project',
        key: 'PR',
        permissionLevel: 'READ_ONLY',
        repositories: [],
        taskCountsByStatus: {},
        costBudgetUsd: '1',
        maxReviewCycles: 2,
      };
    else if (path.endsWith('/contract'))
      data = { objective: null, requirements: [], nonGoals: [], acceptanceCriteria: [] };
    else if (path.endsWith('/team'))
      data = {
        configured: false,
        editable: true,
        memberIds: [],
        agents: [],
        coverage: { requiredRoles: [], coveredRoles: [], missingRoles: [] },
        phases: [],
      };
    else if (path.endsWith('/board'))
      data = {
        items: [
          {
            id: 'task-one',
            key: 'PR-1',
            title: 'Build safe preview',
            status: 'BACKLOG',
            priority: 'MEDIUM',
            actualCost: '0',
            lastActivityAt: new Date().toISOString(),
          },
        ],
      };
    else if (path.endsWith('/prompts')) {
      if (request.method() === 'POST') {
        const input = request.postDataJSON() as { name: string; role: string; body: string };
        templates.push({
          id: 'template-one',
          name: input.name,
          role: input.role,
          currentRevision: 1,
        });
        bodies.set(1, input.body);
        data = templates[0];
      } else data = templates;
    } else if (path.endsWith('/revisions')) {
      const input = request.postDataJSON() as { expectedRevision: number; body: string };
      expectedRevision = input.expectedRevision;
      templates[0]!.currentRevision++;
      bodies.set(templates[0]!.currentRevision, input.body);
      data = { revision: templates[0]!.currentRevision };
    } else if (path.endsWith('/preview')) {
      const revision = Number(path.split('/').at(-2));
      data = {
        revision,
        role: 'PLANNER',
        taskId: 'task-one',
        body: bodies.get(revision)?.replace('{{task.title}}', 'Build safe preview'),
      };
    } else if (/\/revisions\/\d+$/.test(path)) {
      const revision = Number(path.split('/').at(-1));
      data = { revision, body: bodies.get(revision), template: templates[0] };
    }
    await route.fulfill({ json: { success: true, data, meta: {} } });
  });
  await page.goto('/projects/project-one');
  const prompts = page.getByRole('region', { name: 'Project prompts', exact: true });
  await expect(prompts.getByText('No project prompts yet.')).toBeVisible();
  await prompts.getByRole('button', { name: 'New prompt', exact: true }).click();
  await prompts.getByLabel('Prompt name', { exact: true }).fill('Planner prompt');
  await prompts.getByLabel('Prompt role', { exact: true }).selectOption('PLANNER');
  const original = `Plan {{task.title}} ${'long-task-context'.repeat(35)}`;
  await prompts.getByLabel('Prompt body', { exact: true }).fill(original);
  await prompts.getByRole('button', { name: 'Create prompt', exact: true }).click();
  await expect(
    prompts.getByText('Viewing saved revision 1. New revisions preserve this text.'),
  ).toBeVisible();
  await prompts.getByRole('button', { name: 'Edit as new revision' }).click();
  await prompts.getByLabel('Prompt body', { exact: true }).fill('Revised {{task.title}}');
  await prompts.getByRole('button', { name: 'Save new revision' }).click();
  await expect(
    prompts.getByText('Viewing saved revision 2. New revisions preserve this text.'),
  ).toBeVisible();
  expect(expectedRevision).toBe(1);
  await prompts.getByLabel('Preview task', { exact: true }).selectOption('task-one');
  await prompts.getByRole('button', { name: 'Preview saved revision' }).click();
  await expect(prompts.getByLabel('Rendered prompt')).toContainText('Revised Build safe preview');
  await prompts.getByLabel(/Revision \(latest/).fill('1');
  await prompts.getByRole('button', { name: 'View revision', exact: true }).click();
  await expect(prompts.getByText(original, { exact: true })).toBeVisible();
  await expect(prompts.getByRole('button', { name: 'Edit as new revision' })).toHaveCount(0);
  await prompts.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await prompts.screenshot({ path: testInfo.outputPath('project-prompts.png') });
});
