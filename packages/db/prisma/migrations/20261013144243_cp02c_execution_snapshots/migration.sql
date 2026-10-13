-- AlterTable
ALTER TABLE "public"."agent_runs" ADD COLUMN     "executionSnapshot" JSONB;

-- AlterTable
ALTER TABLE "public"."workflow_runs" ADD COLUMN     "executionSnapshot" JSONB;

-- Workflow inputs are fixed at insertion. Agent context is assigned once,
-- after the worker has provisioned its isolated checkout, before invocation.
CREATE FUNCTION enforce_execution_snapshot_immutability() RETURNS trigger AS $$
BEGIN
  IF NEW."executionSnapshot" IS DISTINCT FROM OLD."executionSnapshot" THEN
    IF TG_TABLE_NAME = 'workflow_runs' OR OLD."executionSnapshot" IS NOT NULL
       OR NEW."executionSnapshot" IS NULL OR OLD.status::text <> 'RUNNING' THEN
      RAISE EXCEPTION 'Execution snapshot is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflow_execution_snapshot_immutable
BEFORE UPDATE ON workflow_runs FOR EACH ROW
EXECUTE FUNCTION enforce_execution_snapshot_immutability();

CREATE TRIGGER agent_execution_snapshot_immutable
BEFORE UPDATE ON agent_runs FOR EACH ROW
EXECUTE FUNCTION enforce_execution_snapshot_immutability();
