import type { z } from 'zod';
import type { updateRepositorySchema } from '@engloop/schemas';

export type UpdateRepositoryDto = z.infer<typeof updateRepositorySchema>;
