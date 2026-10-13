import type { AgentRole } from './enums';

export interface ProjectTeamAgent {
  id: string;
  name: string;
  role: AgentRole;
  eligible: boolean;
  unavailableReason: string | null;
  configuration: { id: string; version: number } | null;
}

export interface RoleCoverage {
  requiredRoles: AgentRole[];
  coveredRoles: AgentRole[];
  missingRoles: AgentRole[];
}

export interface ProjectTeam {
  configured: boolean;
  version: number;
  memberIds: string[];
  agents: ProjectTeamAgent[];
  coverage: RoleCoverage;
  phases: (RoleCoverage & { id: string; name: string })[];
  editable: boolean;
}
