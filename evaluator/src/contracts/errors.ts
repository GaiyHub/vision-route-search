import { z } from 'zod';

export const apiErrorV1Schema = z.object({
  schemaVersion: z.literal(1),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    path: z.string().optional(),
    retryable: z.boolean(),
  }).strict(),
}).strict();

export type ApiErrorV1 = z.infer<typeof apiErrorV1Schema>;

export class InfrastructureError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'InfrastructureError';
  }
}
