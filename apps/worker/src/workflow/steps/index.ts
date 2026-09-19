import { WorkflowStepKey } from '@engloop/types';
import { analyzeRepositoryStep, createTasksStep, planStep } from './analyze-and-plan';
import { createWorktreeStep, fixStep, implementStep } from './implement';
import { finalReviewStep, retestStep, reviewStep, runTestsStep } from './verify';
import { completeStep, preparePullRequestStep } from './finalize';
import type { StepHandlerMap } from './types';

/** One handler per workflow step key. Adding a step is adding an entry here. */
export const STEP_HANDLERS: StepHandlerMap = {
  [WorkflowStepKey.ANALYZE_REPOSITORY]: analyzeRepositoryStep,
  [WorkflowStepKey.PLAN]: planStep,
  [WorkflowStepKey.CREATE_TASKS]: createTasksStep,
  [WorkflowStepKey.CREATE_WORKTREE]: createWorktreeStep,
  [WorkflowStepKey.IMPLEMENT]: implementStep,
  [WorkflowStepKey.RUN_TESTS]: runTestsStep,
  [WorkflowStepKey.REVIEW]: reviewStep,
  [WorkflowStepKey.FIX]: fixStep,
  [WorkflowStepKey.RETEST]: retestStep,
  [WorkflowStepKey.FINAL_REVIEW]: finalReviewStep,
  [WorkflowStepKey.PREPARE_PR]: preparePullRequestStep,
  [WorkflowStepKey.COMPLETE]: completeStep,
};

export * from './types';
