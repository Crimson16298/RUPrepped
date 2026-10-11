import { describeValidationCode as describeSharedValidationCode } from '../../../packages/presage-companion-client/src/validation.mjs';

export const describeValidationCode = describeSharedValidationCode;

export function summarizeValidationStatus(statusByCode) {
  return [...statusByCode.entries()]
    .sort(([left], [right]) => left - right)
    .map(([code, aggregate]) => ({
      code,
      ...describeValidationCode(code),
      count: aggregate.count,
      hintPresent: aggregate.hintPresent,
    }));
}
