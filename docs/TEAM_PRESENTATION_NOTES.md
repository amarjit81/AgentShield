# AgentShield — Team Presentation Notes

This single file contains reading content for all four team members. Present in
this order: **You → Avnish → Deepanjan → Sameer**. Allow approximately 8–9 minutes,
plus time for live demo clicks. Each person should understand their section and
explain it in their own words. These are presentation responsibilities, not claims
about who originally wrote the code.

| Speaker | Part |
|---|---|
| You | Project overview, architecture and dashboard |
| Avnish | Authentication, roles and agent permissions |
| Deepanjan | Validation, policy and approvals |
| Sameer | Execution integrity, database, audit and testing |

Use separate browser contexts for User and Manager. Deepanjan creates and approves
an INR 8,000 request; Sameer uses that same request for execution demonstrations.
All refunds are simulated. No real money moves.

---

## Part 1 — You: Project Overview, Architecture and Dashboard

**Speaking time:** About 2 minutes. You open the presentation.
**Your responsibility:** Explain the problem, connect the main components, and
introduce the working interface. This is a presentation allocation, not a claim
about who originally wrote each feature.

### Content to read and explain

AgentShield is a gateway that checks agent-requested actions before they execute.
An action may be valid in format but still lack permission, exceed a policy limit,
or differ from what a person approved. Our project handles these checks in the
backend and saves the results for inspection.

We have implemented a local refund workflow in INR. A user selects a registered
agent and submits a refund. The system may allow it, require Manager/Admin review,
or block it. Execution produces a simulated receipt; no real money moves.

Our architecture has three main layers:

```text
React dashboard → Express API and business services → PostgreSQL through Prisma
```

The frontend uses React, Vite and Material UI. It collects inputs, calls the API,
and displays saved results. The backend uses Node.js, Express and Zod for routes
and validation. Separate services handle authentication, agent access, policy,
review and execution. Prisma connects those services to PostgreSQL. This keeps
the important rules on the server, where browser controls cannot bypass them.

The dashboard includes login, an agent dropdown with current status and tool
permissions, a refund amount field, saved-request lookup, policy and status panels,
review controls, simulated receipts and an audit table. Managers and Admins see
review controls; ordinary Users wait for a reviewer.

The dashboard polls the selected request every four seconds, so a Manager's review
appears in the User's window. Agent settings have a manual refresh button. After
reload, the selected request is fetched from the backend again. Local storage
holds the selected request ID per user, while the database stores the actual
request, review, receipt and audit history. Reset Demo clears the selection only.

### Your demo moment

Show the logged-in User dashboard and point out agent selection, amount, saved
status and audit. Explain the architecture before handing over; leave policy
examples and execution attacks to the later speakers.

### Questions to prepare for

- **Is this connected to a real AI agent?** The current dashboard submits requests
  using registered agent identifiers under an authenticated user session.
  Independent agent credentials and integration with other AI apps are future work.
- **Why have a backend?** It enforces permissions and rules and persists records;
  the frontend displays results and initiates requests.

**Code to recognize:** `src/App.jsx`, `src/components/`, `src/services/`,
`backend/src/app.js`, and `backend/src/routes/`.

**Handoff:** “Avnish will explain how we authenticate users and decide which
registered agents they are allowed to use.”


---

## Part 2 — Avnish: Authentication, Roles and Agent Permissions

**Speaking time:** About 2 minutes, after the project overview.
**Your responsibility:** Explain who is calling the system and whether their
agent is permitted to request a refund.

### Content to read and explain

Our authentication uses email and password. Passwords are hashed with bcrypt;
the database stores hashes rather than plaintext passwords. Accounts are created
through a trusted local command; public signup is not implemented.

On successful login, the backend creates a database session and issues a signed
JWT in an HttpOnly, SameSite=Strict cookie. Both expire after 30 minutes.
HttpOnly prevents frontend JavaScript from reading the token. Production mode
enables Secure cookies, requiring HTTPS.

We use JWT verification together with a database session check. On authenticated
requests, the backend verifies the token and loads the current session and active
user. Logout deletes the session, making the token unusable even before expiry.
Roles are read from the current database user rather than embedded in the JWT.
This allows a role change to affect subsequent requests immediately.

Mutations require a session-bound CSRF token. Login also checks the configured
origin and custom client header, and limits attempts per IP/backend process.
The JWT is not stored in local storage; the frontend keeps the CSRF token in memory.

There are three roles. A User reads and executes their own requests. Managers and
Admins can access requests across users and approve or reject pending requests.
However, every role must own the agent used to submit a new request. Review
privileges do not grant permission to submit through somebody else's agent.

Each registered agent has an ID, name, owner, active status and allowed tools.
Only REFUND is currently supported. New and migrated agents receive no automatic
tool grant. Submission requires the agent to exist, belong to the caller, be
active and explicitly allow REFUND. A failure returns a permission error before
the policy runs or a request is saved. The agent-list endpoint returns only the
logged-in account's agents, including for Managers and Admins.

Agent IDs are identifiers, not secret credentials for an independent AI process.
Registration and configuration are trusted local operator commands.

### Your demo moment

Show Demo-NoRefund: active but without REFUND permission. Submit a refund and
show the denial. Then show Demo-Disabled and its inactive-agent denial. These
are access failures, separate from the amount policy Deepanjan will explain.

### Questions to prepare for

- **Why store sessions if we use JWT?** To support immediate logout/revocation and
  current user checks; token validity alone does not grant access.
- **Can an Admin submit through anyone's agent?** No. Submission still requires
  ownership. Admin review/access privileges are separate.

**Code to recognize:** `authService.js`, `authRoutes.js`, `agentService.js`,
`agentSchema.js`, `agentRoutes.js`, `AuthGate.jsx`, and `AgentPicker.jsx`.

**Handoff:** “Once identity and agent permission are verified, Deepanjan will
explain how policy decides whether the refund needs approval.”


---

## Part 3 — Deepanjan: Request Validation, Policy and Approvals

**Speaking time:** About 2 minutes, after authentication and agent permissions.
**Your responsibility:** Explain how a valid permitted request receives a decision
and what exactly a Manager approves.

### Content to read and explain

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

### Your demo moment

As User, select Demo-Refund and submit INR 8,000. Show REQUIRE_APPROVAL and
PENDING_APPROVAL. Copy the request ID and load it in the separate Manager browser
context. Approve and show the reviewer and bound amount. Leave this approved
request for Sameer's execution demonstration. Mention INR 2,000 and INR 25,000
as the allow/block examples if time permits.

### Questions to prepare for

- **Why store the approval snapshot?** To bind the review to exact action details
  and detect changes between approval and execution.
- **Does approval move money?** No. It records authorization; execution is separate,
  and the current refund tool is only a simulator.

**Code to recognize:** `actionSchema.js`, `submissionService.js`,
`policyService.js`, `actionRepository.js`, and `actionController.js`.

**Handoff:** “Sameer will show how the backend verifies this saved authorization,
rejects tampering and replay, and records execution reliably.”


---

## Part 4 — Sameer: Execution Integrity, Storage and Verification

**Speaking time:** About 2–3 minutes. You close the presentation.
**Your responsibility:** Explain execution checks, persistence, test evidence and
the honest boundaries of the current implementation.

### Content to read and explain

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

### Your demo moment

Using Deepanjan's approved request, show tampered amount and wrong-agent denials,
then successful execution, reload and replay refusal. Point to the saved audit.
If time permits, use Demo-Revocable to show post-approval access withdrawal;
the exact commands are in the shared presentation walkthrough.

### Questions to prepare for

- **Is replay protection global?** It prevents repeated execution of the same
  request ID. A different request ID is a separate request.
- **Can a database transaction undo a real payment?** No. Our simulator has no
  external effect; a real provider would require additional recovery controls.

**Code to recognize:** `executionService.js`, `refundSimulator.js`,
`prisma/schema.prisma`, `prisma/migrations/`, and `backend/test/`.

**Closing line:** “We have demonstrated the complete refund control path—from
authenticated submission and permission checks to approval, verified execution
and persistent audit—with clear boundaries for the next stage.”
