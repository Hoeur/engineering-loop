import { Prisma } from '@prisma/client';

/** Postgres unique-violation code — used to turn races into 409 CONFLICT. */
export const UNIQUE_VIOLATION = 'P2002';
export const RECORD_NOT_FOUND = 'P2025';
export const FOREIGN_KEY_VIOLATION = 'P2003';

export const isPrismaError = (
  error: unknown,
  code?: string,
): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  (code === undefined || error.code === code);

export const toDecimal = (value: number | string): Prisma.Decimal => new Prisma.Decimal(value);

export const decimalToNumber = (value: Prisma.Decimal | number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value.toString());
};

/** Truncates a timestamp to UTC midnight for the `occurredOn` grouping column. */
export const toDateOnly = (value: Date = new Date()): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

export const jsonOrNull = (value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  value === undefined || value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

/**
 * Retries a write that races another one for the same unique key.
 *
 * Allocating a project-scoped task key reads `taskSequence` and writes a row
 * built from it. Under Postgres' default READ COMMITTED that pair is not
 * serialisable: two concurrent transactions can read the same sequence and then
 * collide on `(projectId, key)`. Wrapping the whole transaction and retrying
 * re-reads the (already incremented) sequence, so the second attempt succeeds.
 *
 * Retries only on P2002 — every other failure propagates untouched.
 */
export const retryOnUniqueViolation = async <T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isPrismaError(error, UNIQUE_VIOLATION)) throw error;
    }
  }
};
