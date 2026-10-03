import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { EGRESS_PROXY_SOURCE } from './egress-policy';

export const CONTAINER_WORKSPACE = '/workspace';
export const CONTAINER_SCRATCH = '/engloop/run';
export const CONTAINER_HOME = '/home/agent';
export const EGRESS_PROXY_PORT = 3128;

export const LABEL_RUNTIME = 'engloop.runtime';
export const LABEL_OWNER = 'engloop.owner';
export const LABEL_RUN = 'engloop.run-id';

export interface ContainerLimits {
  cpus: number;
  memoryMb: number;
  pidsLimit: number;
  tmpfsMb: number;
}

export interface SandboxUser {
  uid: number;
  gid: number;
}

export const parseSandboxUser = (value: string): SandboxUser => {
  const match = /^(\d+):(\d+)$/u.exec(value.trim());
  if (!match) throw new Error(`Invalid sandbox user "${value}": expected uid:gid`);
  const uid = Number(match[1]);
  const gid = Number(match[2]);
  if (uid === 0) throw new Error('The agent sandbox refuses to run as uid 0');
  return { uid, gid };
};

const labels = (runtime: string, owner: string, runId?: string): string[] => [
  '--label',
  `${LABEL_RUNTIME}=${runtime}`,
  '--label',
  `${LABEL_OWNER}=${owner}`,
  ...(runId ? ['--label', `${LABEL_RUN}=${runId}`] : []),
];

/** Flags every sandbox container gets: no writable image, no capabilities, no setuid escalation. */
const hardening = (user: SandboxUser): string[] => [
  '--read-only',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges',
  '--user',
  `${String(user.uid)}:${String(user.gid)}`,
];

const resourceCaps = (limits: ContainerLimits): string[] => [
  '--cpus',
  String(limits.cpus),
  '--memory',
  `${String(limits.memoryMb)}m`,
  // Equal to --memory: no swap, so the memory cap is a real cap.
  '--memory-swap',
  `${String(limits.memoryMb)}m`,
  '--pids-limit',
  String(limits.pidsLimit),
];

const scratchMounts = (limits: ContainerLimits, user: SandboxUser): string[] => [
  '--tmpfs',
  `/tmp:rw,nosuid,nodev,size=${String(limits.tmpfsMb)}m,mode=1777`,
  '--tmpfs',
  `${CONTAINER_HOME}:rw,nosuid,nodev,size=${String(limits.tmpfsMb)}m,uid=${String(user.uid)},gid=${String(user.gid)},mode=0700`,
  '--env',
  `HOME=${CONTAINER_HOME}`,
  '--env',
  'TMPDIR=/tmp',
];

/** `--mount` is comma-separated; a path that could inject mount options is refused. */
export const assertMountablePath = (path: string): void => {
  if (!isAbsolute(path) || /[,="\n\r]/u.test(path)) {
    throw new Error(`Path "${path}" cannot be bind-mounted into the agent sandbox`);
  }
};

export interface AgentContainerSpec {
  name: string;
  runId: string;
  owner: string;
  image: string;
  user: SandboxUser;
  limits: ContainerLimits;
  workspacePath: string;
  scratchPath: string;
  /** Internal network shared only with this run's egress proxy, or none. */
  network: string | null;
  proxyHost: string | null;
}

export const agentContainerArgs = (spec: AgentContainerSpec): string[] => {
  assertMountablePath(spec.workspacePath);
  assertMountablePath(spec.scratchPath);
  const proxyUrl = spec.proxyHost ? `http://${spec.proxyHost}:${String(EGRESS_PROXY_PORT)}` : null;
  return [
    'create',
    '--name',
    spec.name,
    ...labels('agent', spec.owner, spec.runId),
    ...hardening(spec.user),
    '--init',
    ...resourceCaps(spec.limits),
    ...scratchMounts(spec.limits, spec.user),
    '--mount',
    `type=bind,source=${spec.workspacePath},target=${CONTAINER_WORKSPACE}`,
    '--mount',
    `type=bind,source=${spec.scratchPath},target=${CONTAINER_SCRATCH}`,
    '--network',
    spec.network ?? 'none',
    ...(proxyUrl
      ? ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].flatMap((name) => [
          '--env',
          `${name}=${proxyUrl}`,
        ])
      : []),
    '--workdir',
    CONTAINER_WORKSPACE,
    '--entrypoint',
    'sleep',
    spec.image,
    'infinity',
  ];
};

export interface ProxyContainerSpec {
  name: string;
  runId: string;
  owner: string;
  image: string;
  network: string;
  egressAllowlist: readonly string[];
}

const PROXY_USER: SandboxUser = { uid: 65_534, gid: 65_534 };

export const proxyContainerArgs = (spec: ProxyContainerSpec): string[] => [
  'run',
  '--detach',
  '--name',
  spec.name,
  ...labels('egress-proxy', spec.owner, spec.runId),
  ...hardening(PROXY_USER),
  ...resourceCaps({ cpus: 0.25, memoryMb: 64, pidsLimit: 64, tmpfsMb: 0 }),
  '--network',
  spec.network,
  '--env',
  `ENGLOOP_EGRESS_ALLOW=${spec.egressAllowlist.join(',')}`,
  '--env',
  `ENGLOOP_EGRESS_PORT=${String(EGRESS_PROXY_PORT)}`,
  '--entrypoint',
  'node',
  spec.image,
  '-e',
  EGRESS_PROXY_SOURCE,
];

export interface HealthContainerSpec {
  owner: string;
  image: string;
  user: SandboxUser;
  limits: ContainerLimits;
  command: string;
  args: readonly string[];
}

/** Health probes run in a throwaway container: no mounts, no network, no run credentials. */
export const healthContainerArgs = (spec: HealthContainerSpec): string[] => [
  'run',
  '--rm',
  '--interactive',
  ...labels('health', spec.owner),
  ...hardening(spec.user),
  ...resourceCaps(spec.limits),
  ...scratchMounts(spec.limits, spec.user),
  '--network',
  'none',
  '--entrypoint',
  spec.command,
  spec.image,
  ...spec.args,
];

export interface ExecSpec {
  container: string;
  cwd: string;
  envNames: readonly string[];
  command: string;
  args: readonly string[];
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/**
 * `--env NAME` without a value makes the docker client copy it from its own
 * environment, so secret values never appear in argv or `docker inspect`.
 */
export const execArgs = (spec: ExecSpec): string[] => {
  for (const name of spec.envNames) {
    if (!ENV_NAME.test(name)) throw new Error(`Invalid environment variable name "${name}"`);
  }
  return [
    'exec',
    '--interactive',
    '--workdir',
    spec.cwd,
    ...spec.envNames.flatMap((name) => ['--env', name]),
    spec.container,
    spec.command,
    ...spec.args,
  ];
};

const normalize = (value: string): string => {
  const resolved = resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

export const containsPath = (parent: string, child: string): boolean => {
  const path = relative(normalize(parent), normalize(child));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

/** Rewrites a host path inside a mounted directory to its in-container path. */
export const toContainerPath = (
  mounts: ReadonlyArray<readonly [host: string, container: string]>,
  value: string,
): string => {
  if (!isAbsolute(value)) return value;
  for (const [host, container] of mounts) {
    if (!containsPath(host, value)) continue;
    const rel = relative(normalize(host), normalize(value));
    return rel ? posix.join(container, ...rel.split(sep)) : container;
  }
  return value;
};

/** Docker names allow [a-zA-Z0-9][a-zA-Z0-9_.-]*. */
export const containerSafeId = (value: string): string =>
  value
    .replace(/[^a-zA-Z0-9_.-]/gu, '-')
    .replace(/^[^a-zA-Z0-9]+/u, '')
    .slice(0, 40) || 'run';
