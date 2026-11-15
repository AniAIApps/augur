import { configFromEnv, runHeadless, verifyLedgerFile } from './run';

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--verify') {
    if (!args[1]) {
      throw new Error('usage: augur-headless --verify <ledger.json>');
    }
    const v = await verifyLedgerFile(process.env, args[1]);
    process.stdout.write(`${v.text}\n`);
    return v.code;
  }
  const cfg = configFromEnv(process.env, process.argv.slice(2));
  const r = await runHeadless(cfg);
  process.stdout.write(`${r.answer}\n`);
  return r.stopReason === 'error' ? 1 : 0;
}

main().then(
  (code) => (process.exitCode = code),
  (e) => {
    process.stderr.write(`augur-headless: ${(e as Error)?.message ?? e}\n`);
    process.exitCode = 2;
  }
);
