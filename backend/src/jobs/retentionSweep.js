import { runRetentionSweep } from '../services/retentionPolicy.js';

async function main() {
  const result = await runRetentionSweep();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
