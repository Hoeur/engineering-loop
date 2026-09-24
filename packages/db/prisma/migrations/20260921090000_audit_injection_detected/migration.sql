-- AddEnumValue: INJECTION_DETECTED joins AuditAction.
--
-- Written by the worker when the prompt-injection scanner flags task input or
-- repository guidance before an agent provider is spawned. HIGH-confidence
-- findings also fail the agent run closed; lower confidence is audit-only.
--
-- IF NOT EXISTS makes this idempotent: `db:deploy` is run repeatedly against
-- environments that may already have been migrated.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INJECTION_DETECTED';
