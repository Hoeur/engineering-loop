import { expect, test } from '@playwright/test';
import type { ExecutionPreviewRequest } from '@engloop/schemas';

test('selects historical prompts for plan and run with a responsive settings preview', async ({
  page,
}, testInfo) => {
  const starts: { path: string; body: unknown }[] = [];
  const now = new Date().toISOString();
  await page.addInitScript(() => localStorage.setItem('engloop.auth.token', 'ui-contract-test'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    let data: unknown = { items: [], meta: { unread: 0 } };
    if (path === '/auth/me') data = { id: 'user-one', role: 'OWNER', name: 'Test owner' };
    else if (path === '/tasks/task-one')
      data = {
        id: 'task-one',
        projectId: 'project-one',
        key: 'PR-1',
        title: 'Execution preview task',
        objective: 'Preview exact revisions',
        description: 'Safe task description',
        type: 'FEATURE',
        priority: 'MEDIUM',
        riskLevel: 'MEDIUM',
        status: 'BACKLOG',
        allowedTransitions: ['PLANNING', 'QUEUED'],
        acceptanceCriteria: ['Shows preview'],
        implementationNotes: [],
        requiredChecks: [],
        actualCost: 0,
        attemptCount: 0,
        maxAttempts: 3,
        reviewCycle: 0,
        createdAt: now,
        lastActivityAt: now,
        workflowRuns: [],
        testRuns: [],
        reviewRuns: [],
        artifacts: [],
        agentRuns: [],
        commits: [],
        comments: [],
        dependencies: [],
        dependents: [],
        pullRequests: [],
      };
    else if (path.endsWith('/prompts'))
      data = ['IMPLEMENTER', 'PLANNER'].map((role) => ({
        id: `template-${role}`,
        name: `${role} ${'long-prompt-name'.repeat(20)}`,
        role,
        currentRevision: 2,
      }));
    else if (path.endsWith('/execution-preview')) {
      const input = request.postDataJSON() as ExecutionPreviewRequest;
      const role = input.mode === 'plan' ? 'PLANNER' : 'IMPLEMENTER';
      const prompt = input.execution.prompts[0];
      data = {
        taskId: 'task-one',
        capturedAt: now,
        roles: [
          {
            role,
            agentId: 'agent-one',
            providerKey: 'mock',
            providerKind: 'MOCK',
            model: 'long-model-name'.repeat(20),
            permissionLevel: 'LEVEL_2_CODE',
            budget: {
              timeoutMs: 1000,
              maxTokens: 1000,
              maxCostUsd: 1,
              allowedCommands: ['git', 'pnpm'],
            },
            ...(prompt
              ? {
                  prompt: {
                    templateId: prompt.templateId,
                    revision: prompt.revision,
                    body: 'Saved',
                    rendered: `Saved revision ${prompt.revision} ${'long-context'.repeat(40)}`,
                  },
                }
              : {}),
          },
        ],
      };
    } else if (/\/tasks\/task-one\/(plan|run)$/.test(path)) {
      starts.push({ path, body: request.postDataJSON() });
      data = { id: 'run-one' };
    }
    await route.fulfill({ json: { success: true, data, meta: {} } });
  });
  await page.goto('/engineering/tasks/task-one');
  for (const mode of ['plan', 'run'] as const) {
    const role = mode === 'plan' ? 'PLANNER' : 'IMPLEMENTER';
    await page
      .getByRole('button', { name: mode === 'plan' ? 'Plan' : 'Start', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Use frozen execution settings').check();
    await dialog.getByLabel(`${role} prompt`, { exact: true }).selectOption(`template-${role}`);
    await dialog.getByLabel(`${role} revision`, { exact: true }).fill('1');
    await expect(dialog.getByLabel('Execution settings preview')).toContainText('Saved revision 1');
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await dialog.screenshot({ path: testInfo.outputPath(`execution-${mode}.png`) });
    await dialog
      .getByRole('button', { name: mode === 'plan' ? 'Run planner' : 'Start run', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect(starts.at(-1)).toEqual({
      path: `/tasks/task-one/${mode}`,
      body: {
        ...(mode === 'run' ? { skipPlanning: true } : {}),
        execution: { prompts: [{ role, templateId: `template-${role}`, revision: 1 }] },
      },
    });
  }
});
