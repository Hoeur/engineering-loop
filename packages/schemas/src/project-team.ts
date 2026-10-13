import { z } from 'zod';
import { AgentRole } from '@engloop/types';
import { cuidLike } from './common';

export const replaceProjectTeamSchema = z
  .object({
    expectedVersion: z.number().int().min(0).max(2_147_483_646),
    memberIds: z
      .array(cuidLike)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Team members must be unique'),
    requiredRoles: z
      .array(z.nativeEnum(AgentRole))
      .max(Object.keys(AgentRole).length)
      .refine((roles) => new Set(roles).size === roles.length, 'Required roles must be unique'),
  })
  .strict();

export type ReplaceProjectTeamDto = z.infer<typeof replaceProjectTeamSchema>;
