import { CheckType, FindingStatus, ReviewKind } from '@engloop/types';
import { describe, expect, it, vi } from 'vitest';
import { AgentRunsController } from './agent-runs/agent-runs.controller';
import { ApprovalsController } from './approvals/approvals.controller';
import { ArtifactsController } from './artifacts/artifacts.controller';
import { ReviewsController } from './reviews/reviews.controller';
import { TasksController } from './tasks/tasks.controller';
import { TestsController } from './tests/tests.controller';
import { WorkflowsController } from './workflows/workflows.controller';

describe('tenant-aware direct controllers', () => {
  it('forwards the authenticated organization to test-run routes', () => {
    const list = vi.fn();
    const findOne = vi.fn();
    const controller = new TestsController({ list, findOne } as never);

    controller.list('org-1', '2', '10', 'project-1');
    controller.findOne('org-1', 'test-run-1');

    expect(list).toHaveBeenCalledWith('org-1', 2, 10, 'project-1');
    expect(findOne).toHaveBeenCalledWith('org-1', 'test-run-1');
  });

  it('forwards the authenticated organization to review routes', () => {
    const list = vi.fn();
    const findOne = vi.fn();
    const listFindings = vi.fn();
    const updateFinding = vi.fn();
    const controller = new ReviewsController({
      list,
      findOne,
      listFindings,
      updateFinding,
    } as never);

    controller.listRuns('org-1', '2', '10', 'project-1', 'APPROVED');
    controller.findOne('org-1', 'review-run-1');
    controller.listFindings('org-1', '2', '10', 'project-1', 'OPEN', 'HIGH');
    controller.updateFinding('org-1', 'finding-1', {
      status: FindingStatus.RESOLVED,
      resolutionNote: 'fixed',
    });

    expect(list).toHaveBeenCalledWith('org-1', 2, 10, {
      projectId: 'project-1',
      decision: 'APPROVED',
    });
    expect(findOne).toHaveBeenCalledWith('org-1', 'review-run-1');
    expect(listFindings).toHaveBeenCalledWith('org-1', 2, 10, {
      projectId: 'project-1',
      status: 'OPEN',
      severity: 'HIGH',
    });
    expect(updateFinding).toHaveBeenCalledWith(
      'org-1',
      'finding-1',
      FindingStatus.RESOLVED,
      'fixed',
    );
  });

  it('forwards the authenticated organization to agent-run routes', () => {
    const list = vi.fn();
    const findOne = vi.fn();
    const cancel = vi.fn();
    const controller = new AgentRunsController({ list, findOne, cancel } as never);
    const query = { page: 1, pageSize: 25, sortDir: 'desc' as const };

    controller.list('org-1', query);
    controller.findOne('org-1', 'agent-run-1');
    controller.cancel('org-1', 'agent-run-1', { reason: 'stop' });

    expect(list).toHaveBeenCalledWith('org-1', query);
    expect(findOne).toHaveBeenCalledWith('org-1', 'agent-run-1');
    expect(cancel).toHaveBeenCalledWith('org-1', 'agent-run-1', 'stop');
  });

  it('forwards the authenticated organization to workflow-run routes', () => {
    const listRuns = vi.fn();
    const findOne = vi.fn();
    const cancel = vi.fn();
    const controller = new WorkflowsController({
      definitions: vi.fn(),
      listRuns,
      findOne,
      cancel,
    } as never);
    const query = { page: 1, pageSize: 25, sortDir: 'desc' as const };

    controller.listRuns('org-1', query);
    controller.findOne('org-1', 'workflow-run-1');
    controller.cancel('org-1', 'workflow-run-1', { reason: 'stop' });

    expect(listRuns).toHaveBeenCalledWith('org-1', query);
    expect(findOne).toHaveBeenCalledWith('org-1', 'workflow-run-1');
    expect(cancel).toHaveBeenCalledWith('org-1', 'workflow-run-1', 'stop');
  });

  it('forwards the authenticated organization to artifact routes', () => {
    const list = vi.fn();
    const findOne = vi.fn();
    const screenshots = vi.fn();
    const controller = new ArtifactsController({ list, findOne, screenshots } as never);

    controller.list('org-1', 'task-1', 'agent-run-1', 'DIFF');
    controller.findOne('org-1', 'artifact-1');
    controller.screenshots('org-1', 'task-1');

    expect(list).toHaveBeenCalledWith('org-1', {
      taskId: 'task-1',
      agentRunId: 'agent-run-1',
      kind: 'DIFF',
    });
    expect(findOne).toHaveBeenCalledWith('org-1', 'artifact-1');
    expect(screenshots).toHaveBeenCalledWith('org-1', 'task-1');
  });

  it('forwards the authenticated organization to approval routes', () => {
    const list = vi.fn();
    const decide = vi.fn();
    const controller = new ApprovalsController({ list, decide, levels: vi.fn() } as never);

    controller.list('org-1', 'project-1', 'PENDING');
    controller.decide('org-1', 'approval-1', { decision: 'APPROVED', note: 'ship it' }, 'user-1');

    expect(list).toHaveBeenCalledWith('org-1', {
      projectId: 'project-1',
      status: 'PENDING',
    });
    expect(decide).toHaveBeenCalledWith('org-1', 'approval-1', 'APPROVED', 'ship it', 'user-1');
  });
});

describe('tenant-aware task routes', () => {
  it('keeps task reads scoped and passes organization ownership to nested run services', async () => {
    const taskList = vi.fn();
    const taskFindOne = vi.fn();
    const triggerTests = vi.fn();
    const triggerReview = vi.fn();
    const listAgentRuns = vi.fn();
    const listTestRuns = vi.fn();
    const listReviewRuns = vi.fn();
    const controller = new TasksController(
      { list: taskList, findOne: taskFindOne } as never,
      { trigger: triggerTests, listForTask: listTestRuns } as never,
      { trigger: triggerReview, listForTask: listReviewRuns } as never,
      { listForTask: listAgentRuns } as never,
    );
    const query = { page: 1, pageSize: 25, sortDir: 'desc' as const };

    controller.list('org-1', query);
    controller.findOne('org-1', 'task-1');
    await controller.runTests('org-1', 'task-1', { checks: [CheckType.LINT] });
    await controller.review('org-1', 'task-1', { kind: ReviewKind.CODE });
    await controller.runs('org-1', 'task-1');
    await controller.testRuns('org-1', 'task-1');
    await controller.reviewRuns('org-1', 'task-1');

    expect(taskList).toHaveBeenCalledWith('org-1', query);
    expect(taskFindOne).toHaveBeenCalledWith('org-1', 'task-1');
    expect(triggerTests).toHaveBeenCalledWith('org-1', 'task-1', [CheckType.LINT]);
    expect(triggerReview).toHaveBeenCalledWith('org-1', 'task-1', ReviewKind.CODE);
    expect(listAgentRuns).toHaveBeenCalledWith('org-1', 'task-1');
    expect(listTestRuns).toHaveBeenCalledWith('org-1', 'task-1');
    expect(listReviewRuns).toHaveBeenCalledWith('org-1', 'task-1');
  });
});
