-- AddEnumValue: UI_QA joins WorkflowStepKey for the UI review step (roadmap 4).
--
-- Positioned BEFORE 'REVIEW' so the enum's declared order keeps matching the
-- order the steps actually execute in — UI review runs after the deterministic
-- checks and before code review. Ordering is cosmetic to Prisma but it is what
-- anything sorting by the enum (and anyone reading \dT+) relies on.
--
-- IF NOT EXISTS makes this idempotent: `db:deploy` is run repeatedly against
-- environments that may already have been migrated.
ALTER TYPE "WorkflowStepKey" ADD VALUE IF NOT EXISTS 'UI_QA' BEFORE 'REVIEW';
