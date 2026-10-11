// Browser-safe copy of the SmartSpectra SDK validation labels and guidance.
// Keep this shared with the Node diagnostics so the UI and SDK reports agree.
const VALIDATION_STATUS = new Map([
  [0, { name: 'ok', message: 'Frame passes the SDK readiness checks.', action: 'Hold the current position while readings stabilize.' }],
  [1, { name: 'noFaceFound', message: 'No face was detected in the frame.', action: 'Place one face in frame, facing the camera.' }],
  [2, { name: 'multipleFacesFound', message: 'More than one face was detected.', action: 'Ensure only one person is in frame.' }],
  [3, { name: 'faceNotCentered', message: 'Face is off-center horizontally.', action: 'Center your face in the camera frame.' }],
  [4, { name: 'faceSizeOutOfRange', message: 'Face size is outside the usable range.', action: 'Adjust your distance from the camera.' }],
  [5, { name: 'tooDark', message: 'The image is underexposed.', action: 'Use even, brighter lighting from in front of you.' }],
  [6, { name: 'tooBright', message: 'The image is overexposed.', action: 'Reduce bright light or backlighting.' }],
  [7, { name: 'chestNotVisible', message: 'Your upper chest is not visible or is too far away.', action: 'Reframe so your upper chest is visible and unobstructed.' }],
  [10, { name: 'cameraTuning', message: 'Camera exposure or focus is still adjusting.', action: 'Wait briefly and hold your position.' }],
  [11, { name: 'frameRateTooLow', message: 'The camera frame rate is too low for a reliable reading.', action: 'Improve lighting and reduce concurrent device load.' }],
  [12, { name: 'excessiveMotion', message: 'Head or body motion is above the reliable-measurement threshold.', action: 'Stay still and keep the camera stable.' }],
  [13, { name: 'faceTooClose', message: 'Your face fills too much of the frame.', action: 'Move farther from the camera.' }],
  [14, { name: 'faceTooFar', message: 'Your face is too small in the frame.', action: 'Move closer to the camera.' }],
  [15, { name: 'faceTooHigh', message: 'Your face is too high in the frame.', action: 'Lower your position or tilt the camera upward.' }],
  [16, { name: 'faceTooLow', message: 'Your face is too low in the frame.', action: 'Raise your face in the frame or adjust the camera angle.' }],
  [17, { name: 'faceNotForward', message: 'Your face is turned or tilted away from the camera.', action: 'Face the camera directly.' }],
]);

export function describeValidationCode(code) {
  return VALIDATION_STATUS.get(code) ?? {
    name: 'unknownValidationCode',
    message: 'The camera image has not passed the SDK quality checks.',
    action: 'Center your face and upper chest, face the camera, and hold still.',
  };
}
