# ADR 0001 — Prisma runs engine-free (driver adapter + WebAssembly)

**Status:** accepted · **Date:** 2026-09-08

## Context

Prisma's default Node setup downloads two platform-specific Rust binaries from
`binaries.prisma.sh` at install time:

- `libquery_engine.so.node` — plans queries and owns the connection pool
- `schema-engine` — powers `migrate dev`, `migrate deploy`, `db push`, `db pull`

That download is a hard dependency of `pnpm install`, `prisma generate` **and**
every migrate command. It fails in three situations EngLoop cares about:

1. **Restricted egress.** Corporate proxies and sandboxed CI allow the npm
   registry but not arbitrary CDNs. `binaries.prisma.sh` returns 403 and the
   install dies — which is exactly what happened while this MVP was being built.
2. **Slim or unusual images.** The binaries are glibc/OpenSSL-version specific;
   Alpine, musl and newer OpenSSL builds routinely resolve to the wrong target.
3. **Reproducibility.** A lockfile pins npm packages, not CDN artefacts.

## Decision

Run Prisma with **no native engines at all**:

```prisma
generator client {
  provider   = "prisma-client-js"
  engineType = "client"          // query planning in the bundled WASM compiler
}
```

```ts
// packages/db/src/client.ts
new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
```

```ts
// packages/db/prisma.config.ts — makes the CLI use the WASM schema engine
export default defineConfig({
  experimental: { adapter: true },
  adapter: async () => new PrismaPg({ connectionString }),
});
```

- `engineType = "client"` makes `@prisma/client` compile queries with
  `query_compiler_bg.postgresql.wasm`, which ships **inside the npm package**.
- `@prisma/adapter-pg` hands the resulting SQL to `node-postgres`, so connection
  pooling, TLS and timeouts are plain `pg` configuration.
- Declaring an `adapter` in `prisma.config.ts` switches the CLI from the native
  `schema-engine` binary to `schema_engine_bg.wasm`, which ships inside the
  `prisma` package.

Everything therefore comes from the lockfile. `pnpm install` and
`prisma generate` never touch a CDN.

## Consequences

**Good**

- Installs work behind a proxy allowlist that only permits npm, in slim images,
  and on architectures with no prebuilt engine.
- One connection-pool implementation (`pg`) for the app, migrations and scripts.
- This is the direction Prisma itself is taking: driver adapters and the query
  compiler are the default in Prisma 7.

**Costs and caveats**

- `datasources: { db: { url } }` is no longer accepted at construction time; the
  URL is passed to the adapter instead. `packages/db` exports
  `prismaClientOptions()` so subclasses (`PrismaService extends PrismaClient`)
  stay free of adapter details.
- The `url` in the `datasource` block is unused at runtime and Prisma prints a
  warning saying so. It is kept because `prisma migrate diff` and editor
  tooling still read it.
- `prisma db push` and `prisma migrate dev` introspect the live database, and
  `@prisma/adapter-pg@6.16.2` cannot decode PostgreSQL's internal `name` type
  (OID 19) returned by those catalogue queries. Schema changes are therefore
  produced with `prisma migrate diff`, which needs no introspection:

  ```bash
  pnpm db:migrate add_deployment_targets   # diff -> prisma/migrations/<ts>_<name>/migration.sql
  pnpm db:deploy                           # apply pending migrations via `pg`
  pnpm db:baseline                         # record migrations as applied, no SQL run
  pnpm db:status                           # prisma migrate status (works unchanged)
  pnpm db:reset                            # drop schema, re-apply every migration
  ```

  `db:baseline` is the equivalent of `prisma migrate resolve --applied`: when a
  database already carries the schema (an earlier `db push`, a restored dump, an
  established production database) but `_prisma_migrations` is empty, `db:deploy`
  would fail with `type "X" already exists`. Baselining records the history
  without executing any SQL, and the failure message points at it.

  `packages/db/scripts/create-migration.mjs` diffs the **previous datamodel**
  (`prisma/migrations/applied-datamodel.prisma`, updated on every migration)
  against `prisma/schema.prisma`, so Prisma still writes the SQL and no database
  is touched. `deploy-migrations.mjs` applies each pending file in its own
  transaction and records it in `_prisma_migrations` with the same checksum
  scheme Prisma uses — `prisma migrate status` therefore keeps working and
  reports the schema as up to date.

  The checked-in `prisma/migrations/0_init/migration.sql` (38 tables, 38 enums)
  was generated exactly this way and applied to a live PostgreSQL 16 instance.
  Prisma 7's adapter maps OID 19, so `db push` becomes available again on the
  next major upgrade.

## Alternatives considered

- **Vendor the engines into the repo.** Rejected: ~40 MB of per-platform
  binaries in git, and still wrong for any platform not vendored.
- **Wait for `@prisma/schema-engine-wasm`.** It exists on npm only under
  commit-suffixed versions, and wiring it in by hand duplicates what the CLI
  already does through `prisma.config.ts`.
- **Upgrade the whole stack to Prisma 7.** It fixes the `name` decoding, but a
  major version bump (new generator, new client output layout, new config
  contract) is not something to do while stabilising an MVP. Recorded as a
  follow-up instead.
