# Part 3 — Deepanjan: Request Validation, Policy and Approvals

**Speaking time:** About 2 minutes, after authentication and agent permissions.
**Your responsibility:** Explain how a valid permitted request receives a decision
and what exactly a Manager approves.

## Content to read and explain

A refund request includes an agent ID, action REFUND, target customer, amount and
currency. Zod validates the input before business processing. The amount must be
a positive number; unsupported actions and malformed input are rejected.

After validation, the submission service checks the registered agent's ownership,
active status and REFUND permission. It locks the agent row while checking and
saving, so a concurrent agent update must wait for that transaction to finish.
Only then does the backend evaluate the refund policy.

Our policy is deterministic JavaScript: the same amount produces the same policy
decision. It does not use an LLM, OPA or Cedar.

| Amount | Decision | Initial state |
|---|---|---|
| Positive, at most INR 5,000 | ALLOW | AUTHORIZED |
| Above INR 5,000 through INR 20,000 | REQUIRE_APPROVAL | PENDING_APPROVAL |
| Above INR 20,000 | BLOCK | BLOCKED |

The backend saves the request, its policy decision and initial audit events in
one transaction. The saved decision includes its reason, limits and policy
version, preserving the original evaluation even when the request state changes.
The dashboard cannot edit these limits.

For ALLOW, the dashboard automatically calls the execution API. For
REQUIRE_APPROVAL, a Manager or Admin must review the pending request. An ordinary
User cannot approve it. BLOCK creates a saved blocked request which cannot execute.

Review locks the request and accepts a decision only while it is pending.
Approval or rejection creates one review record, updates the request state, and
records an audit event. Repeated or conflicting reviews are refused.

Approval saves the authenticated reviewer and an exact snapshot of the agent ID,
action, target, amount and currency. For example, approving an INR 8,000 refund
does not authorize an INR 80,000 refund. Execution later compares the attempted
action with this snapshot. A rejected request remains non-executable.

Approval is therefore a saved authorization for specific details. Execution is
a separate operation with further checks, including current agent access.

## Your demo moment

As User, select Demo-Refund and submit INR 8,000. Show REQUIRE_APPROVAL and
PENDING_APPROVAL. Copy the request ID and load it in the separate Manager browser
context. Approve and show the reviewer and bound amount. Leave this approved
request for Sameer's execution demonstration. Mention INR 2,000 and INR 25,000
as the allow/block examples if time permits.

## Questions to prepare for

- **Why store the approval snapshot?** To bind the review to exact action details
  and detect changes between approval and execution.
- **Does approval move money?** No. It records authorization; execution is separate,
  and the current refund tool is only a simulator.

**Code to recognize:** `actionSchema.js`, `submissionService.js`,
`policyService.js`, `actionRepository.js`, and `actionController.js`.

**Handoff:** “Sameer will show how the backend verifies this saved authorization,
rejects tampering and replay, and records execution reliably.”
