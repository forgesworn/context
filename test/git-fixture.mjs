import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Git hooks export repository/index settings. A fixture's `git -C` alone does
// not override them: clear them before any fixture init/config/add/commit.
export function fixtureExec(file, args, options = {}) {
  const env = Object.fromEntries(Object.entries(options.env ?? process.env)
    .filter(([key]) => !key.startsWith('GIT_')));
  return exec(file, args, { ...options, env });
}
