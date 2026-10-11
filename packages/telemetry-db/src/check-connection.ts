import { checkConnection, connectionErrorCategory } from './connection-check.js';

checkConnection()
  .then(() => console.log('Database connection check succeeded.'))
  .catch((error: unknown) => {
    console.error(`Database connection check failed: ${connectionErrorCategory(error)}.`);
    process.exitCode = 1;
  });
