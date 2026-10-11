import { FastApiBoundaryError, toIntegrationRequest } from './fastapi-boundary.js';
import { handleWorkerRequest, type WorkerResponse } from './worker.js';

export type CalibrationCliResponse = WorkerResponse | { ok: false; error: 'malformed_json' | 'unsupported_schema_version' };

export interface CalibrationCliRun {
  response: CalibrationCliResponse;
  exitCode: 0 | 2 | 3;
  diagnostic: 'completed' | 'malformed_json' | 'invalid_request' | 'unsupported_schema_version' | 'calibration_error';
}

type WorkerHandler = (value: unknown) => Promise<WorkerResponse>;

/** Pure CLI orchestration; it never logs the raw input or any exception text. */
export async function runCalibrationCli(input: string, worker: WorkerHandler = handleWorkerRequest): Promise<CalibrationCliRun> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return { response: { ok: false, error: 'malformed_json' }, exitCode: 2, diagnostic: 'malformed_json' };
  }
  try {
    const response = await worker(toIntegrationRequest(parsed));
    if (!response.ok) {
      return { response, exitCode: response.error === 'calibration_error' ? 3 : 2, diagnostic: response.error };
    }
    return { response, exitCode: 0, diagnostic: 'completed' };
  } catch (error) {
    if (error instanceof FastApiBoundaryError) {
      if (error.code === 'unsupported_schema_version') {
        return { response: { ok: false, error: 'unsupported_schema_version' }, exitCode: 2, diagnostic: error.code };
      }
      return { response: { ok: false, error: 'invalid_request' }, exitCode: 2, diagnostic: error.code };
    }
    return { response: { ok: false, error: 'calibration_error' }, exitCode: 3, diagnostic: 'calibration_error' };
  }
}
