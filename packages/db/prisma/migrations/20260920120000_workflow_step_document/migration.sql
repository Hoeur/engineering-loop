-- AddEnumValue: DOCUMENT joins WorkflowStepKey for the documentation step.
--
-- Positioned BEFORE 'PREPARE_PR' so the enum's declared order keeps matching
-- the order the steps actually execute in — documentation runs after the
-- review is approved and before the pull request is opened, so the PR
-- description can cite work that already exists.
--
-- IF NOT EXISTS makes this idempotent: `db:deploy` is run repeatedly against
-- environments that may already have been migrated.
ALTER TYPE "WorkflowStepKey" ADD VALUE IF NOT EXISTS 'DOCUMENT' BEFORE 'PREPARE_PR';
