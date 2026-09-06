export interface Device {
  serial: string;
  model: string;
  androidVersion: string;
  state: string;
  doupaoVersion?: string;
  evaluationApiVersion?: number;
  mock: boolean;
  reason?: string;
}

export interface MirrorDevice {
  serial: string;
  model: string;
  androidVersion: string;
  state: 'ONLINE' | 'OFFLINE' | 'UNAUTHORIZED' | 'UNKNOWN';
  canMirror: boolean;
  reason?: string;
}

export interface MirrorSession {
  schemaVersion: 1;
  sessionId: string;
  subscriptionId: string;
  deviceSerial: string;
  state: 'STARTING' | 'STREAMING' | 'STOPPED' | 'ERROR';
  transport: 'WEBRTC';
  createdAt: string;
  subscriberCount: number;
  error?: string;
}

export interface MirrorPeerConnection {
  schemaVersion: 1;
  peerConnectionId: string;
  answer: { type: 'answer'; sdp: string };
}

export interface EvaluationPlanSummary {
  schemaVersion: 1;
  planId: string;
  name: string;
  description?: string;
  datasetId: string;
  deviceSerial: string;
  sampleIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationPlan extends EvaluationPlanSummary {
  execution: { defaultTimeoutMs: number; continueOnFailure: boolean };
  judge: { enabled: boolean };
}

export interface RunAttempt {
  attemptId: string;
  attemptNumber: number;
  state: string;
  phase: string;
  summary?: string;
  durationMs?: number;
  tokens?: { total: number; cached?: number };
}

export interface RunSample {
  sampleId: string;
  instruction?: string;
  state: string;
  phase: string;
  summary?: string;
  durationMs?: number;
  tokens?: { total: number; cached?: number };
  latestAttemptId?: string;
  attempts?: RunAttempt[];
}

export interface EvaluationRun {
  runId: string;
  planId?: string;
  state: string;
  samples: RunSample[];
  createdAt?: string;
  datasetName?: string;
  deviceSerial?: string;
  planSnapshot?: { plan: EvaluationPlan; dataset: { schemaVersion: 1; id: string; name: string } };
}

export interface PlanRunReport {
  planId: string;
  runId: string;
  generatedAt: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    inconclusive: number;
    blocked: number;
    infraError: number;
    timedOut: number;
    cancelled: number;
    pending: number;
    passRate: number;
    durationMs: number;
    totalTokens: number | null;
    cachedTokens: number | null;
    totalSteps: number | null;
  };
}

export type ApiClient = <T>(url: string, init?: RequestInit) => Promise<T>;
