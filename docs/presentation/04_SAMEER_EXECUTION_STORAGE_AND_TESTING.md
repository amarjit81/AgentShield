# Part 4 — Sameer: Execution Integrity, Storage and Verification

**Speaking time:** About 2–3 minutes. You close the presentation.
**Your responsibility:** Explain execution checks, persistence, test evidence and
the honest boundaries of the current implementation.

## Content to read and explain

Before execution, the backend locks the saved request and checks whether the
caller may access it. It rejects an already executed request, an unauthorized
state, or an approved request without a valid saved approval record.

It compares the attempted agent, action, target, amount and currency with the
authorized snapshot. Policy-allowed requests use their original stored details;
reviewed requests use the approval snapshot. Changing a value produces an
execution-mismatch denial and audit event, with no simulated refund.

The backend then locks and rechecks the current agent registration. The agent
must still be active, allow REFUND and belong to the original request owner,
even if a Manager executes the request. Disabling the agent or withdrawing its
permission after approval prevents execution. The approval remains saved;
restoring access permits a matching retry.

Successful execution calls a pure refund simulator, which generates a receipt
without external effects. The receipt, EXECUTED state and execution audit event
commit in one database transaction. A unique constraint permits at most one
execution record per request. Further attempts return a replay error and preserve
the original receipt. Simulator failures roll back the execution writes.

PostgreSQL stores eight models through Prisma: User, AuthSession, Agent,
ActionRequest, PolicyDecision, ApprovalRecord, ExecutionRecord and AuditEvent.
Each request has one policy decision, at most one review and execution, and many
audit events. Five additive migrations define the current schema. Reloading the
dashboard retrieves persistent records rather than reconstructing them in memory.

Verification passed 97 backend tests using Vitest and Supertest, plus the frontend
production build. Chrome checks covered separate User/Manager sessions, approval,
tampering, replay, permission withdrawal/restoration, reload and policy outcomes.
Database checks confirmed saved status and receipt counts. Tests used disposable
PGlite; ordinary PostgreSQL multi-connection lock competition remains untested.

This is a working local refund simulator. Real payments, independent agent
credentials, email/file tools, approval expiry/revocation, AI classification,
audit search and production deployment remain future work. Audit is append-only
through the API, not tamper-proof against database administrators. Real external
tools would need their own idempotency and recovery design.

## Your demo moment

Using Deepanjan's approved request, show tampered amount and wrong-agent denials,
then successful execution, reload and replay refusal. Point to the saved audit.
If time permits, use Demo-Revocable to show post-approval access withdrawal;
the exact commands are in the shared presentation walkthrough.

## Questions to prepare for

- **Is replay protection global?** It prevents repeated execution of the same
  request ID. A different request ID is a separate request.
- **Can a database transaction undo a real payment?** No. Our simulator has no
  external effect; a real provider would require additional recovery controls.

**Code to recognize:** `executionService.js`, `refundSimulator.js`,
`prisma/schema.prisma`, `prisma/migrations/`, and `backend/test/`.

**Closing line:** “We have demonstrated the complete refund control path—from
authenticated submission and permission checks to approval, verified execution
and persistent audit—with clear boundaries for the next stage.”
