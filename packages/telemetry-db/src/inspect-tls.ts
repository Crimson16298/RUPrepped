import { inspectPostgresTls, tlsInspectionErrorCategory } from './tls-inspection.js';

inspectPostgresTls()
  .then((report) => console.log(JSON.stringify(report)))
  .catch((error: unknown) => {
    console.error(`TLS inspection failed: ${tlsInspectionErrorCategory(error)}.`);
    process.exitCode = 1;
  });
