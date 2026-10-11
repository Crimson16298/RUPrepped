export type PresageMetric = "breathingRate" | "pulseRate" | "hrvRmssd";

interface PresageMetricSampleBase {
  value: number;
  confidence: number;
  stable: true;
  measuredAt: string;
}
export type PresageMetricSample =
  | (PresageMetricSampleBase & { metric: "pulseRate"; unit: "bpm" })
  | (PresageMetricSampleBase & { metric: "breathingRate"; unit: "breaths/min" })
  | (PresageMetricSampleBase & { metric: "hrvRmssd"; unit?: never });

export interface PresageMeasurementEvent {
  schemaVersion: "1.0.0";
  emittedAt: string;
  type: "measurement";
  sessionId: string;
  observedAt: string;
  metrics: PresageMetricSample[];
  quality: { validationCode: 0; confidence: number; stable: true };
}

export type PresageCompanionStatus = "awaiting_consent" | "starting" | "warming_up" | "measuring" | "quality_insufficient" | "unavailable" | "stopped" | "error";

export interface PresageStatusEvent {
  schemaVersion: "1.0.0";
  emittedAt: string;
  type: "status";
  sessionId?: string;
  status: PresageCompanionStatus;
  reason?: string;
  validationCode?: number;
  code?: number;
  classification?: string;
  retryable?: boolean;
}

export type PresageCompanionEvent = PresageMeasurementEvent | PresageStatusEvent;
export type PresageStartStatus = PresageCompanionStatus | "session_active_elsewhere";
export interface PresageCompanionClient {
  status(): Promise<Omit<PresageStatusEvent, "emittedAt">>;
  start(sessionId: string): Promise<{ accepted: boolean; status: PresageStartStatus; duplicate?: true }>;
  stop(sessionId: string): Promise<Omit<PresageStatusEvent, "emittedAt">>;
  subscribe(sessionId: string, options: { onEvent(event: PresageCompanionEvent): void; signal?: AbortSignal }): Promise<void>;
}
export function consumeSseBlocks(buffer: string, onEvent: (event: unknown) => void): string;
export function createPresageCompanionClient(options: { baseUrl?: string; capabilityToken: string; fetchImpl?: typeof fetch }): PresageCompanionClient;
