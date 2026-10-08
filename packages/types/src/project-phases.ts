import type { AgentRole, TaskStatus, ProjectPhaseStatus } from './enums';

export interface ProjectContract {
  objective: string | null;
  requirements: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
}

/** Planning lifecycle; activation does not start execution. */
export interface ProjectPhaseSummary {
  id: string;
  projectId: string;
  status: ProjectPhaseStatus;
  name: string;
  description: string | null;
  objective: string | null;
  deliverables: string[];
  acceptanceCriteria: string[];
  requiredRoles: AgentRole[];
  dependencyIds: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
  _count: { tasks: number };
}

export interface ProjectPhaseDetail extends ProjectPhaseSummary {
  tasks: { id: string; key: string; title: string; status: TaskStatus; phaseId: string | null }[];
}
