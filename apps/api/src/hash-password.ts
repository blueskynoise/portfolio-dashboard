import { createInterface } from 'node:readline';
import { hashPassword } from './admin/auth';

// Reads the password from stdin so it never appears in shell history or the process list.
const rl = createInterface({ input: process.stdin, terminal: false });
process.stderr.write('Admin password (input is read from stdin): ');
rl.once('line', (line) => {
  rl.close();
  if (line.length < 12) {
    console.error('\nUse at least 12 characters.');
    process.exit(1);
  }
  console.log(`\nADMIN_PASSWORD_HASH=${hashPassword(line)}`);
});
