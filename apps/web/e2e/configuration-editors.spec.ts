import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures';

const apiUrl = process.env.E2E_API_URL;
test.skip(
  process.env.E2E_EDITORS_ACCEPTANCE !== '1',
  'Use the explicit scratch editor acceptance configuration',
);

interface Entity {
  id: string;
  updatedAt: string;
  title?: string;
  name?: string;
  organizationId?: string;
}
async function data(response: Awaited<ReturnType<APIRequestContext['post']>>): Promise<Entity> {
  const body = (await response.json()) as { data: Entity; error?: { message: string } };
  expect(response.ok(), JSON.stringify(body.error)).toBeTruthy();
  return body.data;
}

test('edits task requirements, retains conflicting drafts and locks queued work', async ({
  page,
  request,
  authToken,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = { Authorization: `Bearer ${authToken}` };
  const me = await data(await request.get(`${apiUrl}/auth/me`, { headers }));
  const project = await data(
    await request.post(`${apiUrl}/projects`, {
      headers,
      data: {
        organizationId: me.organizationId,
        name: `Editor tasks ${randomUUID()}`,
        key: `E${randomUUID().replaceAll('-', '').slice(0, 7).toUpperCase()}`,
        slug: `editor-${randomUUID()}`,
      },
    }),
  );
  const task = await data(
    await request.post(`${apiUrl}/tasks`, {
      headers,
      data: {
        projectId: project.id,
        title: 'Editable requirement',
        acceptanceCriteria: ['First criterion'],
      },
    }),
  );
  await page.goto(`/engineering/tasks/${task.id}`);
  await page.getByRole('button', { name: 'Edit task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit task', exact: true });
  await dialog.getByLabel('Title', { exact: true }).fill('Changed planning task');
  await dialog.getByLabel('Description', { exact: true }).fill('Text <script> is rendered as text');
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/tasks/${task.id}`) && response.request().method() === 'PATCH',
  );
  await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Changed planning task', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Edit task', exact: true }).click();
  await dialog.getByLabel('Objective', { exact: true }).fill('Retained task draft');
  const current = await data(await request.get(`${apiUrl}/tasks/${task.id}`, { headers }));
  await data(
    await request.patch(`${apiUrl}/tasks/${task.id}`, {
      headers,
      data: { title: 'Concurrent writer', expectedUpdatedAt: current.updatedAt },
    }),
  );
  const conflict = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/tasks/${task.id}`) && response.request().method() === 'PATCH',
  );
  await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
  expect((await conflict).status()).toBe(409);
  await expect(dialog.getByRole('alert')).toContainText('Task changed');
  await expect(dialog.getByLabel('Objective', { exact: true })).toHaveValue('Retained task draft');
  await dialog.getByRole('button', { name: 'Reload saved task', exact: true }).click();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Concurrent writer');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await dialog.screenshot({ path: testInfo.outputPath('task-editor.png') });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await data(
    await request.post(`${apiUrl}/tasks/${task.id}/transition`, {
      headers,
      data: { to: 'QUEUED' },
    }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Edit task', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Save task', exact: true })).toBeDisabled();
  const queued = await data(await request.get(`${apiUrl}/tasks/${task.id}`, { headers }));
  expect(
    (
      await request.patch(`${apiUrl}/tasks/${task.id}`, {
        headers,
        data: { title: 'Blocked edit', expectedUpdatedAt: queued.updatedAt },
      })
    ).status(),
  ).toBe(409);
  await request.post(`${apiUrl}/tasks/${task.id}/cancel`, {
    headers,
    data: { reason: 'Acceptance fixture complete' },
  });
  expect(errors).toEqual([]);
});

test('creates and edits agent settings with retained conflict drafts', async ({
  page,
  request,
  authToken,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = { Authorization: `Bearer ${authToken}` };
  const name = `Editor agent ${randomUUID().slice(0, 8)}`;
  await page.goto('/agents/configurations');
  await page.getByRole('button', { name: 'New agent', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'New agent', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Provider', { exact: true }).selectOption('mock');
  await dialog.getByLabel('Role', { exact: true }).selectOption('PLANNER');
  await dialog.getByLabel('Model', { exact: true }).fill('controlled-model');
  await dialog.getByLabel('System prompt', { exact: true }).fill('Task-scoped instructions');
  const created = page.waitForResponse(
    (response) => response.url().endsWith('/agents') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Create agent', exact: true }).click();
  const agent = await data(await created);
  const nameLabel = page.getByText(name).and(page.locator(':visible'));
  await expect(nameLabel).toBeVisible();
  const container = nameLabel.locator(
    'xpath=ancestor::*[.//button[normalize-space()="Edit agent"]][1]',
  );
  await container.getByRole('button', { name: 'Edit agent', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Edit agent', exact: true });
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(name);
  await dialog.getByLabel('System prompt', { exact: true }).fill('Retained agent draft');
  const current = await data(await request.get(`${apiUrl}/agents/${agent.id}`, { headers }));
  await data(
    await request.patch(`${apiUrl}/agents/${agent.id}`, {
      headers,
      data: { name: `${name} changed`, expectedUpdatedAt: current.updatedAt },
    }),
  );
  const conflict = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/agents/${agent.id}`) && response.request().method() === 'PATCH',
  );
  await dialog.getByRole('button', { name: 'Save agent', exact: true }).click();
  expect((await conflict).status()).toBe(409);
  await expect(dialog.getByRole('alert')).toContainText('Agent changed');
  await expect(dialog.getByLabel('System prompt', { exact: true })).toHaveValue(
    'Retained agent draft',
  );
  await dialog.getByRole('button', { name: 'Reload saved agent', exact: true }).click();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(`${name} changed`);
  await dialog.getByLabel('Cost limit (USD)', { exact: true }).fill('2.5');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await dialog.screenshot({ path: testInfo.outputPath('agent-editor-dialog.png') });
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/agents/${agent.id}`) && response.request().method() === 'PATCH',
  );
  await dialog.getByRole('button', { name: 'Save agent', exact: true }).click();
  expect((await saved).status()).toBe(200);
  const final = await data(await request.get(`${apiUrl}/agents/${agent.id}`, { headers }));
  expect(final.name).toBe(`${name} changed`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('agent-editor.png') });
  await request.patch(`${apiUrl}/agents/${agent.id}`, { headers, data: { enabled: false } });
  expect(errors).toEqual([]);
});
