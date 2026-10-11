export interface PresageValidationDescription {
  name: string;
  message: string;
  action: string;
}

/** Human-readable SmartSpectra frame validation guidance; contains no readings. */
export function describeValidationCode(code: number): PresageValidationDescription;
