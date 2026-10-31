import { spawn } from 'node:child_process';

const flags = {
  'mass-assignment': 'LAB_MASS_ASSIGNMENT',
  'match-replace': 'LAB_MATCH_REPLACE',
  'excessive-data': 'LAB_EXCESSIVE_DATA',
  'race-condition': 'LAB_RACE_CONDITION',
};

const flag = flags[process.argv[2]];
if (!flag) {
  console.error('Informe mass-assignment, match-replace, excessive-data ou race-condition.');
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', 'server.js'],
  {
    stdio: 'inherit',
    env: { ...process.env, [flag]: 'true' },
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
