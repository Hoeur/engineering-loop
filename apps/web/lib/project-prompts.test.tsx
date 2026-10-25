import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promptService, promptsKey } from './project-prompts';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('./api-client', () => ({ api: mocks }));
beforeEach(() => {
  mocks.get.mockResolvedValue({ data: [] });
  mocks.post.mockResolvedValue({ data: {} });
});
describe('Prompt API routes', () => {
  it('encodes project and template IDs and pins the preview revision', async () => {
    await promptService.list('project/one');
    await promptService.read('project/one', 'template/one', 4);
    await promptService.revise('project/one', 'template/one', {
      expectedRevision: 4,
      body: 'Revised',
    });
    await promptService.preview('project/one', 'template/one', 2, 'task-one');
    expect(mocks.get).toHaveBeenCalledWith('/projects/project%2Fone/prompts');
    expect(mocks.get).toHaveBeenCalledWith(
      '/projects/project%2Fone/prompts/template%2Fone/revisions/4',
    );
    expect(mocks.post).toHaveBeenCalledWith(
      '/projects/project%2Fone/prompts/template%2Fone/revisions',
      { expectedRevision: 4, body: 'Revised' },
    );
    expect(mocks.post).toHaveBeenCalledWith(
      '/projects/project%2Fone/prompts/template%2Fone/revisions/2/preview',
      { taskId: 'task-one' },
    );
    expect(promptsKey('one')).not.toEqual(promptsKey('two'));
  });
});
