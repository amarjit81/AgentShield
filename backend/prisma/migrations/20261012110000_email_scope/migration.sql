ALTER TYPE "ActionType" ADD VALUE 'SEND_EMAIL';
ALTER TABLE "PolicyDecision" ALTER COLUMN "autoApproveLimit" DROP NOT NULL;
ALTER TABLE "PolicyDecision" ALTER COLUMN "maxAllowedRefund" DROP NOT NULL;
ALTER TABLE "PolicyDecision" ADD COLUMN "policySnapshot" JSONB;
