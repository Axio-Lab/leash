/**
 * Smoke tests for `@leashmarket/cli`.
 *
 * The CLI is consumed via the `leash` binary, so end-to-end tests
 * here run the source under `tsx` in a child process and assert on
 * stdout. Keeps them isolated from any global agent.json state.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(here, '..', 'src', 'cli.ts');

// Isolated HOME directory so `loadAgentSession` never finds a real
// ~/.config/leash/agent.json on the developer's machine. This is the
// correct isolation — blanking env vars alone is not enough because
// the config-reader falls back to the file after the env check.
const fakeHome = mkdtempSync(join(tmpdir(), 'leash-cli-test-home-'));
afterAll(() => rmSync(fakeHome, { recursive: true, force: true }));

function runCli(args: string[]): { code: number | null; stdout: string; stderr: string } {
  // We invoke `node --import tsx <entry>` to mirror the package.json
  // `dev` script. Spawning the source directly avoids needing a build
  // step before tests can run.
  const result = spawnSync(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      // Point HOME at an empty temp dir so os.homedir() resolves to a
      // path that has no ~/.config/leash/agent.json. Also blank the env
      // vars so there's no other source of ambient agent state.
      HOME: fakeHome,
      USERPROFILE: fakeHome, // Windows compat (os.homedir() reads this on win32)
      LEASH_AGENT_MINT: '',
      LEASH_EXECUTIVE_KEY: '',
    },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('leash CLI', () => {
  it('prints help on `--help`', () => {
    const { code, stdout } = runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('usage: leash');
    expect(stdout).toContain('agent create');
    expect(stdout).toContain('treasury balance');
    expect(stdout).toContain('discover');
    expect(stdout).toContain('reputation');
  });

  it('prints version on `-v`', () => {
    const { code, stdout } = runCli(['-v']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^leash \d+\.\d+\.\d+/);
  });

  it('rejects unknown commands with code 2', () => {
    const { code, stderr } = runCli(['nonsense']);
    expect(code).toBe(2);
    expect(stderr).toContain('unknown command');
  });

  it('agent show without config reports no_agent gracefully', () => {
    const { code, stdout } = runCli(['agent', 'show']);
    expect(code).toBe(0);
    // The default placeholder host returns `no_agent`; the formatter
    // turns that into a friendly message.
    expect(stdout).toMatch(/no agent configured/i);
  });
});
