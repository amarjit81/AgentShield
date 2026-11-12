CREATE TABLE "EmailPolicy" (
    "id" TEXT NOT NULL,
    "internalDomains" TEXT[],
    "blockedDomains" TEXT[],
    "externalAction" "PolicyOutcome" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByEmail" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailPolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmailPolicy_version_check" CHECK ("version" > 0),
    CONSTRAINT "EmailPolicy_external_action_check" CHECK ("externalAction" IN ('REQUIRE_APPROVAL', 'BLOCK'))
);

CREATE TABLE "SandboxPolicy" (
    "id" TEXT NOT NULL,
    "allowedPaths" TEXT[],
    "protectedPaths" TEXT[],
    "readAction" "PolicyOutcome" NOT NULL,
    "writeAction" "PolicyOutcome" NOT NULL,
    "changeAction" "PolicyOutcome" NOT NULL,
    "deleteAction" "PolicyOutcome" NOT NULL,
    "maxContentBytes" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 2,
    "updatedByEmail" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SandboxPolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SandboxPolicy_version_check" CHECK ("version" > 0),
    CONSTRAINT "SandboxPolicy_content_check" CHECK ("maxContentBytes" BETWEEN 1 AND 8000)
);
