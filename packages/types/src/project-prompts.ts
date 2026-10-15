import type { AgentRole } from './enums';

export interface ProjectPromptTemplate {
  id: string;
  name: string;
  role: AgentRole;
  currentRevision: number;
  createdAt: string;
}

export interface ProjectPromptRevision {
  id: string;
  templateId: string;
  revision: number;
  body: string;
  createdAt: string;
  template: Pick<ProjectPromptTemplate, 'id' | 'name' | 'role'>;
}

export interface ProjectPromptPreview {
  templateId: string;
  revision: number;
  taskId: string;
  role: AgentRole;
  body: string;
  supportedVariables: string[];
}
