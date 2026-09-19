import { buildPaginationMeta, type PaginationMeta } from '@engloop/types';

export interface Paginated<T> {
  items: T[];
  meta: { pagination: PaginationMeta };
}

export const paginate = <T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): Paginated<T> => ({
  items,
  meta: { pagination: buildPaginationMeta(page, pageSize, total) },
});

export const skipTake = (page: number, pageSize: number): { skip: number; take: number } => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

/** Builds a Prisma `orderBy` from validated query params with an allowlist. */
export const orderBy = <TField extends string>(
  sortBy: string | undefined,
  sortDir: 'asc' | 'desc',
  allowed: readonly TField[],
  fallback: TField,
): Record<string, 'asc' | 'desc'> => {
  const field = allowed.includes(sortBy as TField) ? (sortBy as TField) : fallback;
  return { [field]: sortDir };
};
