import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';

export { Prisma };
export * from '@prisma/client';

export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface PrismaFactoryOptions {
  databaseUrl?: string;
  logQueries?: boolean;
}

/**
 * EngLoop runs Prisma **engine-free**: `engineType = "client"` in the schema makes
 * the client plan queries with the WebAssembly query compiler bundled inside
 * `@prisma/client`, and this driver adapter hands the resulting SQL to
 * `node-postgres`. Nothing platform-specific is ever downloaded, so `pnpm install`
 * works in slim containers, on unusual architectures and behind egress policies
 * that do not allow `binaries.prisma.sh`.
 *
 * See docs/adr/0001-engine-free-prisma.md.
 */
const resolveConnectionString = (databaseUrl?: string): string => {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env before starting any EngLoop process.',
    );
  }

  return connectionString;
};

/**
 * Constructor options for a Prisma client wired to the `pg` driver adapter.
 *
 * Exposed separately so consumers that must *subclass* `PrismaClient` (NestJS
 * injects `PrismaService extends PrismaClient`) stay free of adapter details —
 * `@engloop/db` remains the only package that knows which driver is in use.
 */
export const prismaClientOptions = (
  options: PrismaFactoryOptions = {},
): Prisma.PrismaClientOptions => ({
  adapter: new PrismaPg({ connectionString: resolveConnectionString(options.databaseUrl) }),
  log: options.logQueries
    ? [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ]
    : [
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
});

export const createPrismaClient = (options: PrismaFactoryOptions = {}): PrismaClient =>
  new PrismaClient(prismaClientOptions(options));

/**
 * Process-wide singleton.
 *
 * Next.js dev-server hot reload and NestJS watch mode both re-evaluate modules;
 * without this guard each reload would open a new connection pool until Postgres
 * refuses connections.
 */
const globalForPrisma = globalThis as unknown as { __engloopPrisma?: PrismaClient };

export const getPrismaClient = (options: PrismaFactoryOptions = {}): PrismaClient => {
  globalForPrisma.__engloopPrisma ??= createPrismaClient(options);
  return globalForPrisma.__engloopPrisma;
};

export const disconnectPrisma = async (): Promise<void> => {
  if (globalForPrisma.__engloopPrisma) {
    await globalForPrisma.__engloopPrisma.$disconnect();
    globalForPrisma.__engloopPrisma = undefined;
  }
};
