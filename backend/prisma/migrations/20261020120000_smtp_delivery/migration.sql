-- Existing actions stay simulated when SMTP is enabled later.
ALTER TABLE "ActionRequest" ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'SIMULATED';
ALTER TABLE "ActionRequest" ADD COLUMN "emailSender" VARCHAR(254);
ALTER TABLE "ActionRequest" ADD CONSTRAINT "ActionRequest_executionMode_check"
  CHECK ("executionMode" IN ('SIMULATED', 'SMTP') AND
    ("executionMode" <> 'SMTP' OR ("action" = 'SEND_EMAIL' AND "emailSender" IS NOT NULL)));
