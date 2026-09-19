import { createServer, type Server } from 'node:http';
import type { WorkerContext } from './context';

interface ProviderHealthSnapshot {
  healthy: boolean;
  detail: string;
  checkedAt: string;
}

export const persistProviderHealth = async (
  worker: WorkerContext,
  providers: Record<string, ProviderHealthSnapshot>,
): Promise<void> => {
  const configured = await worker.prisma.agentProvider.findMany({
    where: { enabled: true, key: { in: Object.keys(providers) } },
    select: { id: true, key: true },
  });
  await Promise.all(
    configured.map(({ id, key }) => {
      const health = providers[key];
      if (!health) return Promise.resolve();
      return worker.prisma.agentProvider.update({
        where: { id },
        data: {
          healthy: health.healthy,
          lastHealthCheckAt: new Date(health.checkedAt),
          lastHealthDetail: health.detail,
        },
      });
    }),
  );
};

const requiredProviderKeys = async (worker: WorkerContext): Promise<string[]> => {
  const [organizations, agents] = await Promise.all([
    worker.prisma.organization.findMany({ select: { defaultProviderKey: true } }),
    worker.prisma.agent.findMany({
      where: { enabled: true, provider: { enabled: true } },
      select: { provider: { select: { key: true } } },
    }),
  ]);
  return [
    ...new Set([
      ...organizations.map((row) => row.defaultProviderKey || worker.env.AGENT_DEFAULT_PROVIDER),
      ...agents.map((row) => row.provider.key),
    ]),
  ];
};

/** Minimal health endpoint so Docker/K8s can probe the worker. */
export const startHealthServer = (worker: WorkerContext, port: number): Server => {
  const server = createServer((req, res) => {
    if (req.url !== '/health' && req.url !== '/health/live') {
      res.writeHead(404).end();
      return;
    }

    void (async () => {
      let database = false;
      try {
        await worker.prisma.$queryRaw`SELECT 1`;
        database = true;
      } catch {
        database = false;
      }

      const providers = await worker.registry.healthCheckAll();
      let requiredKeys: string[] = [];
      if (database) {
        try {
          [requiredKeys] = await Promise.all([
            requiredProviderKeys(worker),
            persistProviderHealth(worker, providers),
          ]);
        } catch (error) {
          worker.logger.warn({ error: String(error) }, 'provider.health.persist_failed');
        }
      }
      const configuredProvidersHealthy =
        requiredKeys.length > 0 &&
        requiredKeys.every((key) => providers[key]?.healthy === true);
      const ready = database && configuredProvidersHealthy;
      const livenessOnly = req.url === '/health/live';
      const body = JSON.stringify({
        status: ready ? 'ok' : 'degraded',
        service: 'engloop-worker',
        uptimeSeconds: Math.round(process.uptime()),
        dependencies: { database: { healthy: database } },
        requiredProviders: requiredKeys,
        providers,
      });

      res.writeHead(livenessOnly || ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(body);
    })();
  });

  server.listen(port);
  return server;
};
