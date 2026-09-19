import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { retryOnUniqueViolation, UNIQUE_VIOLATION } from '../src/helpers';

const uniqueViolation = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: UNIQUE_VIOLATION,
    clientVersion: 'test',
    meta: { target: ['projectId', 'key'] },
  });

describe('retryOnUniqueViolation', () => {
  it('returns the result when the first attempt succeeds', async () => {
    const operation = vi.fn().mockResolvedValue('ENG-1');

    await expect(retryOnUniqueViolation(operation)).resolves.toBe('ENG-1');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries a key collision and returns the next attempt, as two concurrent creates would', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValue('ENG-2');

    await expect(retryOnUniqueViolation(operation)).resolves.toBe('ENG-2');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt limit and rethrows the collision', async () => {
    const operation = vi.fn().mockRejectedValue(uniqueViolation());

    await expect(retryOnUniqueViolation(operation)).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    });
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('honours a custom attempt count', async () => {
    const operation = vi.fn().mockRejectedValue(uniqueViolation());

    await expect(retryOnUniqueViolation(operation, 5)).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    });
    expect(operation).toHaveBeenCalledTimes(5);
  });

  it('never retries an unrelated failure', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('connection reset'));

    await expect(retryOnUniqueViolation(operation)).rejects.toThrow('connection reset');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('never retries a different Prisma error', async () => {
    const notFound = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: 'test',
    });
    const operation = vi.fn().mockRejectedValue(notFound);

    await expect(retryOnUniqueViolation(operation)).rejects.toMatchObject({ code: 'P2025' });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
