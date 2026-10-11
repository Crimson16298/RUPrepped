// These labels and actions mirror the public ValidationCode definitions in
// @smartspectra/node-sdk@3.4.0 and the SmartSpectra measurement-quality guide.
const VALIDATION_STATUS = new Map([
  [0, { name: 'ok', message: 'Frame passes the SDK readiness checks.', action: 'Hold the current position.' }],
  [1, { name: 'noFaceFound', message: 'No face detected in the frame.', action: 'Place one face in frame, facing the camera.' }],
  [2, { name: 'multipleFacesFound', message: 'More than one face was detected.', action: 'Ensure only one person is in frame.' }],
  [3, { name: 'faceNotCentered', message: 'Face is off-center horizontally.', action: 'Center the face in the frame.' }],
  [4, { name: 'faceSizeOutOfRange', message: 'Face size is outside the usable range.', action: 'Use the more specific too-close or too-far guidance when available.' }],
  [5, { name: 'tooDark', message: 'Image is underexposed.', action: 'Use even, brighter lighting.' }],
  [6, { name: 'tooBright', message: 'Image is overexposed.', action: 'Reduce light or avoid backlighting.' }],
  [7, { name: 'chestNotVisible', message: 'Chest is not visible or is too far away for breathing/chest metrics.', action: 'Reframe so the upper chest is visible and unobstructed.' }],
  [10, { name: 'cameraTuning', message: 'Camera exposure or focus is still adjusting.', action: 'Wait briefly before measuring.' }],
  [11, { name: 'frameRateTooLow', message: 'Camera frame rate is too low.', action: 'Improve lighting and reduce concurrent device load.' }],
  [12, { name: 'excessiveMotion', message: 'Head or body motion exceeds the reliable-measurement threshold.', action: 'Keep still and keep the camera stable.' }],
  [13, { name: 'faceTooClose', message: 'Face fills too much of the frame.', action: 'Move farther from the camera.' }],
  [14, { name: 'faceTooFar', message: 'Face is too small in the frame.', action: 'Move closer to the camera.' }],
  [15, { name: 'faceTooHigh', message: 'Face is too high in the frame.', action: 'Move down or tilt the camera up.' }],
  [16, { name: 'faceTooLow', message: 'Face is too low in the frame.', action: 'Move up or tilt the camera down.' }],
  [17, { name: 'faceNotForward', message: 'Face is turned or tilted too far from the camera.', action: 'Face the camera more directly.' }],
]);

export function describeValidationCode(code) {
  return VALIDATION_STATUS.get(code) ?? {
    name: 'unknownValidationCode',
    message: 'The SDK reported an unrecognized validation code.',
    action: 'Consult the SDK version documentation before interpreting it.',
  };
}

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
