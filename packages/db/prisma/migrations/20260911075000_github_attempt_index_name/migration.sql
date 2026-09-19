-- RenameIndex: 202609110001_github_app_integration named this index
-- "github_authorization_attempts_organizationId_userId_consumedAt_idx" (66 bytes).
-- PostgreSQL silently truncates identifiers to 63 bytes, so the database ended up
-- with a name Prisma never generates. Rename it to the name Prisma derives from
-- schema.prisma, so `prisma migrate diff` against this database reports no drift.
ALTER INDEX IF EXISTS "public"."github_authorization_attempts_organizationId_userId_consumedAt_" RENAME TO "github_authorization_attempts_organizationId_userId_consume_idx";
