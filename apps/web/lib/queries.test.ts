import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postCreateTask } from './queries';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('./api-client', () => ({
  api: {
    get: vi.fn(),
    post: mocks.post,
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('task mutations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the stable create key as the standard idempotency header, not in the body', async () => {
    const task = { id: 'task-1', projectId: 'project-1' };
    mocks.post.mockResolvedValue({ data: task, meta: {} });
    const body = { projectId: 'project-1', title: 'Create safely' };
    const idempotencyKey = '80da1063-8f78-47ea-9a10-08ddc8c0c172';

    await expect(postCreateTask({ body, idempotencyKey })).resolves.toBe(task);

    expect(mocks.post).toHaveBeenCalledWith('/tasks', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    expect(body).not.toHaveProperty('idempotencyKey');
  });
});
