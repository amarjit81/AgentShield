export function verifyExecution(approvedAction, executionAction) {
  return approvedAction.amount === executionAction.amount;
}

export function verifyActor(approvedAction, executionAction) {
  return approvedAction.agent === executionAction.agent;
}
