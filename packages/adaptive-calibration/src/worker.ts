import { coordinateInterviewTurn } from './integration.js';
import type { IntegrationRequest, IntegrationResult, TelemetryPort } from './integration.js';

export type WorkerResponse =
  | { ok: true; result: IntegrationResult }
  | { ok: false; error: 'invalid_request' | 'calibration_error' };

/** A transport-neutral JSON boundary suitable for a one-shot Node worker. */
export async function handleWorkerRequest(value: unknown, telemetryPort?: TelemetryPort): Promise<WorkerResponse> {
  if (!value || typeof value !== 'object' || !('calibration' in value)) return { ok: false, error: 'invalid_request' };
  try {
    return { ok: true, result: await coordinateInterviewTurn(value as IntegrationRequest, telemetryPort) };
  } catch {
    return { ok: false, error: 'calibration_error' };
  }
}
