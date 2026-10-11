import { TelemetryStore } from './adapter.js';
import type { DecisionInput, EventInput } from './types.js';

/** Structural match for adaptive-calibration's dependency-injected port. */
export interface CalibrationTelemetryPort {
  insertEvent(input: EventInput): Promise<boolean>;
  insertDecision(input: DecisionInput): Promise<boolean>;
}

/**
 * Concrete bridge from calibration orchestration to the existing parameterized
 * TelemetryStore. It adds no schema or retry behavior of its own.
 */
export function calibrationTelemetryPortFromStore(store: TelemetryStore): CalibrationTelemetryPort {
  return {
    insertEvent: (input) => store.insertEvent(input),
    insertDecision: (input) => store.insertDecision(input),
  };
}
