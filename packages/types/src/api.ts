/** Canonical API envelope (spec section 48). Every REST response uses this shape. */
export interface ApiMeta {
  requestId?: string;
  timestamp?: string;
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface ApiSuccess<TData> {
  success: true;
  data: TData;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  code: ApiErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  meta: ApiMeta;
}

export type ApiResponse<TData> = ApiSuccess<TData> | ApiFailure;

export const ApiErrorCode = Object.freeze({
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',

  TASK_INVALID_TRANSITION: 'TASK_INVALID_TRANSITION',
  TASK_DEPENDENCY_CYCLE: 'TASK_DEPENDENCY_CYCLE',
  TASK_MAX_ATTEMPTS_REACHED: 'TASK_MAX_ATTEMPTS_REACHED',
  TASK_ALREADY_RUNNING: 'TASK_ALREADY_RUNNING',
  TASK_IDEMPOTENCY_CONFLICT: 'TASK_IDEMPOTENCY_CONFLICT',

  WORKFLOW_STEP_FAILED: 'WORKFLOW_STEP_FAILED',
  WORKFLOW_NOT_RESUMABLE: 'WORKFLOW_NOT_RESUMABLE',

  AGENT_PROVIDER_UNAVAILABLE: 'AGENT_PROVIDER_UNAVAILABLE',
  AGENT_OUTPUT_INVALID: 'AGENT_OUTPUT_INVALID',
  AGENT_BUDGET_EXCEEDED: 'AGENT_BUDGET_EXCEEDED',
  AGENT_TIMEOUT: 'AGENT_TIMEOUT',

  PERMISSION_LEVEL_TOO_LOW: 'PERMISSION_LEVEL_TOO_LOW',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',

  COMMAND_NOT_ALLOWED: 'COMMAND_NOT_ALLOWED',
  COMMAND_TIMEOUT: 'COMMAND_TIMEOUT',

  GIT_OPERATION_FAILED: 'GIT_OPERATION_FAILED',
  WORKTREE_CONFLICT: 'WORKTREE_CONFLICT',
  REPOSITORY_NOT_READY: 'REPOSITORY_NOT_READY',
});
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export const buildPaginationMeta = (
  page: number,
  pageSize: number,
  total: number,
): PaginationMeta => {
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
};
