CREATE TABLE "RefundPolicy" (
    "id" TEXT NOT NULL,
    "autoApproveLimit" INTEGER NOT NULL,
    "maxAllowedRefund" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByEmail" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RefundPolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RefundPolicy_limits_check" CHECK (
      "autoApproveLimit" >= 0 AND "maxAllowedRefund" > 0
      AND "autoApproveLimit" <= "maxAllowedRefund"
      AND "maxAllowedRefund" <= 1000000000
    )
);
