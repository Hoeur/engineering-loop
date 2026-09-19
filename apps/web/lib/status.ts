import type {
  AgentRunStatus,
  CheckStatus,
  Priority,
  RiskLevel,
  RunStatus,
  Severity,
  TaskStatus,
} from '@engloop/types';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' | 'outline';

/**
 * One place that maps a domain status to a colour. Every badge in the product
 * reads from here, so "REVIEWING" is the same colour on every screen.
 */
export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = {
  BACKLOG: 'neutral',
  PLANNING: 'info',
  PLAN_READY: 'info',
  QUEUED: 'info',
  IMPLEMENTING: 'accent',
  IMPLEMENTATION_READY: 'accent',
  TESTING: 'warning',
  TEST_FAILED: 'danger',
  REVIEWING: 'warning',
  CHANGES_REQUESTED: 'danger',
  FIXING: 'accent',
  APPROVED: 'success',
  PR_READY: 'success',
  PR_CREATED: 'success',
  MERGED: 'success',
  COMPLETED: 'success',
  BLOCKED: 'danger',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  NEEDS_HUMAN_REVIEW: 'warning',
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'neutral',
};

export const RISK_TONE: Record<RiskLevel, Tone> = {
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'neutral',
};

export const SEVERITY_TONE: Record<Severity, Tone> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'info',
  INFO: 'neutral',
};

export const RUN_STATUS_TONE: Record<RunStatus, Tone> = {
  PENDING: 'neutral',
  RUNNING: 'info',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  SKIPPED: 'neutral',
  WAITING_FOR_HUMAN: 'warning',
};

export const AGENT_RUN_TONE: Record<AgentRunStatus, Tone> = {
  PENDING: 'neutral',
  RUNNING: 'info',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  TIMED_OUT: 'danger',
  BUDGET_EXCEEDED: 'danger',
};

export const CHECK_STATUS_TONE: Record<CheckStatus, Tone> = {
  QUEUED: 'neutral',
  RUNNING: 'info',
  PASSED: 'success',
  FAILED: 'danger',
  SKIPPED: 'neutral',
  TIMEOUT: 'danger',
};

export const FINDING_STATUS_TONE: Record<string, Tone> = {
  OPEN: 'danger',
  FIXING: 'warning',
  RESOLVED: 'success',
  WONT_FIX: 'neutral',
  ACCEPTED_RISK: 'warning',
};

export const PROVIDER_TONE: Record<string, Tone> = {
  MOCK: 'neutral',
  CODEX: 'accent',
  CLAUDE_CODE: 'info',
  GEMINI: 'info',
  OPENAI_API: 'accent',
  ANTHROPIC_API: 'info',
  LOCAL_LLM: 'neutral',
  CUSTOM_CLI: 'neutral',
};
