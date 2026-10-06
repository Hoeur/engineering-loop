import { z } from 'zod';
import { cuidLike } from './common';
import { AgentRole } from '@engloop/types';

const planningText = z.string().trim().min(1).max(2_000);
const planningList = z
  .array(planningText)
  .max(100)
  .refine((entries) => new Set(entries).size === entries.length, 'Planning entries must be unique');
const objective = z.string().trim().min(1).max(10_000).nullable();
export const replaceProjectContractSchema = z
  .object({
    objective,
    requirements: planningList,
    nonGoals: planningList,
    acceptanceCriteria: planningList,
  })
  .strict();
export type ReplaceProjectContractDto = z.infer<typeof replaceProjectContractSchema>;

export const createProjectPhaseSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().max(10_000).nullable().optional(),
    objective: objective.optional(),
    deliverables: planningList.optional(),
    acceptanceCriteria: planningList.optional(),
    requiredRoles: z
      .array(z.nativeEnum(AgentRole))
      .max(Object.keys(AgentRole).length)
      .refine((roles) => new Set(roles).size === roles.length, 'Required roles must be unique')
      .optional(),
    dependencyIds: z
      .array(cuidLike)
      .max(499)
      .refine((ids) => new Set(ids).size === ids.length, 'Dependency IDs must be unique')
      .optional(),
  })
  .strict();
export const updateProjectPhaseSchema = createProjectPhaseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one phase field is required');
export const orderProjectPhasesSchema = z
  .object({
    phaseIds: z
      .array(cuidLike)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, 'Phase IDs must be unique'),
  })
  .strict();
export type CreateProjectPhaseDto = z.infer<typeof createProjectPhaseSchema>;
export type UpdateProjectPhaseDto = z.infer<typeof updateProjectPhaseSchema>;
export type OrderProjectPhasesDto = z.infer<typeof orderProjectPhasesSchema>;
