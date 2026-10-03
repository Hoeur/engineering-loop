export interface ParsedEgressRule {
  host: string;
  port: number;
}

const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/u;

/** Parses `host:port` or `*.domain:port`. Bare hosts, URLs and port ranges are rejected. */
export const parseEgressRule = (rule: string): ParsedEgressRule => {
  const trimmed = rule.trim().toLowerCase();
  const separator = trimmed.lastIndexOf(':');
  const host = separator > 0 ? trimmed.slice(0, separator) : '';
  const port = Number(trimmed.slice(separator + 1));
  if (!HOST_PATTERN.test(host) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid egress rule "${rule}": expected host:port`);
  }
  return { host, port };
};

export const normalizeEgressAllowlist = (rules: readonly string[]): string[] => [
  ...new Set(rules.map(parseEgressRule).map((rule) => `${rule.host}:${String(rule.port)}`)),
];

export const egressAllowed = (rules: readonly string[], host: string, port: number): boolean => {
  const target = host.toLowerCase().replace(/^\[|\]$/gu, '');
  return rules.map(parseEgressRule).some((rule) => {
    if (rule.port !== port) return false;
    if (rule.host.startsWith('*.')) return target.endsWith(rule.host.slice(1));
    return rule.host === target;
  });
};

/**
 * Source of the per-run egress proxy, executed as `node -e` inside its own
 * container. Only HTTPS CONNECT to an allowlisted `host:port` is tunnelled; every
 * other request is refused and logged as `DENY host:port` for the run report.
 * The matching mirrors `egressAllowed` above.
 */
export const EGRESS_PROXY_SOURCE = String.raw`
'use strict';
const http = require('node:http');
const net = require('node:net');
const rules = (process.env.ENGLOOP_EGRESS_ALLOW || '').split(',').filter(Boolean).map((rule) => {
  const i = rule.lastIndexOf(':');
  return { host: rule.slice(0, i), port: Number(rule.slice(i + 1)) };
});
const allowed = (host, port) => {
  const target = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return rules.some((rule) => rule.port === port &&
    (rule.host.startsWith('*.') ? target.endsWith(rule.host.slice(1)) : rule.host === target));
};
const log = (decision, target) => process.stdout.write(decision + ' ' + target + '\n');
const server = http.createServer((req, res) => {
  let target = 'invalid';
  try {
    const url = new URL(req.url);
    target = url.hostname + ':' + (url.port || (url.protocol === 'http:' ? '80' : '443'));
  } catch {}
  log('DENY', target);
  res.writeHead(403).end();
});
server.on('connect', (req, client) => {
  const target = String(req.url || '');
  const i = target.lastIndexOf(':');
  const host = target.slice(0, i);
  const port = Number(target.slice(i + 1));
  client.on('error', () => client.destroy());
  if (i <= 0 || !Number.isInteger(port) || !allowed(host, port)) {
    log('DENY', target);
    client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const upstream = net.connect(port, host.replace(/^\[|\]$/g, ''), () => {
    log('ALLOW', target);
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on('error', () => {
    client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
});
server.listen(Number(process.env.ENGLOOP_EGRESS_PORT || 3128), '0.0.0.0');
`;

export const parseDeniedEgress = (logs: string): string[] => [
  ...new Set(
    logs
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('DENY '))
      .map((line) => line.slice('DENY '.length).trim()),
  ),
];
