import { z } from 'zod';
import { cuidLike } from './common';

export const replaceProjectTeamSchema = z
  .object({
    expectedVersion: z.number().int().min(0).max(2_147_483_646),
    agentIds: z
      .array(cuidLike)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Agent IDs must be unique'),
  })
  .strict();
export type ReplaceProjectTeamDto = z.infer<typeof replaceProjectTeamSchema>;
