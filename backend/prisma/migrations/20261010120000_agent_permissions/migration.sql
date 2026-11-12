-- Existing agents receive no implicit tool grants.
ALTER TABLE "Agent" ADD COLUMN "allowedTools" "ActionType"[] NOT NULL DEFAULT ARRAY[]::"ActionType"[];
