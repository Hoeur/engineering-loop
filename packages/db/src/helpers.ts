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
