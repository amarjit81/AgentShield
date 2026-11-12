-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('REFUND');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('AUTHORIZED', 'PENDING_APPROVAL', 'BLOCKED', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "PolicyOutcome" AS ENUM ('ALLOW', 'REQUIRE_APPROVAL', 'BLOCK');

-- CreateTable
CREATE TABLE "ActionRequest" (
    "id" UUID NOT NULL,
    "agentId" TEXT NOT NULL,
    "action" "ActionType" NOT NULL,
    "target" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "status" "ActionStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDecision" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "decision" "PolicyOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "autoApproveLimit" INTEGER NOT NULL,
    "maxAllowedRefund" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionRequest_agentId_createdAt_idx" ON "ActionRequest"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "ActionRequest_status_createdAt_idx" ON "ActionRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDecision_requestId_key" ON "PolicyDecision"("requestId");

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ActionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
