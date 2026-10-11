import { runCalibrationCli } from './cli-core.js';

async function readStandardInput(): Promise<string> {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main(): Promise<void> {
  const input = await readStandardInput();
  const result = await runCalibrationCli(input);
  process.stdout.write(`${JSON.stringify(result.response)}\n`);
  process.stderr.write(`adaptive-calibration: ${result.diagnostic}\n`);
  process.exitCode = result.exitCode;
}

void main().catch(() => {
  // Do not emit error details: input may contain interview content.
  process.stdout.write('{"ok":false,"error":"calibration_error"}\n');
  process.stderr.write('adaptive-calibration: calibration_error\n');
  process.exitCode = 3;
});
