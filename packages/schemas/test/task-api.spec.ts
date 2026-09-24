import { describe, expect, it } from 'vitest';
import { taskIdempotencyKeySchema } from '../src/api';

describe('task API schemas', () => {
  it('accepts a standard UUID idempotency key and rejects arbitrary text', () => {
    expect(taskIdempotencyKeySchema.safeParse('80da1063-8f78-47ea-9a10-08ddc8c0c172').success).toBe(
      true,
    );
    expect(taskIdempotencyKeySchema.safeParse('repeat-this-request').success).toBe(false);
  });
});
