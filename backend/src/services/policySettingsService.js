import { prisma } from '../lib/prisma.js';

export const defaultRefundPolicy = {
  autoApproveLimit: 5000, maxAllowedRefund: 20000, version: 1,
  updatedByEmail: null, updatedAt: null,
};

export const defaultEmailPolicy = {
  internalDomains: ['agentshield.test'], blockedDomains: ['blocked.example'],
  externalAction: 'REQUIRE_APPROVAL', version: 1, updatedByEmail: null, updatedAt: null,
};

export const defaultSandboxPolicy = {
  allowedPaths: ['workspace/'], protectedPaths: ['workspace/protected/'],
  operationActions: { READ: 'ALLOW', WRITE: 'ALLOW', CHANGE: 'REQUIRE_APPROVAL', DELETE: 'REQUIRE_APPROVAL' },
  maxContentBytes: 8000, version: 2, updatedByEmail: null, updatedAt: null,
};

export async function readRefundPolicy(database = prisma) {
  return await database.refundPolicy.findUnique({ where: { id: 'refund' } }) || defaultRefundPolicy;
}

export async function readEmailPolicy(database = prisma) {
  return await database.emailPolicy.findUnique({ where: { id: 'email' } }) || defaultEmailPolicy;
}

export async function readSandboxPolicy(database = prisma) {
  const stored = await database.sandboxPolicy.findUnique({ where: { id: 'sandbox' } });
  if (!stored) return defaultSandboxPolicy;
  const { readAction, writeAction, changeAction, deleteAction, ...policy } = stored;
  return { ...policy, operationActions: {
    READ: readAction, WRITE: writeAction, CHANGE: changeAction, DELETE: deleteAction,
  } };
}

export async function saveRefundPolicy(settings, editorEmail) {
  try {
    return await prisma.$transaction(async transaction => {
      const current = await transaction.refundPolicy.findUnique({ where: { id: 'refund' } });
      const data = { autoApproveLimit: settings.autoApproveLimit, maxAllowedRefund: settings.maxAllowedRefund, updatedByEmail: editorEmail };
      if (!current) {
        if (settings.version !== 1) return null;
        return transaction.refundPolicy.create({ data: { id: 'refund', ...data, version: 2 } });
      }
      const updated = await transaction.refundPolicy.updateMany({
        where: { id: 'refund', version: settings.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (!updated.count) return null;
      return transaction.refundPolicy.findUnique({ where: { id: 'refund' } });
    });
  } catch (error) {
    if (error.code === 'P2002') return null;
    throw error;
  }
}

export async function saveEmailPolicy(settings, editorEmail) {
  try {
    return await prisma.$transaction(async transaction => {
      const current = await transaction.emailPolicy.findUnique({ where: { id: 'email' } });
      const data = { internalDomains: settings.internalDomains, blockedDomains: settings.blockedDomains,
        externalAction: settings.externalAction, updatedByEmail: editorEmail };
      if (!current) {
        if (settings.version !== defaultEmailPolicy.version) return null;
        return transaction.emailPolicy.create({ data: { id: 'email', ...data, version: settings.version + 1 } });
      }
      const updated = await transaction.emailPolicy.updateMany({ where: { id: 'email', version: settings.version },
        data: { ...data, version: { increment: 1 } } });
      if (!updated.count) return null;
      return transaction.emailPolicy.findUnique({ where: { id: 'email' } });
    });
  } catch (error) {
    if (error.code === 'P2002') return null;
    throw error;
  }
}

export async function saveSandboxPolicy(settings, editorEmail) {
  try {
    return await prisma.$transaction(async transaction => {
      const current = await transaction.sandboxPolicy.findUnique({ where: { id: 'sandbox' } });
      const data = { allowedPaths: settings.allowedPaths, protectedPaths: settings.protectedPaths,
        readAction: settings.operationActions.READ, writeAction: settings.operationActions.WRITE,
        changeAction: settings.operationActions.CHANGE, deleteAction: settings.operationActions.DELETE,
        maxContentBytes: settings.maxContentBytes, updatedByEmail: editorEmail };
      if (!current) {
        if (settings.version !== defaultSandboxPolicy.version) return null;
        await transaction.sandboxPolicy.create({ data: { id: 'sandbox', ...data, version: settings.version + 1 } });
        return readSandboxPolicy(transaction);
      }
      const updated = await transaction.sandboxPolicy.updateMany({ where: { id: 'sandbox', version: settings.version },
        data: { ...data, version: { increment: 1 } } });
      if (!updated.count) return null;
      return readSandboxPolicy(transaction);
    });
  } catch (error) {
    if (error.code === 'P2002') return null;
    throw error;
  }
}
