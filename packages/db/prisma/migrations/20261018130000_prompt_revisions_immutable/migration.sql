-- Prompt revisions are immutable: "template T, revision N" must always mean one
-- text. The API never updates a revision, but nothing in the database stopped it.
-- Deletes stay possible so a template's revisions still cascade with it.
CREATE FUNCTION "public"."enforce_prompt_revision_immutability"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Prompt revision is immutable; add a new revision instead'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "prompt_revision_immutable"
  BEFORE UPDATE ON "public"."prompt_revisions"
  FOR EACH ROW EXECUTE FUNCTION "public"."enforce_prompt_revision_immutability"();
