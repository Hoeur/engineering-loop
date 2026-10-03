import { describe, expect, it } from 'vitest';
import { agentContainerArgs, execArgs, parseSandboxUser, toContainerPath } from './container-args';

const spec = {
  name: 'engloop-run-1',
  runId: 'run-1',
  owner: 'worker-a',
  image: 'engloop/agent-sandbox:local',
  user: { uid: 1000, gid: 1000 },
  limits: { cpus: 1, memoryMb: 256, pidsLimit: 64, tmpfsMb: 32 },
  workspacePath: '/srv/workspace/worktrees/ENG-1',
  scratchPath: '/srv/workspace/sandbox/run-1',
  network: null,
  proxyHost: null,
};

describe('container args', () => {
  it('locks the agent container down and mounts only the worktree and scratch dir', () => {
    const args = agentContainerArgs(spec);
    expect(args).toEqual(
      expect.arrayContaining(['--read-only', '--init', '--cap-drop', 'ALL', 'no-new-privileges']),
    );
    expect(args.join(' ')).toContain('--memory 256m --memory-swap 256m --pids-limit 64');
    expect(args.join(' ')).toContain('--network none');
    expect(args.filter((arg) => arg.startsWith('type=bind'))).toEqual([
      'type=bind,source=/srv/workspace/worktrees/ENG-1,target=/workspace',
      'type=bind,source=/srv/workspace/sandbox/run-1,target=/engloop/run',
    ]);
    expect(args).not.toContain('--privileged');
  });

  it('refuses a mount path that could inject mount options', () => {
    expect(() =>
      agentContainerArgs({ ...spec, workspacePath: '/srv/x,target=/etc,readonly=false' }),
    ).toThrow(/cannot be bind-mounted/u);
    expect(() => agentContainerArgs({ ...spec, workspacePath: 'relative/path' })).toThrow();
  });

  it('routes egress through the proxy only when one is configured', () => {
    const args = agentContainerArgs({ ...spec, network: 'net-1', proxyHost: 'proxy-1' });
    expect(args.join(' ')).toContain('--network net-1');
    expect(args).toContain('HTTPS_PROXY=http://proxy-1:3128');
  });

  it('passes secrets by name only', () => {
    const args = execArgs({
      container: 'c',
      cwd: '/workspace',
      envNames: ['CODEX_API_KEY'],
      command: 'codex',
      args: ['exec'],
    });
    expect(args).toEqual([
      'exec',
      '--interactive',
      '--workdir',
      '/workspace',
      '--env',
      'CODEX_API_KEY',
      'c',
      'codex',
      'exec',
    ]);
    expect(() =>
      execArgs({ container: 'c', cwd: '/', envNames: ['A=leak'], command: 'x', args: [] }),
    ).toThrow();
  });

  it('maps host paths inside mounts and leaves everything else untouched', () => {
    const mounts = [
      ['/srv/w/ENG-1', '/workspace'],
      ['/srv/s/run-1', '/engloop/run'],
    ] as const;
    expect(toContainerPath(mounts, '/srv/w/ENG-1')).toBe('/workspace');
    expect(toContainerPath(mounts, '/srv/w/ENG-1/src/a.ts')).toBe('/workspace/src/a.ts');
    expect(toContainerPath(mounts, '/srv/s/run-1/out.json')).toBe('/engloop/run/out.json');
    expect(toContainerPath(mounts, '/srv/w/ENG-10/a.ts')).toBe('/srv/w/ENG-10/a.ts');
    expect(toContainerPath(mounts, '--json')).toBe('--json');
  });

  it('refuses root and malformed users', () => {
    expect(parseSandboxUser('1000:1000')).toEqual({ uid: 1000, gid: 1000 });
    expect(() => parseSandboxUser('0:0')).toThrow(/uid 0/u);
    expect(() => parseSandboxUser('agent')).toThrow();
  });
});
