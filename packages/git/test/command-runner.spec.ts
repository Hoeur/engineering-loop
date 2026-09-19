import { describe, expect, it } from 'vitest';
import { CommandNotAllowedError, CommandRunner, CommandTimeoutError } from '../src';

const runner = new CommandRunner({
  allowlist: ['node', 'echo', 'sh'],
  defaultTimeoutMs: 5_000,
  maxBufferBytes: 1024,
});

describe('CommandRunner', () => {
  it('refuses an executable outside the allowlist', async () => {
    await expect(
      runner.run({ command: 'curl', args: ['https://example.com'], cwd: process.cwd() }),
    ).rejects.toBeInstanceOf(CommandNotAllowedError);
  });

  it('allows an allowlisted executable and captures stdout', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['-e', 'process.stdout.write("hello")'],
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('writes the provided input to stdin and closes the stream', async () => {
    const result = await runner.run({
      command: 'node',
      args: [
        '-e',
        'let data=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => data += chunk); process.stdin.on("end", () => process.stdout.write(data));',
      ],
      cwd: process.cwd(),
      stdin: 'structured request over stdin',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('structured request over stdin');
    expect(result.args).not.toContain('structured request over stdin');
  });

  it('writes input to stdin and closes the stream', async () => {
    const result = await runner.run({
      command: 'node',
      args: [
        '-e',
        'let value = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => value += chunk); process.stdin.on("end", () => process.stdout.write(value));',
      ],
      cwd: process.cwd(),
      stdin: 'request-through-stdin',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('request-through-stdin');
    expect(result.args).not.toContain('request-through-stdin');
  });

  it('reports a non-zero exit code instead of hiding it', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['-e', 'process.stderr.write("boom"); process.exit(3)'],
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('boom');
  });

  it('never interprets arguments as shell syntax', async () => {
    // With shell: true this would run `id`; with spawn+argv it is literal text.
    const result = await runner.run({
      command: 'node',
      args: ['-e', 'process.stdout.write(process.argv[1] ?? "")', '$(id)'],
      cwd: process.cwd(),
    });
    expect(result.stdout).toBe('$(id)');
  });

  it('truncates output beyond the buffer cap', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['-e', 'process.stdout.write("x".repeat(5000))'],
      cwd: process.cwd(),
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(1024);
  });

  it('kills a command that exceeds its timeout', async () => {
    await expect(
      runner.run({
        command: 'node',
        args: ['-e', 'setTimeout(() => {}, 10000)'],
        cwd: process.cwd(),
        timeoutMs: 200,
      }),
    ).rejects.toBeInstanceOf(CommandTimeoutError);
  });

  it('cancels a running command through an AbortSignal', async () => {
    const controller = new AbortController();
    const pending = runner.run({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      cwd: process.cwd(),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('passes only allowlisted environment variables to the child', async () => {
    process.env.ENGLOOP_SECRET_FOR_TEST = 'super-secret';
    const result = await runner.run({
      command: 'node',
      args: ['-e', 'process.stdout.write(String(process.env.ENGLOOP_SECRET_FOR_TEST))'],
      cwd: process.cwd(),
    });
    delete process.env.ENGLOOP_SECRET_FOR_TEST;
    expect(result.stdout).toBe('undefined');
  });

  it('accepts a path-qualified executable whose basename is allowlisted', () => {
    expect(runner.isAllowed('/usr/local/bin/node')).toBe(true);
    expect(runner.isAllowed('/usr/local/bin/curl')).toBe(false);
  });
});
