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
  cleanup?: "succeeded" | "failed";
}

/** Sanitized SDK callback accounting; deliberately contains no measurement values. */
export interface PresageSdkDiagnosticEvent {
  schemaVersion: "1.0.0";
  emittedAt: string;
  type: "diagnostic";
  sessionId: string;
  kind: "sdk_metrics_callback" | "sdk_cleanup";
  callbackCount?: number;
  validationCode?: number | null;
  supportedMetricCount?: number;
  outcome?: "available" | "camera_or_measurement_unavailable" | "measurement_quality_insufficient" | "measurement_not_valid" | "consent_not_granted";
  operation?: "stopAsync" | "destroy";
  errorClass?: "Error" | "TypeError" | "RangeError" | "unknown";
}

export type PresageCompanionEvent = PresageMeasurementEvent | PresageStatusEvent | PresageSdkDiagnosticEvent;
export type PresageStartStatus = PresageCompanionStatus | "session_active_elsewhere";
export interface PresageCompanionClient {
  status(): Promise<Omit<PresageStatusEvent, "emittedAt">>;
  start(sessionId: string, ownerToken: string, options?: { signal?: AbortSignal }): Promise<{ accepted: boolean; status: PresageStartStatus; duplicate?: true }>;
  heartbeat(sessionId: string, ownerToken: string): Promise<{ renewed: boolean }>;
  stop(sessionId: string, ownerToken: string): Promise<Omit<PresageStatusEvent, "emittedAt">>;
  subscribe(sessionId: string, options: { onEvent(event: PresageCompanionEvent): void; onConnected?(httpStatus: number): void; signal?: AbortSignal }): Promise<void>;
}
export function consumeSseBlocks(buffer: string, onEvent: (event: unknown) => void): string;
export function createPresageCompanionClient(options: { baseUrl?: string; capabilityToken: string; fetchImpl?: typeof fetch }): PresageCompanionClient;
