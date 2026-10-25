import { expect, test } from './fixtures';

// Opt in with a task-owned project containing a DOCUMENTATION template and revisions 1/2.
// Validation is read-only: these tests use the real API and do not create or run work.
const projectId = process.env.E2E_OUTPUT_PROJECT_ID;
test.skip(!projectId, 'Set E2E_OUTPUT_PROJECT_ID to an isolated output-validation fixture');

test('validates saved output through the real API without overflow', async ({ page }, testInfo) => {
  let validations = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/validate-output')) validations++;
  });
  await page.goto(`/projects/${projectId}`);
  const prompts = page.getByRole('region', { name: 'Project prompts', exact: true });
  await prompts.getByRole('button', { name: /Output validation example.*revision 2/ }).click();
  const panel = page.getByRole('region', { name: 'Output contract validation', exact: true });
  const input = panel.getByLabel('Output JSON', { exact: true });
  const submit = panel.getByRole('button', { name: 'Validate output', exact: true });
  await input.fill('{');
  await submit.click();
  await expect(panel.getByRole('alert')).toContainText('Invalid JSON');
  expect(validations).toBe(0);
  await input.fill('{}');
  const invalid = page.waitForResponse((response) =>
    response.url().endsWith('/revisions/2/validate-output'),
  );
  await submit.click();
  expect((await invalid).status()).toBe(422);
  await expect(panel.getByRole('alert')).toContainText('summary: Required');
  await expect(input).toHaveValue('{}');
  const output = JSON.stringify({ summary: 'example-output'.repeat(60), documents: [] });
  await input.fill(output);
  const success = page.waitForResponse((response) =>
    response.url().endsWith('/revisions/2/validate-output'),
  );
  await submit.click();
  expect((await success).status()).toBe(201);
  await expect(panel.getByRole('status')).toContainText(
    'DOCUMENTATION contract for saved revision 2',
  );
  await input.fill('{"summary":"Edited"}');
  await expect(panel.getByRole('status')).toHaveCount(0);
  await prompts.getByLabel(/Revision \(latest/).fill('1');
  await prompts.getByRole('button', { name: 'View revision', exact: true }).click();
  await expect(
    prompts.getByText('Viewing saved revision 1. New revisions preserve this text.'),
  ).toBeVisible();
  await expect(input).toHaveValue('');
  await input.fill(output);
  const historical = page.waitForResponse((response) =>
    response.url().endsWith('/revisions/1/validate-output'),
  );
  await submit.click();
  expect((await historical).status()).toBe(201);
  await expect(panel.getByRole('status')).toContainText('saved revision 1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: testInfo.outputPath('output-validation.png') });
});
