import { z } from 'zod';

export const mirrorSessionIdSchema = z.string().regex(/^mirror-[0-9a-f-]{36}$/i);
export const mirrorSubscriptionIdSchema = z.string().regex(/^subscription-[0-9a-f-]{36}$/i);
export const mirrorPeerConnectionIdSchema = z.string().regex(/^peer-[0-9a-f-]{36}$/i);

export const createMirrorSessionRequestSchema = z.object({
  schemaVersion: z.literal(1),
  deviceSerial: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  clientId: z.string().regex(/^mirror-client-[0-9a-f-]{36}$/i).optional(),
}).strict();

export const mirrorSessionSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: mirrorSessionIdSchema,
  subscriptionId: mirrorSubscriptionIdSchema,
  deviceSerial: z.string(),
  state: z.enum(['STARTING', 'STREAMING', 'STOPPED', 'ERROR']),
  transport: z.literal('WEBRTC'),
  createdAt: z.string().datetime(),
  subscriberCount: z.number().int().nonnegative(),
  error: z.string().optional(),
}).strict();

export const createMirrorPeerConnectionRequestSchema = z.object({
  schemaVersion: z.literal(1),
  subscriptionId: mirrorSubscriptionIdSchema,
  offer: z.object({
    type: z.literal('offer'),
    sdp: z.string().min(1).max(256 * 1024),
  }).strict(),
}).strict();

export const mirrorPeerConnectionSchema = z.object({
  schemaVersion: z.literal(1),
  peerConnectionId: mirrorPeerConnectionIdSchema,
  answer: z.object({
    type: z.literal('answer'),
    sdp: z.string().min(1),
  }).strict(),
}).strict();

export type CreateMirrorSessionRequest = z.infer<typeof createMirrorSessionRequestSchema>;
export type MirrorSession = z.infer<typeof mirrorSessionSchema>;
export type CreateMirrorPeerConnectionRequest = z.infer<typeof createMirrorPeerConnectionRequestSchema>;
export type MirrorPeerConnection = z.infer<typeof mirrorPeerConnectionSchema>;
