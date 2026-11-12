# AgentShield Living Implementation Guide

This is the current technical record. It describes working code separately from
future work. Entries in the implementation history describe earlier snapshots.

## 1. Purpose and boundaries

AgentShield checks AI-agent action requests before a controlled tool executes.
The action that executes must match the action authorized by policy or approval.

Current refund flow:

```text
Submit refund -> validate -> check active owned agent with REFUND permission
  -> read current refund limits -> evaluate policy -> save request and decision
  BLOCK -> no execution
  REQUIRE_APPROVAL -> save APPROVE/REJECT review and action snapshot
  ALLOW or APPROVED -> compare execution details -> recheck current agent access
                    -> create simulated receipt
                    -> save EXECUTED status and audit event
```

Refunds are simulated: no bank account, payment provider, or real money is used.
Email simulation is also implemented: one recipient and a plain-text subject/body,
with OPA domain rules, human review, exact-content checks, and a nondelivery receipt.
Optional SMTP delivery now sends real emails to valid addresses under the OPA
domain policy; external addresses require Manager/Admin approval.
New requests save their mode and sender; existing requests stay simulated. SMTP
uses a durable one-attempt reservation and never automatically retries uncertain sends.
Sandbox Files now performs real READ/WRITE/CHANGE/DELETE operations inside the ignored
backend/demo-workspace directory. Paths are restricted to workspace/ by OPA,
with workspace/protected/ blocked. CHANGE and DELETE require review and a current
file preview.
User, Manager, and Admin accounts now authenticate before using the API. Users
can access their own requests; Managers and Admins can access all requests and
review them. A local Agent registry now links unique agent IDs to existing users.
Refund submission now checks that the registered agent is active and owned by
the logged-in caller and has REFUND permission. Execution repeats those checks
against the original request owner. Audit search and optional ambiguous-risk
classification remain planned.
It does not intercept existing Codex/Claude/Gemini apps or OS calls. MCP,
production payments, unrestricted files, and production-scale hardening remain
outside this classroom MVP.

## 2. Current stack

- React 19, Vite, JavaScript, Material UI: dashboard and API integration.
- Node.js, Express 5, Zod 4: JSON API and validation.
- PostgreSQL and Prisma 6.12: requests, policy decisions, reviews, executions,
  audit events, users, sessions, registered agents, and current refund settings. The Prisma CLI and client
  remain pinned to matching versions.
- OPA: embedded Rego policy evaluation using @open-policy-agent/opa-wasm 1.10.0.
- Vitest and Supertest: integration, policy, SMTP, sandbox and local setup tests.
  Section 12 distinguishes completed checks from interrupted runs.
- jsonwebtoken, bcryptjs, cookie-parser, express-rate-limit: JWT cookies,
  bcrypt password hashing, cookie parsing, and bounded login attempts.
- REST polling every four seconds: implemented for the selected request and the
  Manager/Admin pending-request queue.
- Nodemailer 10.1.7: optional authenticated SMTP delivery with verified TLS.
- Vercel Vite hosting plus one Node.js Function: public classroom deployment;
  Neon PostgreSQL supplies the hosted database through `DATABASE_URL`.
- Docker Compose and optional AI provider: planned.

OPA is selected and integrated for refund amounts, email recipient domains, and
sandbox hard boundaries/outcomes. The Rego rules run as
WebAssembly inside Node.js; there is no separate OPA HTTP service. Cedar is not
integrated. The planning-v1 document requires a deterministic engine. Optional AI must never
replace critical identity, permission, amount, or execution-integrity rules.

## 3. Files and responsibilities

```text
scripts/demo-supervisor.js      Local demo service monitor; starts stopped DB/API/Vite processes
api/index.js                    Vercel entry point; exports the existing Express app
vercel.json                    Installs both packages, generates Prisma, includes policies, routes UI/API
src/
  App.jsx                         Dashboard, submission, review, execution, polling
  main.jsx                        React entry point
  styles.css                      Global styles
  services/actions.js             Create/get/review/execute/audit HTTP helpers
  services/agents.js              Fetch owned agents; response and session checks
  components/AgentPicker.jsx      Owned-agent selection, refresh and empty/error states
  components/PendingRequests.jsx Manager queue, polling and row selection
  components/PolicySettings.jsx   Manager refund-limit editing, save/reload and validation
  components/EmailPolicySettings.jsx Manager email-domain policy editor
  components/SandboxPolicySettings.jsx Manager sandbox path/operation policy editor
  components/EmailFields.jsx      Recipient, subject, and plain-text body inputs
  components/SandboxFields.jsx    Logical path, operation and plain-text write content
  components/DomainSelector.jsx   Accessible Refunds, Email and Sandbox Files domain cards
  components/ActionDetails.jsx    Safe text rendering of refund/email review details
  components/ExecutionReceipt.jsx Simulation, SMTP acceptance, and uncertain-attempt display
  services/policySettings.js      Policy settings API requests and CSRF
  services/auth.js                Login/session/logout helpers; CSRF token in memory
  components/AuthGate.jsx         Login form, session recovery, logout, expiry handling
  services/policy.js              Legacy demonstration helpers; unused by dashboard
backend/
  package.json                    Backend commands and dependencies
  .env.example                    DATABASE_URL example; real .env is ignored
  prisma/schema.prisma            Database blueprint
  prisma/migrations/              Schema history, including all three policy-setting tables
  test/actions.test.js            API/database integration tests
  test/agents.test.js             Registration, constraints, validation, and CLI tests
  test/permissions.test.js        Permissions, execution rechecks, listing and demo tests
  test/policy.test.js             Real OPA boundaries, invalid inputs and asset checks
  test/emailPolicy.test.js        Email domains, block precedence and normalization
  test/email.test.js              Email API permissions, reviews, integrity and replay
  test/emailDelivery.test.js      SMTP configuration, reservation, rejection, race, and failure tests
  test/emailSetup.test.js         Windows setup helper with disposable files and dummy secrets
  test/sandboxPolicy.test.js      Path validation, real OPA rules and dry-run receipts
  test/sandbox.test.js            Sandbox API, permissions, approval, tamper and replay tests
  test/sandboxFileTool.test.js    Direct real-file create/read/delete and path denial tests
  test/reliability.test.js        Mocked database outage response without a database
  scripts/check-local-database.js Read-only query used by the local demo monitor
  policies/sandbox.rego           Workspace boundaries and delete-approval policy
  policies/sandbox.wasm           Compiled sandbox policy with checked manifest
  policies/email.rego             OPA internal/external/blocked recipient rules
  policies/email.wasm             Compiled email policy
  policies/email.manifest.json    Email compiler revision and asset fingerprints
  policies/email-settings.json    Legacy default reference; runtime settings now use the database
  policies/refund.rego            Authoritative refund rules in Rego
  policies/refund.wasm            Compiled OPA policy, shipped with the backend
  policies/refund.manifest.json   Compiler, entrypoint, revision and asset fingerprints
  src/server.js                   Starts Express on PORT, default 3000
  src/app.js                      JSON parser, action router, generic error handling
  src/routes/actionRoutes.js      Action APIs including manager pending queue
  src/routes/policyRoutes.js      Manager-only policy settings reads and edits
  src/routes/authRoutes.js        Login, current session, logout and login rate limit
  src/schemas/authSchema.js       Email/password/account validation
  src/services/authService.js     JWT/session verification, CSRF and role middleware
  scripts/create-user.js          Local account provisioning with explicit roles
  scripts/register-agent.js       Local registration command; arguments and exit codes
  scripts/configure-agent.js      Local status and explicit tool-grant update
  scripts/setup-demo.js           Read passwords from stdin and provision demo fixtures
  scripts/setup-demo.ps1          Hidden password prompts for demo setup
  scripts/configure-gmail.ps1     Hidden app-password prompt and local .env email setup
  scripts/verify-email.js         SMTP TLS/auth check without sending a message
  scripts/start-local-database.js Cached local database launcher and keep-alive
  scripts/build-policy.js         Strict-check and compile all three policies using OPA 1.21.1
  src/services/demoService.js     Repeatable transactional fixtures; collision protection
  src/routes/agentRoutes.js       Authenticated GET of caller-owned agents
  src/schemas/agentSchema.js      Agent ID/name/owner-email/status validation
  src/services/agentService.js    Register/configure/list agents; shared lock/access checks
  src/services/submissionService.js Transactional agent check, policy, and request save
  src/schemas/actionSchema.js     Create, UUID, review, execution, audit validation
  src/schemas/emailSchema.js      Single-recipient and exact plain-text message schema
  src/schemas/sandboxSchema.js    Strict portable logical paths and operation schemas
  src/schemas/policySettingsSchema.js Strict editable policy-setting validation
  src/controllers/actionController.js  Validates and coordinates HTTP responses
  src/repositories/actionRepository.js Request, review, and audit persistence
  src/services/policyService.js   Input guards and OPA decision-to-status adapter
  src/services/opaPolicy.js       Checked Wasm loading and fail-closed OPA evaluation
  src/services/policySettingsService.js Read/save current versioned settings for all domains
  src/services/executionService.js Row locking, snapshots, verification, execution
  src/services/refundSimulator.js Pure simulated receipt creation
  src/services/emailPolicyService.js Validated settings and OPA email decision mapping
  src/services/emailSimulator.js  Nondelivery receipt; no mail transport
  src/services/sandboxPolicyService.js Validates sandbox inputs; maps OPA decisions
  src/services/sandboxSimulator.js Earlier pure dry-run helper, retained for policy tests
  src/services/sandboxFileTool.js Contained filesystem path checks and real file operations
  src/services/sandboxDispatchService.js One-attempt file dispatch and saved outcome
  src/services/emailDelivery.js   SMTP settings, safe metadata, recipient checks, TLS transport
  src/services/emailDispatchService.js One-attempt dispatch and persisted provider outcome
  src/lib/prisma.js               Shared Prisma client and dotenv loading
```

README describes run commands. This guide is updated with implementation changes.
The earlier folder walkthrough remains available; no new study notes are part
of the execution slice.

## 4. Refund policy

`backend/policies/refund.rego` evaluates deterministic refund rules through OPA.
Defaults are an auto-approve limit of 5000 and maximum of 20000. Managers/Admins
can change these for new requests in Customize refund policy. With default limits:

| Amount | Decision | Stored initial status |
|---|---|---|
| Positive and at most INR 5,000 | ALLOW | AUTHORIZED |
| Above INR 5,000 through INR 20,000 | REQUIRE_APPROVAL | PENDING_APPROVAL |
| Above INR 20,000 | BLOCK | BLOCKED |

policySettingsService.js reads the singleton RefundPolicy row, falling back to
the defaults and version 1 if none has been saved. submitActionRequest reads it
inside the same transaction that checks agent access and saves the action.
evaluateRefundPolicy(amount, limits) returns the outcome, exact limits, and
opa-refund-r1-vN version for new requests (N is the saved settings version).
Older refund-vN decisions remain valid historical snapshots. The stored PolicyDecision retains its original outcome,
limits, reason, and version even after settings or request status change. AUTHORIZED is our
implemented name for the policy-allowed state.

The first saved settings become version 2; each later save increments the version.
Policy changes do not re-evaluate pending or approved requests. The manager must
review each pending request against its saved policy; changing limits does not
approve it automatically. Execution retains the original authorization checks.

### Embedded OPA flow and failure handling

policyService.js loads the compiled policy once, before Express starts. It keeps
the existing synchronous evaluateRefundPolicy(amount, limits) interface, so the
submission transaction still checks the registered agent first, reads current
database limits, evaluates OPA, and saves all records together. Only amount,
REFUND, INR, and the two limits are passed to OPA; passwords and session tokens
are never policy inputs. Ownership, tool grants, role permissions, CSRF, review
snapshots, and execution integrity remain enforced by the existing backend code.
This is a deterministic policy decision component, not an LLM or independently
authenticated agent process. The unused frontend demonstration helper does not
authorize API requests.

loadRefundEvaluator in opaPolicy.js checks SHA-256 fingerprints of the Rego source
and Wasm against refund.manifest.json, verifies the entrypoint, and loads the
official OPA SDK. Source hashing normalizes Windows line endings. These checks
detect stale or damaged assets; they are not signed-policy verification against
an attacker who can replace every file. Missing/mismatched assets stop backend
startup. Rego defaults to BLOCK for unsupported/malformed input. The adapter
rejects nonpositive/nonfinite amounts and invalid limits/settings versions. The
engine must produce exactly one known decision. Engine errors or invalid output
raise PolicyUnavailableError; the API returns HTTP 503 POLICY_UNAVAILABLE and
the transaction saves no request, decision, execution, or request audit events.
There is no fallback to the previous JavaScript threshold implementation.

The adapter maps ALLOW to AUTHORIZED, REQUIRE_APPROVAL to PENDING_APPROVAL,
and BLOCK to BLOCKED with the existing explanation text. New POLICY_EVALUATED
audit details also include policyEngine=opa and policyDigest (the compiled Wasm
SHA-256), letting a reviewer identify the compiled policy used for that request.
Existing decisions and pending approvals are not recalculated. No schema migration
is needed: the existing version string and audit JSON hold this information.

Normal setup is `npm install` inside backend, then `npm run dev`: the committed
Wasm and manifest are sufficient; no compiler or OPA server is needed to run.
For rule edits, install the official OPA 1.21.1 CLI, make `opa` available on PATH
(or set OPA_BINARY to its absolute executable path), then run
`npm run policy:build` inside backend and restart Express. The build script
requires that compiler version, strict-checks the Rego, compiles the decision
entrypoint, extracts the Wasm with `tar`, and regenerates the manifest. Commit
source, Wasm, and manifest together. Initial rule revision is r1; a later rule
revision must update the build manifest revision and supported loader revision
together. Settings changes only advance the database settings version.
`npm run test:policy` checks OPA without any database. The full integration suite
still requires an explicitly marked isolated database, as explained in section 11.

### Email scope: SEND_EMAIL

Email requests use the same authenticated `/api/actions` endpoints and approval
queue as refunds. `actionRequestSchema` and `executionSchema` select a strict
email schema when action is SEND_EMAIL. Example:

```json
{
  "agentId": "Demo-Email",
  "action": "SEND_EMAIL",
  "target": "customer@example.com",
  "arguments": { "subject": "Project update", "body": "The update is ready.\nPlease review." }
}
```

The recipient is a single valid email address, trimmed and lowercased. The subject
is 1–200 characters, nonblank, with no control characters. The body is nonblank
plain text limited to 8,000 UTF-8 bytes. Tabs and line breaks are allowed in the
body; other control characters are rejected. Subject/body whitespace is preserved
so reviewers see the content execution must match. Extra fields, attachments,
CC/BCC, recipient arrays, and multiple addresses are rejected with HTTP 400.
The JSON parser also returns 413 REQUEST_TOO_LARGE above 16 KB.

An active owned agent must have SEND_EMAIL permission at submission and again at
execution. REFUND permission alone does not grant email permission. Both scopes
can be granted explicitly with `REFUND,SEND_EMAIL`; duplicate grants are invalid.
Existing agents retain their current grants. demo:setup now includes Demo-Email,
owned by the demo USER, in addition to the four refund demonstration agents.

Email settings are read transactionally from the EmailPolicy table. When there
is no saved row, defaults are internalDomains=[agentshield.test],
blockedDomains=[blocked.example], externalAction=REQUIRE_APPROVAL, and version 1.
Exact domains and their subdomains match;
lookalikes such as notagentshield.test or agentshield.test.evil.example do not.
Blocked domains take precedence even if also listed as internal:

| Recipient | Decision | Initial status |
|---|---|---|
| colleague@agentshield.test | ALLOW | AUTHORIZED |
| customer@example.com | REQUIRE_APPROVAL | PENDING_APPROVAL |
| recipient@blocked.example | BLOCK | BLOCKED |

Managers/Admins change these settings in Customize email policy. Each domain is
a lowercase exact domain without a wildcard or URL; a subdomain inherits its
parent rule. The external action may be REQUIRE_APPROVAL or BLOCK, never automatic
ALLOW. Saving uses optimistic version matching, records the editor email, and
increments the version. No restart or Rego rebuild is needed for settings changes.
Rule changes still need `npm run policy:build`. The
shared loadPolicyEvaluator checks fingerprints and exact entrypoints; its
loadRefundEvaluator wrapper preserves the existing refund integration. Email
decisions use opa-email-r1-vN and record the engine and compiled digest in audit.
Missing/broken policy assets stop startup; invalid stored settings fail closed
during evaluation. Evaluation errors
return 503 POLICY_UNAVAILABLE with no partially saved request.

submitActionRequest checks the relevant permission, then reads the current settings
inside the same transaction that saves the request. Email evaluation receives
only the action, recipient domain, and validated settings; subject/body are
validated but not inspected by OPA.
This first slice has no content classification, malware scanning, or DLP claim.
Each decision saves a copy of its settings in policySnapshot. Changing settings
does not reinterpret existing approvals or authorizations.

Managers/Admins review the full recipient, subject, and body. A saved approval
binds the complete action. executeAction compares the complete arguments object
(including exact subject/body strings), target, action type, and agent ID, then
rechecks the current grant. Mismatches return 409 EXECUTION_MISMATCH; withdrawn
grants return 403 TOOL_NOT_ALLOWED. Shared row locks and the unique execution
record prevent replay. In SIMULATED mode, a successful execution writes EMAIL_SIMULATED,
not a delivered/sent event. Its receipt contains messageId, recipient, subject,
body, simulator=SEND_EMAIL, simulated=true, and delivered=false. No SMTP/provider
call is made. Failed simulations roll back the receipt and preserve authorization
for retry, with a separate EXECUTION_FAILED audit event when storage is available.

The dashboard has an Action scope selector, a scope-aware agent picker, and email
fields. Allowed emails in simulation mode execute automatically after submission. External
emails appear alongside refunds in the manager queue, with an action label and
subject. Review and saved-snapshot panels render message text safely as React
text, preserving line breaks; messages are never inserted as HTML. Receipts
explicitly state that nothing was delivered. Bodies are stored in the database,
approval snapshots, receipts, and applicable audit details, so use demo text.

### Optional real email delivery: SMTP

`EMAIL_DELIVERY_MODE` is SIMULATED by default. SMTP enables real delivery for new
email requests only. `emailDelivery.js` validates SMTP_HOST, SMTP_PORT (465 or 587),
SMTP_USER, SMTP_PASSWORD, and SMTP_FROM. EMAIL_ALLOWED_RECIPIENTS is now an optional
list of up to 10 valid addresses used only for dashboard demo shortcuts. It does
not limit delivery. Missing/invalid SMTP configuration returns 503
EMAIL_NOT_CONFIGURED, never a silent fallback to simulation. Email syntax is
validated on submission; OPA blocks configured domains and requires Manager/Admin
approval for external domains. Any valid external address outside the blocked
domains can be sent after that approval.

`submitActionRequest` saves executionMode and emailSender with the request after
agent checks and before policy persistence. Refunds always use SIMULATED. The
creation response, saved request, and manager queue expose these nonsecret fields.
For SMTP requests `actionSnapshot` also includes mode/sender, so human approval
clearly covers a real message from that sender. The frontend displays those fields
on the original and reviewed action. SMTP mode/sender cannot be supplied by clients.

`executeAction` performs the existing auth, review, content, and current agent
checks, then validates the current SMTP config and saved sender.
Changing mode/sender returns 409 EMAIL_CONFIGURATION_CHANGED. Restoring the original
configuration permits a fresh attempt if none was reserved. Configuring SMTP later
cannot turn old simulated requests into real sends.

SMTP needs two transactions because a database rollback cannot unsend a message:

1. Under the existing request/agent locks, save one ExecutionRecord containing
   transport=SMTP, simulated=false, delivered=null, deliveryStatus=DISPATCHING,
   sender, recipient, exact subject/body, and a stable Message-ID derived from the
   request UUID and sender domain. Append EMAIL_DISPATCH_RESERVED and commit.
2. Only the caller that committed this reservation calls `dispatchReservedEmail`.
   It sends outside the database transaction through `sendSmtpEmail`. The message
   uses only the saved authorized values; there are no attachments or HTML fields.
3. If SMTP accepts the recipient, save deliveryStatus=ACCEPTED and acceptedAt,
   change request status to EXECUTED, and append EMAIL_ACCEPTED in a transaction.
   HTTP 200 means provider acceptance, not proven inbox delivery. delivered remains
   null: there are no bounce callbacks or delivered/read tracking.
4. An SMTP failure, recipient rejection, or timeout saves UNKNOWN, changes the
   request to FAILED, appends EMAIL_DELIVERY_UNKNOWN, and returns HTTP 502. Raw SMTP
   errors are not logged or returned because they can contain private details.
5. If outcome persistence fails, return 503 EMAIL_OUTCOME_UNKNOWN and preserve
   DISPATCHING. A process crash can leave the same reserved state. Refreshing GET
   shows the saved receipt. Check the sender account/provider manually.

The existing unique ExecutionRecord and request lock allow only one attempt per
request, including competing calls from other backend processes. Subsequent calls
return 409 EMAIL_ATTEMPT_EXISTS for uncertain/in-progress attempts, or REPLAY_DETECTED
after acceptance. No automatic retry, background sender, or reservation expiry exists.
This deliberately favors preventing duplicate attempts over guaranteed delivery:
a crash after reservation but before SMTP may lose the send. A timeout after SMTP
acceptance may still deliver. Message-ID supports correlation, not SMTP deduplication.
An independent new request can send the same content again, so investigate an
uncertain attempt before creating another. Agent checks occur at reservation;
permission changes afterward cannot recall an already reserved/in-flight message.

`createEmailTransport` uses Nodemailer with certificate verification, TLS 1.2 or
later, immediate TLS on 465 or required STARTTLS on 587, explicit SMTP envelope,
bounded connection/DNS/idle timeouts, and disabled SMTP logging and file/URL access.
Credentials stay in backend/.env and never enter database receipts, snapshots,
audits, or safe configuration metadata. The authenticated GET
`/api/actions/email-delivery` returns mode, ready, from, and allowedRecipients only;
allowedRecipients are optional UI shortcuts, not an enforcement list.
An incomplete configuration returns ready=false so the dashboard disables email
submission and explains setup. It polls this endpoint every four seconds and cleans
up requests/timers on logout. A configuration read failure also disables submission.

For Gmail, enable 2-Step Verification and create an app password, then run
`.\scripts\configure-gmail.ps1` from backend. The helper prompts for two plain
email addresses and a hidden app password, strips password grouping whitespace,
requires 16 letters, replaces only email setting lines, and preserves existing
database/JWT settings. It requires an existing .env and writes UTF-8 without BOM.
It never prints the password or sends email. Normal Google login passwords and
ChatGPT's connected Gmail do not configure this SMTP transport. See
https://support.google.com/accounts/answer/185833 and https://nodemailer.com/smtp.

`npm run email:verify` checks configuration, TLS, and authentication without sending.
It returns exit 0 on success or a generic exit-1 error without provider details.
Verification cannot prove the sender will be accepted or the email will reach an inbox.
Restart the backend after changing .env. Select Email, enter a configured inbox,
and submit. Manager/Admin approval of an external-domain SMTP request now calls
executeAction immediately after the approval commits. The review HTTP response
waits for SMTP and reports EXECUTED on acceptance, 502 for an uncertain attempt,
or a denial if the current grant/configuration changed. Approval remains saved
even if dispatch fails. The durable reservation prevents a second send from the
User window. Policy-allowed SMTP requests still use the explicit dashboard send
button. Simulation keeps its previous auto-execution behavior.
ExecutionReceipt distinguishes simulated, accepted, and uncertain outcomes without
claiming that SMTP acceptance proves delivery. Bodies and test messages are still
stored in requests/reviews/receipts, so use demonstration content.

### Sandbox-file scope: SANDBOX_FILE

This scope performs real file operations in backend/demo-workspace locally, a dedicated
ignored directory. On Vercel it uses `/tmp/agentshield-demo-workspace` because the
deployed function bundle is read-only. WRITE creates a new file and refuses to overwrite an existing
file; READ returns its actual plain-text contents; CHANGE replaces an existing
file; DELETE removes an existing file. The default policy allows READ/WRITE and
requires Manager/Admin approval for CHANGE/DELETE, while editable settings can
allow, review, or block each operation. Logical workspace/notes.txt maps only to
backend/demo-workspace/notes.txt. Nested paths are supported. No arbitrary OS
path can be supplied through the API.

The same `/api/actions` submission, retrieval, review, execution, and audit routes
accept this strict JSON shape:

```json
{
  "agentId": "Demo-Sandbox",
  "action": "SANDBOX_FILE",
  "target": "workspace/notes.txt",
  "arguments": { "operation": "WRITE", "content": "Demo text.\nSecond line." }
}
```

READ and DELETE arguments contain only `operation`; WRITE and CHANGE require a string
`content`, which may be empty. Extra keys are rejected. Plain-text content is
hard-limited to 8,000 UTF-8 bytes, preserving spaces, tabs and line breaks. The
current policy may set a smaller 1–8,000 byte limit for new WRITE/CHANGE requests;
requests above that configured limit are saved as BLOCKED. Other ASCII
control characters are rejected. The existing 16 KB JSON-body limit also applies.
Content is stored in request arguments, approval snapshots and execution/audit
receipts, so use demonstration text.

sandboxPathSchema accepts 1–240 characters, lowercase letters, numbers,
underscores, hyphens, filename dots and forward-slash separators. Each segment
starts with a letter or number. It rejects empty/dot segments, hidden filenames,
absolute/drive/UNC paths, backslashes, percent escapes, colons, whitespace and
control characters. Paths are neither trimmed nor normalized. Invalid shapes
return 400 INVALID_ACTION_REQUEST (or INVALID_EXECUTION_REQUEST) before saving.
The same portable logical namespace is mapped beneath the fixed demo directory.

`evaluateSandboxPolicy` runs checked OPA Wasm, with the same source/asset integrity
and fail-closed behavior as the other policies. OPA always enforces the permanent
workspace/ boundary and workspace/protected/ block. The versioned database settings
can only narrow paths inside that boundary, select ALLOW/REQUIRE_APPROVAL/BLOCK for
each operation, and limit WRITE/CHANGE content bytes. Content is counted but not
classified. Default rules are:

| Target and operation | Decision |
|---|---|
| READ or WRITE under workspace/ | ALLOW |
| CHANGE or DELETE under workspace/ | REQUIRE_APPROVAL |
| workspace/protected itself or any descendant, any operation | BLOCK |
| Any other valid logical path | BLOCK |

For example, workspace/protected-copy.txt remains allowed; workspace-evil/a.txt
does not match workspace/. Malformed or unknown OPA input defaults to BLOCK.
New decisions save `opa-sandbox-r1-vN`, policy engine/digest audit metadata, and an
independent settings snapshot containing allowedPaths, protectedPaths,
operationActions, maxContentBytes and version. Rules are compiled into sandbox.wasm with
sandbox.manifest.json; `npm run policy:build` now builds all three policies using
the existing pinned OPA compiler. Startup refuses missing or mismatched assets.
Evaluation errors return 503 POLICY_UNAVAILABLE with no partially saved request.

Managers/Admins edit the sandbox settings in the dashboard. Folder prefixes must
start with workspace/ and end with `/`; there is at least one allowed prefix and
up to 100 allowed and 100 additional protected prefixes. Saving uses optimistic
version matching and records the editor email. Settings apply only to new requests;
the saved PolicyDecision snapshot preserves the earlier meaning. Even an ALLOW
selection cannot bypass the permanent root/protected boundary or portable path
schema. Invalid stored settings fail closed.

The agent needs explicit SANDBOX_FILE permission at submission and execution;
REFUND or SEND_EMAIL grants do not imply file permission. The existing request
lock, owner checks, approval snapshot comparison and current-agent checks apply.
Changing the path, operation, proposed content, agent or action produces
409 EXECUTION_MISMATCH for otherwise valid execution input. Pending, blocked and
rejected requests cannot execute. Permission withdrawal prevents execution even
after approval. One request can commit only one execution receipt; concurrent or
repeat attempts are refused. Different request IDs can address the same demo file;
WRITE will fail if the file already exists.

Manager/Admin can GET `/:id/file-preview` only for a pending CHANGE or DELETE.
It returns the current file text, byte count and SHA-256 digest, never arbitrary
filesystem paths. ActionDetails labels WRITE content as proposed new file content
and CHANGE content as proposed replacement content. The Manager UI separately
labels the current file contents before approval, so the two values are not
mistaken for each other, and disables Approve until a preview loads. Approval sends the digest;
the backend rereads the file and refuses approval with FILE_PREVIEW_CHANGED if it
is missing or different. The approved digest is saved in the snapshot. Execution
checks the digest again before CHANGE or DELETE, so a file altered after approval
fails instead of silently applying an outdated decision. The Manager can refresh
the preview and approve a still-pending request. Files over 8,000 bytes cannot be
previewed or approved through this demo flow. Previously approved DELETE requests
without a saved preview are refused with FILE_PREVIEW_REQUIRED; create a new
request and review its current file.

`sandboxFileTool` validates the action again, checks the logical path and each
physical parent, and refuses symlinks or non-directory parents. WRITE uses
exclusive creation; READ only opens regular files with an 8,000-byte limit;
CHANGE writes replacement text to an existing regular file after checking its
approved digest; DELETE only unlinks a regular file after the same check.
`sandboxDispatchService` saves one execution
reservation before the OS operation, then saves the real receipt and
SANDBOX_FILE_EXECUTED audit event. A failure saves FAILED and
SANDBOX_FILE_FAILED. Because a database rollback cannot undo a filesystem
change, reserved operations never auto-retry. If storage fails after disk work,
the receipt remains reserved; inspect the demo directory before a new request.
The retained sandboxSimulator helper is no longer used by the action executor.

The dashboard shows the actual READ content in the receipt and labels real
operations honestly. Auto-authorized READ/WRITE requests execute after submission;
CHANGE/DELETE wait for human review and an execution click. Demo files remain on disk
until deleted through the app or manually by the operator. No SMTP configuration
is needed for this scope.

Hosted sandbox files are intentionally ephemeral: Vercel may reuse `/tmp` briefly,
but another function instance, scale-to-zero event, or deployment may not contain
the earlier file. PostgreSQL request, approval, execution and audit rows remain
durable. The hosted classroom demo must not claim durable file storage.

Apply migrations and regenerate Prisma Client from backend before running:

```bash
npm run prisma:generate
npx prisma migrate deploy
npm run agent:register -- Demo-Sandbox "Sandbox File Agent" user@agentshield.test active SANDBOX_FILE
```

Use an existing owner's email. Duplicate registration does not overwrite an
agent; use `npm run agent:configure -- Demo-Sandbox active SANDBOX_FILE` to update
an existing one. Comma-separated grants can explicitly permit all three scopes.
`demo:setup` now includes Demo-Sandbox among its six agents, but existing accounts
and agents are never implicitly granted file access by a schema migration.

## 5. Database models and migration

Migration `20261021120000_sandbox_scope` adds SANDBOX_FILE to ActionType only.
Existing requests, permissions and records are unchanged. There is no file table:
the request and receipt live in the database, while real demo files live in the
ignored backend/demo-workspace directory.

Migration `20261020120000_smtp_delivery` adds executionMode (default SIMULATED)
and nullable emailSender to ActionRequest. A database check allows only SIMULATED
or SMTP and requires SMTP actions to be SEND_EMAIL with a saved sender. Existing
requests retain SIMULATED; enabling SMTP never converts a historical authorization
into permission to send a real message. Regenerate Prisma Client and run
`npx prisma migrate deploy` before using this version.

Migration `20261012110000_email_scope` adds SEND_EMAIL to ActionType, makes the
two refund-only PolicyDecision columns nullable, and adds nullable JSONB
policySnapshot. New refund/email decisions both save their full settings there;
refunds also keep their original limit columns. GET falls back to those columns
for historical rows with no JSON snapshot. Existing records are not rewritten,
and existing agents are not automatically granted SEND_EMAIL. Regenerate Prisma
Client and run `npx prisma migrate deploy` inside backend before starting this version.

- ActionRequest: UUID, agentId, action REFUND, SEND_EMAIL or SANDBOX_FILE, target, JSON arguments, current
  status, nullable ownerId, createdAt and updatedAt. Indexed by owner, agent/time
  and status/time. New API requests always use the authenticated user's ownerId.
- PolicyDecision: one per request, policy outcome, reason, version, and limits.
- RefundPolicy: one row with ID refund, integer autoApproveLimit and
  maxAllowedRefund, version, updatedByEmail, and updatedAt. It contains the current
  settings; historical versions are preserved on individual PolicyDecision rows,
  not in a separate full configuration-edit history. Migration
  20261011170000_refund_policy_settings adds this table without changing records.
  Its check constraint enforces nonnegative auto limit, positive maximum,
  auto limit <= maximum, and maximum <= 1,000,000,000.
- EmailPolicy: one row with ID email, internalDomains and blockedDomains arrays,
  externalAction, version, editor email and update time. The database constraint
  limits externalAction to REQUIRE_APPROVAL or BLOCK; API validation supplies the
  domain syntax and uniqueness checks.
- SandboxPolicy: one row with ID sandbox, allowed/protected path arrays, one
  PolicyOutcome for each file operation, maxContentBytes, version, editor email
  and update time. The database constrains the byte limit to 1–8,000; the API
  validates safe workspace/ prefixes and complete operation settings.
- ApprovalRecord: one review per request, APPROVE or REJECT, a JSON snapshot of
  agentId/action/target/arguments, reviewerId, and timestamp. New reviews always
  store the authenticated reviewer. Historical reviews retain null reviewerId.
- ExecutionRecord: one per request, UUID, JSON simulation receipt or durable SMTP
  attempt/outcome, and timestamp.
  The unique requestId is a second defense against duplicate execution.
- AuditEvent: increasing integer ID, requestId, event, status, reason, JSON
  details, timestamp. Indexed by requestId and ID for stable pagination.
- Agent: unique case-sensitive string ID, display name, required ownerId, active
  flag, allowedTools ActionType array, createdAt and updatedAt. User.agents is the
  reverse ownership relationship. REFUND, SEND_EMAIL and SANDBOX_FILE are supported; the default is [].
  IDs are chosen during registration so familiar IDs such as SupportAgent-01 can
  be used. They are identifiers, not passwords or authentication credentials.

Migration `20261009170000_refund_execution` adds the three new tables and their
foreign keys/indexes. It does not delete or rewrite existing requests. UUIDs
are generated by Prisma. Audit IDs use a PostgreSQL sequence; gaps are normal.
Relationships cascade on request deletion. The API exposes no delete operation.

Migration `20261029190000_domain_policy_settings` adds EmailPolicy and
SandboxPolicy without changing requests or creating setting rows. Until the first
save, services return the documented version-1 email and version-2 sandbox defaults.
Each successful first save creates the singleton row at the next version. Historical
meaning remains in each request's PolicyDecision.policySnapshot.

The additive `20261010050000_authentication` migration adds User, AuthSession,
the UserRole enum, nullable owner/reviewer foreign keys, and indexes. User stores
a unique normalized email, bcrypt hash, role, active flag, and creation time.
AuthSession stores a UUID, userId, random CSRF token, expiry, and creation time.
User deletion cascades to sessions but is restricted by owned requests/reviews.
No user deletion or public registration API is exposed.

Migration `20261010070000_agent_registration` only adds the Agent table, ownerId
index, and owner foreign key. ID/name use VARCHAR(64)/VARCHAR(120). The database
primary key prevents duplicate IDs, and the foreign key prevents orphaned agents.
Deleting a user with registered agents is restricted. Existing users, requests,
reviews, and sessions are not changed; old action agentId strings are not
automatically converted into registered agents or linked through a new foreign key.

Historical requests are not assigned invented owners. Only Managers and Admins
can access unowned records. Existing rows survive migration unchanged.

Migration `20261010120000_agent_permissions` adds allowedTools with an empty-array
default. Existing agents retain their IDs/owners/status but receive no implicit
grant. Use agent:configure to explicitly permit REFUND. Old requests are not
rewritten; execution now requires a current permitted registration and saved owner.

An older APPROVED request without an ApprovalRecord or authenticated reviewer is refused with
APPROVAL_MISSING. Create a fresh request and review it rather than treating an
old status flag as evidence of a bound approval. Earlier actions have no
retroactively fabricated audit events.

## 6. Creation and retrieval

createAction validates incoming JSON with actionRequestSchema, then passes the
validated action and authenticated user's ID to submitActionRequest. This service
starts a transaction and uses a parameterized SELECT FOR UPDATE on the supplied
Agent ID. It loads the row and checks, in order: the agent exists, belongs to the
caller, is active, and has the requested tool permission. Shared lockAgent and agentAccessError
keep submission and execution checks consistent. User, Manager, and Admin submissions all require ownership;
review privileges do not grant permission to submit on another owner's behalf.

Only after these checks does the service call evaluateRefundPolicy, evaluateEmailPolicy or evaluateSandboxPolicy, then
createActionRecord with the same transaction client. The repository accepts this
optional database client (default Prisma) and uses a nested create to save
ActionRequest, PolicyDecision, REQUEST_RECEIVED, and POLICY_EVALUATED atomically.
The agent row lock lasts until commit/rollback, so concurrent agent updates or
deletion must wait until the validated submission finishes. Any unexpected failure
rolls back the saved request, policy, and audit writes. No partial request succeeds.

Registry denials return 403 with a machine-readable error and message, before
policy evaluation or creation of any request-scoped records. They have no request
UUID or request-scoped audit events. Ownership is always taken from request.user,
never from a body field. REQUEST_RECEIVED now states that active registered agent
ownership was verified. Success retains the existing 201 response shape and policy
thresholds. Database errors propagate through the existing generic 500 handler.

The create schema accepts nonempty trimmed agentId/target, action REFUND, a
positive numeric amount, and currency INR (default INR). Numeric strings are
rejected. Execution requires an explicit currency and strict field shapes.

findActionRecordById includes policyDecision, approval, and execution. getAction
returns original request fields, latest status, nested policy information,
approval/execution (null if absent), and timestamps. GET never recalculates policy.

## 7. Review and approval snapshots

reviewAction validates the UUID and strict body containing only APPROVE or
REJECT. reviewPendingAction runs a database transaction. lockAction executes a
parameterized SELECT FOR UPDATE before reading the request. Reviews and
executions use this same lock, so another backend process must wait and recheck.

Only PENDING_APPROVAL can change. The transaction saves ApprovalRecord with the
exact stored action snapshot, changes status to APPROVED or REJECTED, and appends
ACTION_REVIEWED. Competing/repeated reviews produce HTTP 409; known non-pending
requests also append REVIEW_DENIED. Missing IDs produce 404.

Review requires a valid session, CSRF token, and current MANAGER or ADMIN role.
The middleware reads the role from User on each request, so a role downgrade
takes effect without waiting for JWT expiry. Reviews save reviewerId, and the
ACTION_REVIEWED audit details save reviewerId and the role at review time. Retrieval
includes only reviewer ID/email, never password hashes. Role-denied reviews return
403 before changing state. Authentication/CSRF failures do not append audit rows.

## 8. Backend execution and duplicate protection

executeRequestedAction validates the path and execution body, then calls executeAction.
The execution service locks the request within a transaction and checks:

1. Request exists, otherwise 404.
2. No prior ExecutionRecord or EXECUTED status, otherwise REPLAY_DETECTED (409).
3. Status is AUTHORIZED or APPROVED, otherwise ACTION_NOT_AUTHORIZED (409).
4. An APPROVED request has a saved APPROVE snapshot and reviewerId, otherwise APPROVAL_MISSING.
5. Agent ID, action, target, and complete arguments match the authorized snapshot,
   otherwise EXECUTION_MISMATCH (409).
6. Lock/read the current Agent row: it must exist, belong to stored.ownerId, be
   active, and include the stored action's tool permission. Failure returns a registry error (403).

Policy-allowed actions use the original stored request as their authorized
snapshot. Reviewed actions use ApprovalRecord.snapshot. Agent ID comparison
checks consistency of the supplied string. The actual caller now authenticates
as a user. Execution compares registry ownership with the original request owner,
even when a Manager/Admin executes. Historical unowned requests cannot execute.
Independent agent credential verification remains planned. The request row is
locked before the agent row; both locks last through commit. Disabling, deleting,
reassigning, or removing the tool grant after approval prevents execution. A denial
appends EXECUTION_DENIED, creates no receipt, and keeps AUTHORIZED/APPROVED status.
Restoring access permits a later matching attempt; the approval itself is not
revoked. Replay is checked first and still returns 409 after registry changes.
Clients cannot provide an approval or execution ID to bypass
these checks. Unauthorized attempts never call the simulator.

simulateRefund creates a UUID receipt with simulated=true, agentId, target,
amount, currency, and simulator REFUND. It has no external effects. The service
saves the ExecutionRecord, changes request status to EXECUTED, and appends
REFUND_EXECUTED in one transaction. Only one receipt can commit per request.
Repeating execution returns 409; this is replay rejection, not a cached 200.
Different request UUIDs can execute independently, even with identical payloads.

A denied attempt appends EXECUTION_DENIED with attempted values and the actual
request status. It does not change authorization, so a corrected attempt can
still execute. A rejected or policy-blocked request remains non-executable.

Simulator failures roll back execution and return generic
HTTP 500 through app.js. No receipt or EXECUTED status commits. Authorization
remains available for a safe retry because the simulator has no external effect.
A separate best-effort write records EXECUTION_FAILED when the database remains
available. Database outages can also prevent that failure audit. FAILED is an
audit status here; the action itself remains AUTHORIZED or APPROVED after rollback.
For connection failures with an uncertain commit outcome, retrieve the saved status before retrying; a committed receipt will be rejected as replay. A future external tool needs its own idempotency and recovery design; a database
transaction cannot roll back an external payment. SMTP now uses the separate durable
reservation/dispatch flow described in section 4 instead of simulator rollback.

## 9. REST API contract

The action endpoints below are under /api/actions; auth and agent paths are
listed separately. ISO timestamps and generated IDs vary.
Every action endpoint requires the session cookie. POST endpoints also require
X-CSRF-Token. Unauthenticated callers receive 401 AUTH_REQUIRED. Missing/wrong
CSRF tokens receive 403 CSRF_INVALID. User reads, audit reads, and execution are
limited to ownerId; other/unowned requests return the same 404 as a missing ID.
Managers and Admins may access all requests. Review additionally enforces their
role with 403 ROLE_FORBIDDEN. Execution checks ownership inside the row-lock
transaction, before authorization checks or simulator calls. Stored audit details
identify the user submitting/executing the action, separate from the agent string.

POST /api/actions additionally enforces registered-agent ownership for every role.
These denials use HTTP 403 and omit requestId/decision/status:

| Error | Meaning |
|---|---|
| AGENT_NOT_REGISTERED | No registered Agent row matches the validated agentId |
| AGENT_NOT_OWNED | The agent belongs to another user, regardless of active status |
| AGENT_INACTIVE | The caller's registered agent is inactive |
| TOOL_NOT_ALLOWED | The active owned agent lacks the requested REFUND, SEND_EMAIL or SANDBOX_FILE permission |

The same errors apply at execution, with ownership checked against the saved
request owner. Execution denials include current status and an audit event.
GET /api/agents requires login and returns {agents: [{id, name, active,
allowedTools, updatedAt}]}, ordered by ID. Every role receives only its own agents;
query parameters cannot select another owner. No password hashes or owner data
are returned. Responses use Cache-Control: no-store. There is no HTTP configuration
endpoint; local CLI commands are trusted operator actions.

The trimmed ID is checked exactly; ID matching is case-sensitive. Malformed
refund input retains 400 INVALID_ACTION_REQUEST before any registry check. A valid
agent with a refund above the amount limit still produces the existing persisted
BLOCK policy outcome; agent access denials are separate from refund policy decisions.

| Method/path | Body/query | Success |
|---|---|---|
| POST / | Refund JSON below or email/sandbox JSON in section 4 | 201: requestId, submitted fields, decision, status, reason, policy, receivedAt |
| GET /email-delivery | Authenticated session | 200: mode, ready, from, allowedRecipients; no credentials |
| GET /pending | Manager/Admin session | 200: requests, hasMore; oldest 100 pending requests |
| GET /:id/file-preview | Manager/Admin, pending CHANGE/DELETE UUID | 200: current content, bytes and fileSha256; 409 if missing or unreadable |
| GET /:id | UUID | 200: requestId, fields, status, policyDecision, approval, execution, createdAt/updatedAt |
| POST /:id/review | decision APPROVE or REJECT; fileSha256 required when approving CHANGE/DELETE | 200: requestId, status; 409 FILE_PREVIEW_CHANGED for stale file; approved SMTP may return its execution result or delivery error after immediate dispatch |
| POST /:id/execute | Complete refund, email or sandbox JSON | 200: requestId, status EXECUTED, execution record |
| GET /:id/audit | after integer >= 0, limit 1..100 | 200: requestId, events, nextCursor |

```json
{
  "agentId": "SupportAgent-01",
  "action": "REFUND",
  "target": "Customer-123",
  "arguments": { "amount": 8000, "currency": "INR" }
}
```

Execution compares this attempted JSON with the saved authorization. It rejects
additional top-level or argument fields. A nonempty unsupported currency is
accepted as an attempted value and denied by the integrity comparison.

Review body: `{ "decision": "APPROVE" }` or `{ "decision": "REJECT" }`.
Managers and Admins discover incoming requests using GET /api/actions/pending.
The route is registered before /:id so "pending" is not parsed as a UUID.
Ordinary users receive 403 ROLE_FORBIDDEN; unauthenticated callers receive 401.
findPendingActions reads only PENDING_APPROVAL rows, ordered by creation time
and then UUID for stable ties. It reads at most 101 rows: getPendingActions returns
the oldest 100 and uses the extra row to set hasMore. Summaries contain requestId,
agentId, target, arguments, status, createdAt, and the owner's email only. Account
password hashes and sessions are never included. Responses are not cached.
Reviewed, blocked, auto-authorized, and executed requests are excluded. Review
still uses the existing locked transaction; another manager's competing review
returns the existing 409 conflict, and refreshing reloads the saved status.
Audit defaults: after=0, limit=100. Events are ascending by ID. To get the next
page, use nextCursor as after; stop on a page shorter than the requested limit.
The server caps page size, not total stored events. No audit update/delete API
exists. Application append-only behavior is not database tamper-proof storage;
a database administrator or cascading deletion can still remove records.

Invalid input returns 400 with machine-readable error and human-readable message.
Unknown IDs return 404 ACTION_NOT_FOUND. Conflicts return 409 with error,
message, and current status. Malformed JSON returns INVALID_JSON (400).
Database connection/initialization outages return DATABASE_UNAVAILABLE (503),
with a short safe message; repeated warnings are logged at most once per 30
seconds. Other unexpected errors return INTERNAL_SERVER_ERROR (500) and log
internally. An outage does not invalidate the browser session.
Malformed requests and unknown IDs do not create request-scoped audit rows.

### 9.1 Authentication contract and request flow

Policy configuration API: GET /api/policy returns {policy} for Manager/Admin only.
PUT /api/policy requires the same role, a valid session and CSRF header, and strict
JSON {autoApproveLimit, maxAllowedRefund, version}. Limits must be whole rupees
in the database bounds above. Zero auto limit means every positive allowed refund
requires review. Equal limits leave no manual-review range. Extra fields, missing
version, fractional/negative/reversed/out-of-range limits return 400 INVALID_POLICY.
User access returns 403, missing authentication 401, and missing CSRF 403.
saveRefundPolicy uses a conditional version update in a transaction; stale edits
or simultaneous first inserts return 409 POLICY_CHANGED instead of overwriting
another manager's settings. The editor email is taken from the authenticated
account, not supplied JSON. Errors from the database retain the usual HTTP 500.
GET/PUT responses use no-store. Apply migrations and regenerate Prisma Client
before restarting the backend. On Windows, stop the backend before generation
if its loaded database engine DLL blocks replacement.

GET/PUT `/api/policy/email` uses strict JSON `{internalDomains, blockedDomains,
externalAction, version}`. Lists contain up to 100 unique exact domains each;
input is trimmed/lowercased and wildcards, URLs and malformed labels are rejected.
externalAction is REQUIRE_APPROVAL or BLOCK. Invalid input returns
400 INVALID_EMAIL_POLICY; stale versions return 409 POLICY_CHANGED.

GET/PUT `/api/policy/sandbox` uses strict JSON `{allowedPaths, protectedPaths,
operationActions, maxContentBytes, version}`. allowedPaths contains 1–100 unique
workspace/ folder prefixes; protectedPaths contains up to 100. Every prefix ends
with `/`. operationActions has exactly READ, WRITE, CHANGE and DELETE, each set to
ALLOW, REQUIRE_APPROVAL or BLOCK. maxContentBytes is an integer from 1 to 8,000.
Invalid input returns 400 INVALID_SANDBOX_POLICY; stale versions return 409.
Both endpoints use the same Manager/Admin, session, CSRF, no-store, editor identity,
transaction and optimistic-concurrency rules as refund settings.

| Method/path | Input | Success |
|---|---|---|
| POST /api/auth/login | Strict JSON email/password; X-AgentShield-Client: dashboard | 200: user {id,email,role}, csrfToken, expiresAt; JWT Set-Cookie |
| GET /api/auth/me | Session cookie | 200: user {id,email,role}, csrfToken, expiresAt |
| POST /api/auth/logout | Session cookie and X-CSRF-Token | 204: no JSON body; expired cookie |

Login normalizes email (trim/lowercase), checks valid syntax and maximum length
254, and accepts passwords from 12 characters through 72 UTF-8 bytes. The byte
limit prevents bcrypt from silently truncating a password. Extra fields, including
a requested role, return 400 INVALID_LOGIN. A dummy bcrypt comparison for unknown
emails and the same 401 INVALID_CREDENTIALS message for wrong passwords, missing
accounts, or inactive accounts avoid directly exposing account existence.

Login requires the custom client header; browser HTML forms cannot supply it.
If an Origin is supplied it must equal APP_ORIGIN. There is no CORS permission
for another site to supply that header. Violations return 403 ORIGIN_FORBIDDEN.
express-rate-limit permits 20 attempts per 15 minutes per IP/process, including
invalid bodies, then returns 429 LOGIN_RATE_LIMITED. `loginRateLimitKey` uses
Vercel's platform-generated `x-vercel-forwarded-for` client address only when the
platform sets `VERCEL=1`; Vercel overwrites that address to prevent client spoofing.
Local and other deployments ignore forwarded headers and use the direct socket
address. `ipKeyGenerator` groups IPv6 clients by /56 so rotating addresses inside
one allocation cannot trivially bypass the limit. If neither platform nor socket
provides an address, the limiter deliberately falls back to one shared `unknown`
bucket instead of silently disabling protection.

startSession prunes expired sessions, creates a new AuthSession with a random
32-byte CSRF token and a 30-minute expiry, then signs an HS256 JWT. JWT claims use
the user ID as subject, session ID as jti, issuer agentshield, and audience
agentshield-dashboard; roles are deliberately not embedded. requireAuth accepts
only that algorithm/issuer/audience, checks JWT expiry and UUID claims, then loads
the session and its current active User. Deleted/expired sessions or inactive users
return 401 AUTH_REQUIRED. Database outages propagate as 500, rather than being
reported as a bad password. No refresh token or automatic session extension exists.

The JWT cookie has HttpOnly, SameSite=Strict, Path=/api, Max-Age=1800, and Secure
when NODE_ENV=production. API responses use Cache-Control: no-store. requireCsrf
compares the mutation header with the session token using timingSafeEqual after
checking lengths. Logout deletes the session before clearing the cookie, so a
copied JWT can no longer authenticate. Other sessions for the account remain valid.
The session token lives only in frontend memory; /me restores it after reload.
JSON parser errors occur before route authentication and retain INVALID_JSON (400).

## 10. Frontend behavior

AuthGate checks GET /api/auth/me on startup and displays a labeled login form
when there is no session. After login the dashboard shows the account email/role
and logout control. Users see a waiting message instead of review buttons.
Managers/Admins see Approve/Reject, and saved reviews show the reviewer's email.
The backend enforces these rules independently of visible controls.

AgentPicker loads the logged-in user's agents through services/agents.js and shows
only agents whose explicit tool grant matches the selected domain. It prefers an
active matching agent and keeps a matching selection on manual refresh. Loading
and error states disable submission; if there is no matching agent, a scoped
message appears while saved-request lookup and role-authorized reviews remain.
Inactive matching agents remain selectable to demonstrate status denials.
Fetches are aborted on unmount. Network failures and 503 responses retry every
five seconds; other errors still offer manual Refresh agents. Successful retry
clears the error and restores an active matching selection. The
dropdown stays disabled when loading or empty, instead of allowing an invalid
agent selection.
Changing the dropdown affects new submissions only: execution uses the saved
request's agent. Request agent and a Copy request ID button help the two-account
journey. Registry-denial messages use the action API error display; refused
submissions produce no new request or automatic execution.

services/auth.js keeps the CSRF token only in module memory and restores it from
/me after reload. The JWT is delivered only as a cookie, never returned in JSON
or stored in localStorage. Action API 401 responses clear the visible session and
return to login. Logout clears the selection and revokes the session before hiding
the dashboard; errors remain visible if logout fails. Saved IDs are keyed by user
ID in localStorage so switching accounts does not load someone else's selection.
On startup, AuthGate keeps checking the existing cookie every five seconds after
a network failure or 503. It shows a temporary-service warning while waiting and
does not present the login form as if the session were invalid. A real 401 still
shows login. Older overlapping checks are ignored after a newer check or logout.

App.jsx uses one saved backend record as the source of current status, approval,
receipt, and audit display. Browser execution comparison and local capability
IDs have been removed from the dashboard. Legacy policy.js helpers are unused.
As of 2026-10-23, DomainSelector.jsx places three clearly separated, keyboard-accessible
domain buttons above the dashboard: Refunds, Email, and Sandbox Files. The selected
button has an explicit Selected label, aria-pressed state, and domain accent color.
Cards stack on narrow screens. Domain metadata supplies titles and request labels.
Dashboard changeDomain switches the form, resets agent selection, and calls select('')
to clear the displayed record, lookup, audit, saved selection, and stale messages.
Form drafts remain in memory per domain, but switching domains does not delete saved
backend requests. Loading/restoring a saved request aligns the selected domain with
its action in refresh; the server still controls access and authorization.

Refund fields remain inline in App.jsx, with example amounts for the default limits.
EmailFields offers internal/external/blocked recipient examples only in simulation
mode; these may differ if an operator edits the backend policy settings. SMTP mode
instead explains approval-triggered send, offers optional demo-recipient shortcuts,
and replaces only the untouched internal example recipient with the first shortcut
when configured. Typed recipient drafts
are preserved during settings polling.
SandboxFields offers read/write/change/delete/protected-path presets. These buttons only
fill inputs: Submit Request still uses the existing backend policy and execution
flow. No scenario button sends a message or executes a file operation.
AgentPicker remounts for the selected action, filters by its tool grant, and
prefers an active agent. Multi-grant agents appear in each matching domain.

Manager/Admin domain cards filter PendingRequests' fetched queue by actionType.
Each domain now shows a matching customization panel above its queue. Refund edits
the two amount limits; Email edits line-separated internal/blocked domains and the
external action; Sandbox Files edits line-separated allowed/protected prefixes,
four operation outcomes and the content-byte limit. Each panel loads on domain
selection, validates before save, disables logout while saving, displays version
and last editor, handles stale-version errors, and explains that only new requests
use the change. Filtering is local to the existing oldest-100
API response, not a new server search. When hasMore is true, the UI explains that
requests beyond that shared limit may not yet appear. Existing polling, review,
execution, receipt, and audit APIs remain shared across the three domains.
The static sidebar with inactive navigation was removed in favor of the working
refund workflow and saved-request lookup.

Submit creates a request. ALLOW then calls the execution API automatically;
REQUIRE_APPROVAL exposes review buttons; BLOCKED exposes no execution button.
A successful review refreshes the saved snapshot. The normal dashboard exposes
only the authorized execution action; the developer-oriented tampered-detail and
wrong-agent simulation buttons were removed. Backend integrity comparisons and
automated tampering tests remain unchanged. Replay still calls the backend through
its receipt test control; the UI shows the error while preserving the original
receipt and EXECUTED status.

services/actions.js centralizes JSON requests and errors. reviewAction checks
response ID/status; getAudit follows bounded pages. The dashboard verifies core
record and successful execution response fields before displaying them.

The selected UUID is stored in localStorage (no credentials). On reload the UI
fetches the record and events from the database. A saved-request ID field also
loads any accessible UUID. Server ownership/role checks control access. Reset clears the
selection, not database records. All mutation/reset/load controls are disabled
while a request is active, with a ref preventing duplicate handlers.

A useEffect polls every four seconds. AbortController and selected-ID checks
prevent an old selection from overwriting a new one. Background reads finishing
during a mutation are ignored. Poll failures display a warning; mutation errors
remain visible. The frontend does not pretend API failures succeeded.

Manager/Admin dashboards show PendingRequests.jsx in place of the submission
form and agent picker. The component calls services/actions.js getPendingActions
immediately and then four seconds after each completed fetch. Incoming pending
requests appear without copying an ID. Each row shows requester, agent, target,
time, amount, and a Review button. Selecting a row loads the existing details,
approval controls, and audit log. A successful approval/rejection triggers an
immediate queue refresh; the selected reviewed record remains visible. User
dashboards retain submission and selected-request polling, so approval becomes
visible there automatically. No refund executes just because it appears in the
queue; approval and execution remain separate explicit actions.

Queue reads are aborted on unmount or refresh; old reads cannot overwrite a newer
refresh. Errors show a warning while preserving the last successful list, so a
stale row can still be selected and checked against the backend. Empty state is
shown only after a successful empty result. Refresh requests retries immediately.
At more than 100 pending requests, a notice explains that the oldest 100 are shown
and more appear as those are reviewed. This is a bounded demo queue, without page
navigation or push notifications. Separate browser contexts are still required
for simultaneous user and manager sessions.

The three policy-setting components appear only on Manager/Admin dashboards above
the selected domain's queue. services/policySettings.js reads/saves the matching
/api/policy endpoint with the shared in-memory CSRF token and handles session
expiration. Each form loads saved settings, validates its domain-specific fields,
and sends the loaded version when saving. Save policy confirms that only new
requests use the change. Reload policy fetches the current version after a conflict
and replaces unsaved local edits. While loading or saving the form is disabled,
and logout is disabled during save. Version and last editor are displayed.

## 11. Commands and setup

At repository root: npm install, then npm run dev. This starts the local service
supervisor, which brings up the stateful development database, Express API, and
Vite in order and keeps monitoring them. Vite proxies /api to Express on
localhost:3000. npm run build produces dist. Use npm run frontend:dev only when
the database and API are deliberately being managed in separate terminals.

Inside backend:

```bash
npm install
npm run prisma:generate
npx prisma migrate deploy
npm start
```

Before starting, generate a random JWT signing secret and put it in backend/.env
as JWT_SECRET. The example deliberately leaves it empty; missing secrets or secrets
shorter than 32 bytes stop startup. This command prints a new secret for local setup:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Set APP_ORIGIN to the exact dashboard origin (default http://localhost:5173).
If Vite chooses another port, update this setting or start Vite with a fixed port.
NODE_ENV=production enables Secure cookies and requires HTTPS. Keep the frontend
and API on the same origin, using the Vite proxy locally. No CORS access is enabled.

Accounts are created by the local operator, with no default credentials or public
signup endpoint. scripts/create-user.js validates the normalized email, explicit
USER/MANAGER/ADMIN role (default USER), and password, hashes it with bcrypt cost 12,
and inserts the account. Duplicate emails fail without overwriting the account.
The password comes from stdin, not command arguments. PowerShell example inside backend:

```powershell
$accountPassword = Read-Host 'Choose a password (12 characters, at most 72 UTF-8 bytes)' -AsSecureString
[System.Net.NetworkCredential]::new('', $accountPassword).Password | npm run user:create -- manager@example.com MANAGER
$accountPassword = $null
```

Repeat with a different email and USER to test the owner/manager journey. Apply
the new migration and generate Prisma Client before creating accounts.

### 11.1 Registering a local agent

After generating Prisma Client and applying migrations, run this inside backend,
replacing owner@example.com with an existing active user's email:

```bash
npm run agent:register -- SupportAgent-01 "Support Agent" owner@example.com active REFUND
npm run agent:register -- ArchiveAgent-01 "Archive Agent" owner@example.com inactive
```

The syntax is agent-id, quoted name, owner email, optional active/inactive
status, and optional comma-separated REFUND, SEND_EMAIL, SANDBOX_FILE grants or none.
Omitted status means active; omitted permission means none. Duplicate/unknown grants fail.
agentRegistrationSchema trims ID/name, normalizes owner email with the shared
emailSchema, and rejects extra fields. IDs must be 1-64 characters, start with
a letter or number, and contain only ASCII letters, numbers, underscores, or
hyphens. Names must be 1-120 characters after trimming. IDs retain their case.

registerAgent validates before database access, finds the owner by normalized
email, rejects a missing/inactive account, checks for an existing ID, then creates
the Agent row with the owner's UUID and chosen active flag. The primary key is
the final defense against simultaneous duplicate inserts. A duplicate registration
never changes the stored owner, name, or status. No new account is created for a
missing owner, and no password hash is printed by the command.

register-agent.js reports the new ID/name, owner UUID, and status on success
(exit 0). Invalid argument counts or fields, missing/inactive owners, duplicate
IDs, and database errors return exit 1 with a useful message. A concurrent owner
deletion is handled as a foreign-key error. The command requires DATABASE_URL;
it does not require a JWT or a running Express server because it is a local
operator command, like user:create. No new dependencies were added.

Configure an existing agent from the backend directory:

```bash
npm run agent:configure -- SupportAgent-01 inactive REFUND
npm run agent:configure -- SupportAgent-01 active none
npm run agent:configure -- SupportAgent-01 active REFUND
```

configureAgent validates a strict ID/status/grant object, locks the existing row,
then updates only active/allowedTools. It preserves name/owner, refuses unknown
IDs, and cannot create a replacement. CLI success is exit 0; invalid inputs,
missing agents, or database errors are exit 1. No JWT/server is required by local
operator commands. There is no registration/configuration API or management UI.
Agent IDs are identifiers, not credentials for independent agent processes.

### 11.2 Repeatable presentation setup

Inside backend run `.\scripts\setup-demo.ps1`. It prompts for two hidden passwords
(12 characters minimum, 72 UTF-8 bytes maximum), sends JSON on stdin to
`npm run demo:setup`, and clears prompt variables. No passwords are printed or
passed as command arguments. See PRESENTATION_WALKTHROUGH.md for the full journey.

setupDemo provisions user@agentshield.test (USER), manager@agentshield.test
(MANAGER), and six user-owned agents: Demo-Sandbox (active SANDBOX_FILE), Demo-Email (active SEND_EMAIL),
Demo-Refund and Demo-Revocable (active REFUND), Demo-NoRefund (active, no grants),
and Demo-Disabled (inactive REFUND).
It hashes passwords before the transaction. Repeating with the same passwords
restores these demo agents' names/status/grants while preserving refunds and user
hashes. Existing accounts with different passwords/roles/status, or fixture IDs
owned by another account, cause DEMO_CONFLICT and rollback all setup writes.
Invalid stdin JSON/passwords fail with exit 1. Setup does not delete records,
reset other agents, configure .env, or run migrations. Choose and remember your
own passwords; there are no built-in credentials. No dependencies were added.

Use npm run dev for Node watch mode. Set DATABASE_URL in backend/.env using
.env.example as the template. PostgreSQL must already be running. migrate deploy
applies committed migrations without resetting records. To author a later schema
migration, use npm run db:migrate -- --name descriptive_name.

The current machine uses a named local Prisma development database (agentshield)
because Docker/psql are unavailable. Start it with the installed Prisma development
server tooling before running Express. Its pooled URL needs pgbouncer=true. The
older CLI's dynamically downloaded dev command may need registry access; that is
a development-environment limitation, not an app dependency. For verification we
used already cached tooling, without adding it to backend/package.json.

For this Windows demo machine, `npm run dev` at the project root is the recommended
development and presentation command. `npm run demo:dev` is retained as an alias.
scripts/demo-supervisor.js checks ports
51214, 3000 and 5173 every five seconds, starts a stopped service in that order,
and limits each service to five starts per minute. Every 30 seconds it runs
backend/scripts/check-local-database.js in a short-lived process with a five-second
timeout. This makes a listening but unresponsive database visible. If the monitor
started that database process, it asks it to close over Node IPC, waits up to
three seconds, then stops it if needed and starts the same stateful database on
the next check. It never stops an unrelated database process. The backend runs
without Node watch mode; Vite still reloads frontend edits. Keep this single command running
for the presentation. It reuses already listening services and does not reset
the database. When stopped, it sends SIGINT only to child processes it started;
separately launched services remain separate. The monitor checks only port liveness
for the backend/frontend, so a listening but unhealthy API or Vite process still
needs operator attention. No SMTP message or file action is triggered by the monitor.

Alternatively, run `npm run db:local` inside backend in a separate terminal and
keep it open for the presentation. scripts/start-local-database.js
loads @prisma/dev from a local installation or an existing Windows npm cache;
When require.resolve finds a CommonJS entry, the launcher prefers the adjacent
ESM build if present, matching the runtime used in the verified local recovery.
it does not download packages or change the application's Prisma version. If
tooling is missing it exits with a setup message. It starts the existing named
agentshield database using stateful storage and ports 51213-51216, including
PostgreSQL on 51214. No records are reset. A keep-alive interval retains the
launcher after server initialization, and Ctrl+C closes the server. If another
process already runs this database, the tooling reports that conflict; keep the
existing database terminal open or stop it before launching a replacement.
This command supports the documented local Prisma database, not arbitrary remote
PostgreSQL installations. Backend `npm run dev` and root `npm run frontend:dev` still run
in their own terminals after the database is ready.

Tests: npm test inside backend, with DATABASE_URL pointing to a migrated,
ISOLATED TEST DATABASE. Set AGENTSHIELD_TEST_DATABASE=1 only for that disposable
database; the suite refuses to run without this explicit marker. Vitest generates
an ephemeral JWT secret. beforeEach deletes policy decisions, action requests,
agents, sessions and users, then creates an authenticated Manager fixture;
the fixture now also includes an active SupportAgent-01 owned by that Manager.
request deletion cascades to review/execution/audit records. Never run this suite
against a database containing records you want to keep. npm run test:watch enables
watch mode. Supertest imports app.js without starting server.js.
The registration suite also uses the isolated-database marker and deletes fixture
agents before users. Vitest runs files sequentially (fileParallelism=false) so the
database suites cannot delete each other's fixtures. CLI checks release the parent
Prisma connection before launching separate registration processes.

## 12. Verification record

2026-11-12 hosted evaluation deployment preparation:

- Provisioned one Neon PostgreSQL resource through the linked Vercel project and
  connected its environment variables to Production, Preview and Development.
  Secret values remain outside Git.
- Applied all 10 committed Prisma migrations to the empty hosted database, then
  ran the existing transactional demo setup. It created the documented USER and
  MANAGER accounts and six USER-owned scoped agents.
- `npm run build` passed with 934 transformed frontend modules;
  `npm run test:policy` passed all 72 tests across three policy files; importing
  `api/index.js` with production-shaped environment variables returned the
  Express handler successfully.
- Production URL/API verification remains pending the Git-triggered deployment;
  this entry does not claim the hosted API is live yet.

2026-11-12 hosted login proxy correction verification:

- Added focused tests proving that production uses Vercel's trusted client-IP
  header with IPv6 /56 grouping and that local requests ignore a spoofed copy of
  that header. Live verification is recorded after the corrected deployment.

2026-11-12 repository publication verification:

- `npm run build` completed successfully and produced the React/Vite production
  bundle from 934 transformed modules.
- `npm run test:policy` completed outside the restricted sandbox: all 3 policy
  test files and all 72 tests passed.
- A plain full `npm test` attempt correctly refused database suites because no
  disposable database was marked with `AGENTSHIELD_TEST_DATABASE=1`. Therefore,
  this publication check does not claim a fresh full database-suite pass.
- Reviewed the version-control candidate set and excluded machine-local `.env`,
  dependencies, builds, runtime logs, chart temporary data, local database tools,
  demo workspace files, and `tmp/` artifacts. Placeholder values in README,
  `.env.example`, and tests are documentation/fixtures rather than live secrets.

2026-10-29 dashboard execution cleanup and sandbox comparison labels:

- Removed the visible tampered-detail and wrong-agent execution buttons from the
  normal dashboard without changing backend execution-integrity validation or
  automated security tests.
- Added explicit Proposed new file content / Proposed replacement content labels
  and kept the separate Current file contents before approval preview.
- Root `npm run build` passed after the React changes. No API, database, policy,
  dependency, migration, SMTP, or filesystem behavior changed.

2026-10-29 email and sandbox policy customization:

- Added and applied additive migration 20261029190000_domain_policy_settings,
  regenerated Prisma Client, and verified both authenticated live GET endpoints
  return their defaults (email v1 and sandbox v2). No existing request or setting
  data was reset. A reversible live PUT check saved email v2 and sandbox v3,
  confirmed a stale email v1 update returns 409, then deleted both temporary rows
  and its temporary session; final counts were zero EmailPolicy/SandboxPolicy rows,
  so the database returned to the original defaults.
- `npm run test:policy` passed all 72 refund/email/sandbox policy checks, including
  custom external blocking, custom sandbox paths/outcomes/content limit, snapshot
  independence, and permanent protected-boundary enforcement. The first sandboxed
  Vitest attempt could not read temporary Wasm assets; the same focused command
  passed outside that filesystem sandbox.
- Root `npm run build` passed with 934 transformed modules. Node syntax checks
  passed for the edited backend routes and services. The full stack restarted;
  the dashboard returned HTTP 200 and the protected policy route returned the
  expected 401 without a session. A delayed final check confirmed the supervisor
  owned the database/API children and ports 51214/3000/5173 were listening.
  Database-backed integration tests were updated
  but not run because the available stateful demo database is not an explicitly
  disposable `AGENTSHIELD_TEST_DATABASE=1` database.

2026-10-29 default full-stack development startup:

- Changed the root `npm run dev` command from Vite-only startup to the existing
  demo supervisor so the login API and database are not accidentally omitted.
  Added `npm run frontend:dev` for the old intentional Vite-only workflow and
  retained `npm run demo:dev` as a compatible full-stack alias.
- Verified the supervisor script with Node's syntax checker, built the frontend,
  and started the full stack. The dashboard and proxied session endpoint both
  responded through port 5173; the session endpoint returned the expected 401
  when no login cookie was supplied.

2026-10-27 proposed no-cost agent note:

- Documentation-only update. No code, configuration, runtime behavior, or tests
  changed; implementation and verification of an independent agent are pending.

2026-10-27 local demo reliability update:

- A real outage showed port 51214 absent and Prisma unable to read agents while
  the frontend and backend still listened. The named database was restarted
  without resetting records; read-only checks found the existing agents and
  requests. This motivated the service monitor and UI retry behavior.
- `npm run build` passed with 932 transformed frontend modules; backend app
  imports and the monitor syntax check passed. The focused API test passed with
  Prisma's session lookup mocked to reject with P1001: the response was 503
  DATABASE_UNAVAILABLE and did not expose the underlying error. No test database
  or real SMTP connection was used for this check.
- The demo monitor recognized the already-running database/backend/frontend.
  In a controlled restart check, the previous Vite process stopped; the monitor
  started Vite and the page returned HTTP 200 again. The monitor was then run
  in the background for this local demo session. This verifies process recovery
  for Vite. When the local database later listened but stopped answering Prisma
  queries, its confirmed old launcher was stopped and the updated monitor started
  the same stateful database. A read-only check then found all six agents and 16
  existing requests. The independent read-only health command passed. An initial
  stale-name lock caused one startup retry before recovery.
- The older backend process was stopped after the code change; the monitor
  restarted it with the new error handler. The frontend build and focused outage
  test passed again after the AuthGate retry adjustment.

2026-10-27 external recipient, CHANGE and Manager preview update:

- Rebuilt and fingerprinted all checked OPA policies with the repository's local
  OPA 1.21.1 binary. Sandbox policy tests passed 31 cases; direct real-file tool
  tests passed 2 cases covering create, read, change, stale digest and delete.
- `npm run build` passed with 932 transformed frontend modules. Backend app imports
  passed. SMTP configuration parsing passed with no demo shortcuts configured.
- Migrated a separate stateless local test database on port 51414; it was closed
  after each check. The sandbox API suite passed 17 tests, including Manager-only
  preview, CHANGE approval, and file changes before/after review. The mocked SMTP
  API suite passed 28 tests, including an external recipient outside the optional
  shortcut list. No real email was sent and the existing demo database was not
  used by these tests.
- No live Gmail delivery or manual browser walkthrough was performed for this
  change. SMTP acceptance still does not prove inbox delivery.
- The running stateful demo database stopped answering during isolated test
  runs; it was restarted. A read-only count confirmed its 14 saved requests
  remained available. The frontend returned HTTP 200 and the unauthenticated
  proxied API returned the expected 401.

2026-10-26 domain, SMTP approval and real sandbox change:

- `npm run build` passed with 932 transformed modules after the UI changes.
- A local configuration parse returned SMTP mode and exactly two allowed
  recipients. It did not print credentials, connect to Gmail, or send email.
- The backend application modules loaded successfully without connecting to
  the demo database or sending mail.
- `npm test -- test/sandboxFileTool.test.js` passed two direct real-file cases:
  exclusive WRITE, content READ, DELETE, traversal and protected-path denial.
  The test uses a unique filename; it sent no email.
- The three existing policy test files passed separately: refund 27, email 12,
  sandbox 29 cases. The combined policy command failed in this Windows sandbox
  because Vitest's temporary SSR cache file disappeared while multiple workers
  imported it. Individual runs completed successfully.
- The database-backed SMTP and sandbox API suites were updated for approval-time
  dispatch and real file receipts, but were not run in this turn: they require
  an explicitly marked isolated disposable database. No live SMTP send or
  browser end-to-end check was performed. Restart the backend to load the local
  recipient change before rehearsing with the two test inboxes.

2026-10-23 domain dashboard UI:

- Follow-up local startup: started `npm run db:local` in backend, `npm run dev`
  in backend, and `npm run dev -- --host localhost --port 5173 --strictPort`
  at the repository root. Dashboard `/` returned HTTP 200; proxied `/api/auth/me`
  returned the expected HTTP 401 AUTH_REQUIRED without a session.
- Read-only checks confirmed the existing active demo User/Manager accounts and
  Refund/Email agents. The Sandbox agent registration initially failed because
  the named demo database lacked migration 20261021120000_sandbox_scope.
  `npx prisma migrate deploy` applied that existing additive enum migration;
  `npm run agent:register -- Demo-Sandbox "Sandbox File Agent" user@agentshield.test active SANDBOX_FILE`
  then succeeded. Existing credentials and action records were preserved.
  No live authenticated action execution or email send was performed during startup.
- Login connectivity follow-up: Vite recorded ECONNRESET for `/api/auth/login`
  and the backend watcher log showed restarts. Restarted the API using `npm start`
  (without file watching) for the interactive demo; frontend and database stayed
  running. Direct and proxied auth probes returned structured expected HTTP 401
  responses. A live Playwright browser submitted a nonexistent account and showed
  `Email or password is incorrect.` from the real API, confirming form/proxy/API/
  database connectivity without using or changing saved passwords. The initial
  browser locator used an exact label that omitted the required-field marker;
  corrected selectors passed. Successful account login and action execution were
  not performed by this connectivity check.

- `npm run build` passed. Reviewed changed components with the React best-practices
  checklist: controlled inputs, stable component definitions, aborted fetches,
  keyboard-focus styling, aria-pressed domain buttons, and disabled mutation controls.
- A temporary Playwright check exercised the built frontend with mocked API responses:
  all three domain forms submitted the matching action and scoped agent; switching
  cleared the prior record; recipient/file presets filled the expected fields;
  Manager queues filtered by domain and hid refund settings elsewhere; SMTP showed
  explicit-send messaging and hid simulation recipient examples. No page errors occurred.
- Inspected desktop and 390px mobile screenshots; the mobile document had no horizontal
  overflow. Browser assets were fulfilled from local dist files because sandbox/local
  preview networking was unavailable. Checks used no real emails or database writes.
  This verifies UI behavior, not a fresh end-to-end backend/database integration run.

2026-10-21 sandbox-file dry run:

- `npm run policy:build` passed strict Rego checks and compiled/fingerprinted all
  three policies using the installed OPA 1.21.1 compiler. Sandbox policy assets
  are committed for normal startup without requiring OPA on PATH. The initial
  restricted-shell compiler spawn failed; the same local build succeeded outside
  the sandbox. Prisma Client generation and `prisma validate` also passed.
- `npm run test:policy` passed all 68 tests across three policy files. A focused
  disposable-database run passed all 43 sandbox tests across two files (29
  policy/schema/receipt cases and 14 API cases). All nine migrations, including
  the additive SANDBOX_FILE enum migration, applied successfully to that fresh
  stateless database on port 51414. SMTP was not contacted.
- Coverage includes allowed reads/writes, approval-required deletes, protected
  and outside paths, traversal/absolute/ambiguous path rejection, exact write
  bytes, UTF-8 limits, pure receipts, ownership/CSRF/roles/tool grants, saved
  snapshots, changed arguments, permission withdrawal, concurrency/replay and
  simulation failure rollback. Approved-delete tampering was then strengthened
  with path/operation mismatch assertions for the follow-up run below.
- The frontend production build passed (931 transformed modules). Reviewed the
  UI using the React best-practices checklist: controlled fields, scope-specific
  form/state handling, safe React text rendering, write-only content fields,
  bounded review text, queue labeling and explicit dry-run receipt wording.
  No live browser walkthrough was performed for this change.
- Combined regression attempts did not complete successfully. Native Windows
  exits (-1073740791) interrupted full and permission batches. Another combined
  email/SMTP/sandbox run passed 23 email tests, then failed 43 setup/tests after a
  cached-server prepared-statement collision (42P05) and closed connections. The
  optional pgbouncer=true workaround also crashed this runtime and was not kept
  as an application configuration change. None counts as a full-suite pass.
- The final runner used a fresh stateless database for each affected API file,
  with the normal connection settings. All 14 sandbox API tests (including the
  added approved-delete path/operation tampering assertions), 23 email API tests
  and 29 mocked-SMTP tests passed. Together with the 68 policy tests, 134 distinct
  tests passed across six files. The broader refund/authentication/CLI regression
  remains unverified in this change. Temporary machine-specific runners were
  removed; output/sandbox-final-focused.log retains the final API results.
- The existing demo database, accounts and SMTP
  configuration were not used or changed. Local app use still requires applying
  the migration, restarting the backend and explicitly registering/granting a
  sandbox agent as explained in section 4.

2026-10-20 SMTP delivery:

- Final full regression run passed all 205 tests across eight files in 207 seconds,
  using `npm test -- --testTimeout=30000 --hookTimeout=30000` through an isolated
  cached-tooling database runner. SMTP was mocked and the demo database was not
  used by tests. Temporary machine-specific verification runners were removed.
- Applied the additive SMTP migration to the existing local agentshield database
  on 51214 after starting its normal stateful launcher. A counts-only check found
  all 10 existing requests present and zero SMTP-mode requests. No account, agent,
  password, or email configuration was changed. The local database remains running.
- Installed Nodemailer 10.1.7 and regenerated Prisma Client. All eight migrations,
  including the additive SMTP-mode migration, applied to a fresh isolated stateless
  database on 51414. The focused SMTP suite passed all 29 tests using mocked
  Nodemailer, so no external server was contacted. Cases cover configuration,
  recipient restrictions, full approval/sender snapshots, TLS settings, auth/CSRF,
  owner/agent access, tampering, replay/concurrency, timeout/rejection, and failure
  to persist an outcome after SMTP acceptance. Earlier simulated requests stayed
  simulated after SMTP was enabled in the test environment.
- Both Gmail-helper tests passed using disposable .env files and dummy passwords.
  They confirm unrelated database/JWT settings survive setup, email keys are
  replaced once, invalid passwords do not change the file, and output excludes
  the password. The PowerShell script parser also reported no syntax errors.
- The frontend production build passed after final UI edits (930 modules).
  Reviewed the React changes for effect/timer cleanup, safe plain-text rendering,
  disabled submission on missing settings, explicit real-send intent, and receipt
  wording that distinguishes provider acceptance from inbox delivery.
- Test-runner attempts with connection_limit=1 stalled; the focused run passed
  using the local tooling's normal connection settings. A sandboxed helper test
  initially could not load ConvertTo-SecureString; the test harness now constructs
  a dummy SecureString directly. These interrupted/failed attempts are not counted
  as passing. Gmail authentication and inbox delivery were still pending at the
  end of the implementation-only checks; follow-up configuration is recorded below.
- Initially running `npm run email:verify` against the unchanged SIMULATED local config
  returned the intended generic exit-1 setup error and sent no message. There was
  no live Gmail login/send or new browser UI verification in this change.
- Follow-up local setup: the user entered their existing Gmail sender/test inbox
  and app password through the hidden PowerShell helper. `npm run email:verify`
  then exited 0 against Gmail, confirming SMTP connection, TLS, and authentication.
  No email was sent by this check. Backend startup with the new configuration,
  dashboard approval/execution, and actual inbox arrival still need verification.
  No password or raw provider response was printed or added to this guide.
- `npm audit` reported two moderate advisories in the OPA/sprintf-js dependency
  path (GHSA-hp3w-g68c-fv3c), no high/critical advisories, and no Nodemailer advisory.
  The suggested major OPA downgrade was not applied as part of email delivery.

2026-10-12 email scope:

- Applied additive migration 20261012110000_email_scope to the local demo store
  and regenerated Prisma Client. Registered Demo-Email for the existing demo
  USER without changing passwords, existing grants, or saved refund requests.
- `npm run policy:build` compiled both policies with strict Rego checking.
  `npm run test:policy` passed 39 tests (27 refund/loader and 12 email policy).
- Applied all seven migrations to a fresh stateless test database on 51414.
  The full suite passed all 174 tests across six files, using 30-second test and
  hook timeouts for the Windows local database. Coverage includes all previous
  refund tests plus email permissions/CSRF/ownership, domain decisions, exact
  review snapshots, changed recipient/subject/body/action/agent, grant revocation,
  concurrent replay, simulator rollback, OPA failures, input/size rejection, and
  legacy refund snapshot retrieval. Logs: output/email-verification.stdout.log
  and output/email-verification.stderr.log. The demo database was not used by tests.
- `npm run build` passed. Browser checks used separate disposable accounts and
  database on 51514, API on 3001, and frontend on 5174. Verified internal automatic
  simulation, external pending queue, manager approval, full message display,
  literal HTML-like body text, tampered-subject denial, successful approved
  simulation, replay denial, and persistence after reload. No browser console
  errors were reported. Screenshot: output/email-browser-verified.jpg.
- Browser review exposed a refund-only REQUEST_RECEIVED explanation; corrected
  the text to “Action request validated.” This wording change followed the suite
  and screenshot; decision/execution behavior did not change. No email was sent.
  Temporary runners and test servers were removed after verification.

2026-10-12 embedded OPA integration:

- Downloaded the official Windows OPA 1.21.1 compiler and matched its SHA-256
  to the release checksum. The compiler is in ignored backend/.tools; it is
  build tooling, not a runtime dependency. Installed the official SDK at 1.10.0.
- `npm run policy:build` passed strict Rego checking and produced the Wasm and
  manifest. `npm run test:policy` passed all 27 tests. These evaluate real Wasm
  boundaries/custom limits, default-deny malformed input, invalid adapter input,
  corrupted assets, and undefined/invalid SDK output. An initial test run exposed
  an ESM spying limitation; the SDK mock was corrected before the passing run.
- On a fresh stateless cached Prisma/PGlite database on port 51414, applied all
  six existing migrations and passed all 139 tests across four files using
  `npm test -- --testTimeout=30000 --hookTimeout=30000`. The complete run used
  an independent hidden Windows process. The default five-second timeout was
  too short for local CLI fixtures in the first run (133 passed, six failed with
  CLI timeouts and subsequent database-engine errors). A runner-based retry
  ended before a complete result; neither attempt was counted as a passing run.
  The final independent run passed every test, including the two added API tests
  for failure rollback and OPA audit fingerprints. No tests used the demo database.
- `npm run build` passed. The running dashboard session endpoint returned HTTP
  401 AUTH_REQUIRED as expected without login. The production adapter returned
  ALLOW, REQUIRE_APPROVAL, and BLOCK for 2000, 8000, and 25000 respectively, with
  opa-refund-r1-v1 and policyEngine=opa. Authenticated API submission, approval,
  execution, saved decisions, and audit checks passed in the isolated suite;
  a real-account browser login was not used for this change.
- The independent suite logs are in output/opa-verification.stdout.log and
  output/opa-verification.stderr.log; the machine-specific temporary runner was
  removed after the disposable database closed. No schema/data migration or
  demo-account change was performed. Syntax checks passed for the new build,
  loader, and adapter modules.
- The demo database process was no longer listening after the extended checks;
  restarted `npm run db:local` independently. Its existing state was retained.
  The dashboard login endpoint then returned HTTP 401 INVALID_CREDENTIALS for
  a nonexistent account, confirming the restored database lookup path.

2026-10-12 local login connection recovery:

- The dashboard loaded, but Vite's API proxy logged ETIMEDOUT when contacting
  Express on port 3000. Earlier frontend/backend processes started in the
  restricted tool environment were unreachable from normal local requests.
- Started `npm run db:local` and backend `npm run dev` as independent hidden
  Windows processes using `Start-Process`, with the backend working directory.
  Kept the independent root `npm run dev` frontend and stopped the duplicate
  restricted frontend and backend processes. The database reported ready on
  port 51214; Express reported listening on port 3000.
- Through the frontend proxy, GET `/api/auth/me` returned HTTP 401 with
  AUTH_REQUIRED. POST `/api/auth/login`, with the dashboard header and
  `Origin: http://localhost:5173`, returned HTTP 401 INVALID_CREDENTIALS for
  a nonexistent check account. This confirms the proxy, authentication handler,
  and database lookup respond. Existing-account login was not tested because
  this check did not use a real password. No accounts or refund data were changed.
- Use `http://localhost:5173` for login so the browser origin matches APP_ORIGIN.
  The root `backend-dev.*.log`, `database-dev.*.log`, and `vite-dev.*.log` files
  capture the independent processes' startup output and errors. No implementation,
  dependency, or schema changes were needed; the full test suite was not run.

2026-10-11 manager policy customization:

- `npm run build` passed. Stopped Express to release the Windows query-engine
  DLL, regenerated Prisma Client, applied the additive policy-settings migration
  to the available demo database, and restarted Express.
- On a fresh isolated stateless database on 51414, applied all six migrations.
  The 13 focused policy/queue tests passed. The broader suite then passed 109/110;
  one old spy assertion expected evaluateRefundPolicy to receive only the amount.
  Updated that assertion to verify the new current-limits argument as well; its
  targeted rerun passed. All 110 tests have passing results across these runs.
- An earlier broad run on the previous isolated database failed after that
  server stopped (26 passed, 84 failed from connection errors); it was not counted
  as successful validation. No integration tests used the demo database.
- Browser verification confirmed Manager login, the customization form, default
  limit loading, and Save policy confirmation. Saved the same 5000/20000 limits
  (now version 2) to preserve the expected demo rules. Existing pending requests
  still showed their original refund-v1 policy snapshot. The recovered runner
  store contains the earlier two pending requests; their data is available here.

2026-10-11 repeated login outage recovery:

- The database process stopped again while Vite and Express remained running;
  authentication reads returned HTTP 500 with Prisma P1001. This was a service
  outage, not invalid login credentials.
- Launched the project database script through Windows process management in a
  hidden PowerShell process independent of the chat tool runner. A stale empty
  startup lock was removed only after checking that no database process or
  original database port remained active. Stored data directories were not deleted.
- The independently running store had no application tables. Applied the five
  existing migrations and ran demo:setup with the operator's previously chosen
  passwords. The current store now contains two demo accounts and four agents;
  previously visible refund requests are not present in this store. Their earlier
  storage location was not established, and no refund-history recovery is claimed.
- Verified both account logins through http://localhost:5173: HTTP 200 for each,
  four owned agents for USER, and an empty pending queue for MANAGER. Verification
  sessions logged out with HTTP 204. A new demo request must be submitted.
- `node --check backend/scripts/start-local-database.js` validates launcher syntax.
  No full test suite was run for this runtime/data recovery.

2026-10-11 agent dropdown recovery:

- Traced the disabled/empty agent dropdown to the local database being stopped
  (backend P1001 for localhost:51214), rather than a broken select control.
- Added `npm run db:local` as a persistent project launcher for the existing
  named local database and made agent-loading errors explain how to retry.
- Browser verification after recovery: user login succeeded, the dropdown opened
  with all four demo agents, selecting Demo-Revocable changed the selected value
  and left Submit Request enabled. No refund request was created by this check.
- `npm run build` passed. No dependencies or database schema changed.
- Started the new project launcher and confirmed it served all four saved agents.
  The first attempt collided with the previous process's shutdown lock; retrying
  after shutdown succeeded. Startup errors are printed as short messages.

2026-10-11 automatic pending-request queue:

- `npm run build` passed. The restricted runner initially blocked Vite's realpath
  operation; the same build passed outside that runner.
- Applied all five existing migrations to a separate disposable database named
  agentshield-queue-tests on its assigned database port 51218. Ran
  `npm test -- test/permissions.test.js -t 'Pending request queue'` with its
  DATABASE_URL and AGENTSHIELD_TEST_DATABASE=1: all four queue tests passed,
  with 17 unrelated tests skipped. The demo database was not used by this suite.
- Recovered the existing demo database using cached @prisma/dev server tooling
  in a temporary module, with stateful storage and the original ports 51213-51216.
  The programmatic launcher needed a keep-alive interval after initialization;
  without it the process exited. The running launcher confirmed two existing users.
  This recovery added no app dependency and did not reset demo records.
- Browser verification on http://localhost:5173 confirmed Manager login, both
  existing INR 8,000 pending requests appearing automatically, and a row's Review
  button opening the saved policy, audit events, and Approve/Reject controls.
  No existing demo request was approved or rejected during this browser check.

2026-10-11 demo password reset and local recovery:

- Restarted the existing named agentshield database using the cached Prisma CLI
  `dev start agentshield`; no database reset or migration was performed.
- Changed only the password hashes for user@agentshield.test and
  manager@agentshield.test to the operator's requested password. A one-time Node
  command generated separate bcrypt hashes at cost 12 and updated both accounts
  in one Prisma transaction. It required both accounts to exist and be active;
  otherwise the transaction would fail without changing either account.
- Deleted those accounts' existing AuthSession rows in the same transaction so
  previous login cookies no longer authenticate. Plaintext passwords are not
  recorded here. No permanent reset script or API endpoint was added.
- Restarted the unresponsive backend and stopped the duplicate Vite process.
  Both account logins through the running Vite API proxy returned HTTP 200 with
  the expected USER and MANAGER roles. Verification sessions were logged out
  successfully with HTTP 204. No full test suite was run for this data-only change.

2026-10-10 local development startup:

- A later dashboard warning was traced to the local database stopping: Prisma
  logged P1017 (closed connection), then P1001 (database unreachable). Restarted
  the existing named database without resets. Authenticated reads through the
  Vite proxy returned 200 for session, four agents, the saved pending request and
  its two audit events. The database retained two users, four agents and one
  request. The reason the database process stopped was not established; no
  application-code changes or new full-suite run were part of this recovery.

- Generated a random JWT signing secret in ignored backend/.env, started the
  existing named agentshield database, and applied the three pending additive
  authentication/registration/permission migrations with migrate deploy.
- Started Express watch mode on port 3000 and Vite on strict port 5173. The
  dashboard returned HTTP 200; the proxied session API returned the expected
  unauthenticated HTTP 401. This startup check is not a new full test-suite run.
- On the user's request, provisioned the two presentation accounts and four demo
  agents in the local development database using setupDemo with generated passwords.
  Both logins succeeded through the running API; verification sessions were logged
  out afterward. Credentials were shared with the user, not written to documentation.

2026-10-10 permissions and presentation slice:

- Prisma Client generation passed. All five migrations applied to a fresh
  disposable database; migrate diff found no schema difference. A separate
  existing-agent migration check preserved its row with zero granted tools.
- Vitest/Supertest: 97/97 passed. The 17 additional cases cover owned-only listing
  for all roles, denied submission before policy/save, both policy-authorized and
  approved execution after deletion/reassignment/disable/grant removal, original
  owner checks under Manager execution, permission restoration/replay precedence,
  unowned historical refusal, strict grants and configuration CLI, repeatable demo
  fixtures, collision rollback, preserved records/password hashes, and stdin errors.
- Frontend production build passed. Headless Chrome checked separate User/Manager
  sessions, owned-agent selection and empty Manager list, approval, tampered
  amount/wrong agent, execution/reload/replay, missing grant/inactive submission,
  post-approval disable and grant removal, retained approval/no receipt on denial,
  refresh, restored permission execution, request-ID clipboard copy, auto-allow
  and policy block. Database
  receipt counts/status matched the UI; no page errors occurred. The permission
  denial and policy-block screens were visually inspected. PowerShell setup
  wrapper syntax passed; the underlying stdin CLI was integration-tested, while
  interactive hidden prompts were not automated. Temporary machine-specific scripts were
  removed after verification; browser automation is not a committed test suite.
- Verification uses disposable cached PGlite tooling, sslmode=disable,
  connection_limit=1 and pgbouncer=true. Ordinary PostgreSQL multi-connection
  lock competition remains untested. Development records were not reset or seeded;
  apply migrations and run demo setup locally with your chosen credentials.

2026-10-10 registered-agent submission checks:

- All four existing migrations applied to a fresh disposable PGlite database.
  No schema, dependency, or frontend changes were needed for this slice.
- Vitest/Supertest: 80 of 80 tests passed, including the existing 68. The 12 new
  cases verify missing/inactive agents, foreign-owner denial for User/Manager/Admin
  (including inactive foreign agents), valid owner submission, case sensitivity,
  trimmed IDs/success contracts, current status on each submission, validation
  precedence, no policy calls or records on denied submissions, and complete
  rollback after a nested save failure followed by a successful retry.
- Existing auth/review/execution tests now use registered owned-agent fixtures;
  Manager/Admin review of another user's request and all policy branches still pass.
- Verification used cached PGlite tooling with sslmode=disable, connection_limit=1,
  and pgbouncer=true. SQL row locking is implemented, but ordinary PostgreSQL
  multi-connection competition between submission and agent updates was not tested.
- The existing frontend action-error helper displays the new backend messages.
  No fresh browser check was run. Temporary machine-specific verification scripts
  were removed; development records were not reset or populated with test agents.

2026-10-10 agent registration slice:

- Prisma Client generation succeeded with the new Agent/User relationship.
- All four migrations applied using migrate deploy to a fresh disposable local
  PGlite database. Prisma migrate diff reported no schema difference.
- A separate additive-migration check preserved existing users and a refund
  request exactly; no registered agents were fabricated from historical strings.
- Vitest: 68 of 68 tests passed, including the existing 51 and 17 new registration
  tests. New cases verify normalization/default active status, explicit inactive
  status, duplicate preservation/primary-key enforcement, missing/inactive owners,
  owner foreign-key/deletion constraints, malformed input, CLI success/errors,
  useful duplicate messages, and exit codes.
- Cached PGlite verification required sslmode=disable, connection_limit=1, and
  pgbouncer=true to avoid prepared-statement collisions between separate clients.
  The tests release connections before CLI runs; ordinary PostgreSQL multi-client
  concurrency was not exercised. The first local runs exposed those test-tool
  connection limitations; the final complete run passed.
- No frontend or dependency changes were made. No new browser check was needed.
  Temporary machine-specific verification scripts were removed. This migration
  was verified in disposable databases; apply it to the development database with
  the documented migrate deploy command, without resetting records.

2026-10-10 authentication slice:

- Prisma Client generation and the frontend production build passed.
- All three committed migrations applied with migrate deploy to a new disposable
  PGlite database. Prisma migrate diff reported no schema difference.
- An independent migration check preserved a historical request and left its
  ownerId null, without assigning an invented owner.
- Vitest/Supertest: 51 of 51 tests passed, including the previous 37. New checks
  cover real login/cookie/session recovery, normalization, generic credential
  failures, password byte limits, inactive accounts, CSRF/form/cross-origin denial,
  protected endpoints, expiry, forged tokens, logout revocation, owner access,
  hidden unowned records, Manager/Admin review identity, current role downgrades,
  legacy approval refusal, and login rate limiting.
- Backend npm audit fix updated the compatible source-map-js transitive package;
  the resulting backend audit reported zero vulnerabilities.
- Headless Chrome verified User login/submission with review controls hidden,
  Manager login/lookup/approval, owner execution, reload session/receipt recovery,
  HttpOnly/SameSite cookies, and logout cookie removal/server-side revocation.
  Database records confirmed reviewer identity and one execution; no page errors
  occurred. The login screen was visually inspected.
- Cached local PGlite tooling used sslmode=disable and connection_limit=1. This
  verifies the local simulation; production PostgreSQL concurrency is not claimed.
- The new migration has been verified in disposable databases; applying it to
  an operator's development database uses the documented migrate deploy command.
- The account-provisioning command was checked with stdin passwords: normalized
  email, explicit Manager role, bcrypt cost 12, duplicate preservation, and invalid
  role refusal passed. Temporary machine-specific verification scripts were removed.

2026-10-09 execution slice:

- Prisma Client generation succeeded for the updated schema.
- Both migration SQL files applied to a fresh stateless local Prisma/PGlite test DB.
- Vitest/Supertest: 37 of 37 tests passed, including the original 24 cases.
- New cases verify auto-authorized and reviewed execution, blocked/pending/rejected
  refusal without simulator calls, amount/agent/target/currency mismatch, correction
  after denial, replay and competing executions, failure rollback/audit/retry,
  invalid execution payloads, and stable audit pagination/error handling.
- Frontend npm run build passed.
- Headless Chrome checked submission, approval, amount and actor tampering,
  execution, reload recovery, replay, auto-allow, policy block, and rejection.
  Database counts confirmed one receipt for the reviewed request and its three
  denial events. No browser page errors occurred.
- Applied migrate deploy to the existing named development database: additive
  migration completed successfully without resetting records. The DB was returned
  to its prior stopped state after migration.
- Sandbox restrictions required generation/build/local-server checks outside the
  sandbox. The in-app browser tool could not initialize; cached Playwright with
  headless Chrome provided the successful browser verification.
- Temporary machine-specific verification/migration scripts were removed.

Local test DB connections were limited to one for pooling compatibility. HTTP
competition is tested, but ordinary production PostgreSQL multi-connection
concurrency was not exercised. Row locks and unique constraints are implemented;
production security/scale guarantees are not claimed.

Historical verification: initial manual API checks and frontend integration on
2026-09-17; 12 persistence tests on 2026-09-18; 15 retrieval tests on 2026-09-19;
24 review tests earlier on 2026-10-09. Dependency audit results from those dates
are historical observations, not a fresh audit today. No dependencies changed
in the execution slice.

## 13. Remaining work

Independent agent credentials, additional tool scopes and
delegation checks, automated SMTP recovery/delivery tracking,
central OPA policy distribution/administration, optional AI classification, audit search, Docker Compose,
and committed repeatable browser automation remain planned. Approvals currently
record a decision, snapshot, and authenticated reviewer; approval expiry,
approval revocation, and cryptographic execution capabilities remain planned.
Session expiry/revocation is implemented separately from approval validity.
Agent IDs are supplied strings checked against the caller's active owned registry
entry on submission and execution, with the requested tool permission required; they do not
authenticate an independent agent process. Agent access can be withdrawn after
approval, but approval expiry/revocation itself is not implemented.

**Proposed for later decision: no-cost real agent demo.** Run a small scripted
agent as a separate local process. It would choose a predefined email or sandbox
file action, submit it to the existing gateway, and display the policy decision
and any Manager approval result. This would demonstrate an actual process calling
AgentShield without an LLM or paid AI API. The agent's choices would follow
written rules rather than model reasoning. Independent agent authentication,
least-privilege credentials, failure handling, and the exact action to demonstrate
still need design and implementation. This proposal is not part of the current
runtime; the user will decide whether to proceed later.

Password reset, public signup,
account-management UI, MFA, and shared multi-process login throttling are not
implemented. Login throttling is in memory per backend process/IP; expired session
rows are pruned on successful login. The public classroom deployment is not a
production security or operations claim.

Audit is request-scoped and append-only through app behavior. It is not an
immutable audit store, and database outages can prevent recording errors.
Execution retries are safe only for the pure simulators; SMTP reserves one attempt
and refuses resend after reservation. No real refund
adapter is part of this implementation. Public deployment is for classroom
evaluation; monitoring, operational hardening and durable file storage remain planned.

## 14. MVP acceptance targets and schedule

The approved 12-week MVP targets roles, agent scopes, a gateway, deterministic
policy, optional ambiguous-risk AI, polling approvals, three simulators, audit
search, and API/browser/security verification. Target policy evaluation includes
30-50 labeled cases; unauthorized actions and pending/rejected execution must be
refused; execution duplicates must be prevented; core role journeys must pass.
These full MVP targets are not yet all met.

Weeks 1-2: foundation/identity; 3-4: gateway/policies; 5: tools; 6: approvals;
7: audit/interfaces; 8: optional AI; 9-10: reliability; 11: evaluation/demo;
12: buffer and optional deployment. Implemented features follow the history below.

## 15. Next suitable implementation step

Refund, email and sandbox-file tools now use the shared policy,
review and execution flow. A next bounded security slice could add approval
expiry and revocation. Request/audit search remains another independent option.

## 16. Documentation maintenance

Read relevant sections before changes. Update files/functions, contracts, schema,
configuration, runtime behavior, validation/error cases, commands, limitations,
verification actually performed, and history in the same change. Do not label
planned work as implemented. Prefer small modules and straightforward JavaScript.

## 17. Source documents

`docs/PROJECT_OVERVIEW.md` provides a concise presentation-oriented record of the
implemented architecture, layers, authentication, refund flow, database, API,
verification and boundaries. It summarizes this guide; it does not add runtime
functionality. `docs/PRESENTATION_WALKTHROUGH.md` covers setup and rehearsal.
`docs/TEAM_DELIVERABLES.md` assigns four presentation parts and links individual
reading notes in `docs/presentation/`: overview/dashboard, authentication/agents,
policy/approval, and execution/storage/testing. These are speaking allocations,
not claims about historical code authorship.
`docs/TEAM_PRESENTATION_NOTES.md` combines all four reading sections into one
self-contained Markdown file for sharing with the team.
`output/AgentShield_Progress_Report.pptx` is a three-slide visual progress report
for 17 September–11 October 2026. It covers the connected architecture, current
User/Manager screens, and recorded test-suite growth. Speaker notes explain the
latest policy/queue additions, test-run qualifications, sources and remaining
scope. The architecture illustration is conceptual; screen captures use the
actual app with disposable fixtures. No application behavior changed for the deck.

AgentShield_Planning_v1.pdf was reviewed on 2026-09-17. It establishes the roles,
three simulators, stack, MVP boundaries, deterministic-policy requirement, and
12-week plan. It does not select OPA/Cedar or name an approval-bound-capability
architecture. Later approved architecture decisions must be recorded separately.

## 18. Implementation history

### 2026-11-12 — Corrected hosted login rate-limit client identification

- Added `loginRateLimitKey` to select Vercel's platform-generated client address
  in production while retaining the direct socket address locally. Passing the
  selected address through `ipKeyGenerator` preserves IPv6 grouping.
- Added `backend/test/authRateLimit.test.js` for the Vercel and local trust
  boundaries. This removes the runtime validation warnings caused by treating
  the Vercel function proxy itself as every visitor.

### 2026-11-12 — Prepared Vercel and Neon classroom deployment

- Added `api/index.js` to export the existing Express application as one Vercel
  Node.js Function without duplicating routes or authorization logic.
- Added `vercel.json` to install the frontend and backend package trees, generate
  Prisma Client, build Vite, include the checked Rego/Wasm policy assets, route
  `/api/*` to Express, and keep SPA deep links on `index.html`.
- Provisioned a Vercel-managed Neon database, applied all 10 migrations and
  created the existing documented demo accounts/agents. Configured a generated
  production JWT secret, exact application origin and simulated email mode in
  Vercel; no values were committed.
- Mapped the hosted sandbox-file demo to writable `/tmp` storage. Its database
  evidence is durable, but file contents are explicitly ephemeral across
  instances, scale-to-zero events and deployments.
- Verified the frontend build, all 72 database-free policy tests and the Vercel
  Express entry import. Live production API verification is still pending the
  deployment triggered by the next Git push.

### 2026-11-12 — Prepared the complete project for repository publication

- Extended `.gitignore` so machine-generated runtime logs, temporary chart data,
  and the local `tmp/` workspace are not published with the application source.
- Added `.gitattributes` entries that mark generated PDFs, PowerPoint files,
  JPEG evidence, and compiled OPA Wasm policies as binary. This prevents Git
  from applying text line-ending conversion or reporting meaningless whitespace
  errors inside those artifacts.
- Kept source code, migrations, compiled policy assets, documentation, and the
  progress presentation eligible for version control. Machine-local `.env`
  files, dependencies, builds, local database tools, and demo workspace remain
  ignored by the existing rules.
- Verified the React production build with `npm run build` and the three
  database-free policy suites with `npm run test:policy` (72 tests passed). A
  plain full `npm test` invocation correctly refused database suites without
  `AGENTSHIELD_TEST_DATABASE=1`, so this publication step does not claim a fresh
  full database-suite pass.

### 2026-10-29 — Simplified execution UI and clarified sandbox changes

- Removed the two developer-oriented tampering simulation buttons from the normal
  approval/execution interface while preserving backend denial logic and tests.
- Clearly labeled proposed sandbox WRITE/CHANGE content so reviewers can compare
  it with the separately loaded current file preview before approval.
- Updated README, presentation walkthrough and this guide. Runtime authorization,
  approval snapshots, replay protection and audit behavior are unchanged.

### 2026-10-29 — Email and sandbox policy customization

- Added versioned EmailPolicy and SandboxPolicy singleton tables, strict settings
  schemas, Manager/Admin GET/PUT endpoints, optimistic conflict handling, editor
  attribution, and transactionally read settings for new requests.
- Added dashboard editors for email domain behavior and sandbox paths, operation
  outcomes, and content size. Existing request snapshots remain unchanged.
- Kept the portable path schema, `workspace/` filesystem containment,
  `workspace/protected/` block, 8,000-byte hard limit, agent permissions,
  approval snapshots and execution integrity checks as non-bypassable controls.
- Updated policy/unit/integration tests, README, migration instructions and this
  guide. No dependency, SMTP credential, or public registration behavior changed.

### 2026-10-29 — Made full-stack startup the default

- Changed the root `npm run dev` command to start the existing database/API/Vite
  supervisor. This prevents the dashboard from appearing healthy while its login
  service was never started.
- Added `npm run frontend:dev` for developers who intentionally want only Vite.
  Kept `npm run demo:dev` as an alias so existing presentation instructions and
  habits continue to work. No API, policy, database schema, or dependency changed.

### 2026-10-27 — Recorded no-cost agent proposal

- Documented a possible separate scripted agent process for a classroom demo.
  It would use the existing gateway and approval flow without a paid AI API.
- Kept it explicitly proposed pending the user's decision. No implementation,
  configuration, or runtime behavior changed; see section 12.

### 2026-10-27 — Local demo service recovery

- Added a single `npm run demo:dev` monitor for the existing stateful database,
  backend and Vite processes. It checks ports, starts missing processes in order,
  caps repeated starts, and leaves already-running services alone. A periodic
  read-only query detects a database whose port is open but queries fail; the
  monitor restarts only the database child it owns.
- Mapped Prisma connection outages to a safe 503 DATABASE_UNAVAILABLE response
  with bounded warning logs. AgentPicker now retries temporary fetch failures
  and restores its selection after recovery. AuthGate also retries startup
  session checks on network/503 failures without treating them as logout. Added
  a focused mocked outage test.
- Updated README and the presentation walkthrough with the single-command demo
  startup and recovery behavior. No policy, approval, SMTP, sandbox or database
  schema rules changed.

### 2026-10-27 — External email recipients and reviewed sandbox changes

- Removed SMTP's exact-recipient enforcement. EMAIL_ALLOWED_RECIPIENTS is now
  optional and supplies demo form shortcuts only; the existing OPA blocked/internal/
  external-domain decisions, exact message snapshot, current agent checks and
  immediate Manager-approved external send remain in force.
- Added CHANGE to the strict sandbox schema and checked OPA policy as an
  approval-required operation. The real file tool verifies the approved file
  digest and replaces an existing regular file with the proposed plain text.
- Added Manager-only file-preview API and dashboard current-content preview for
  pending CHANGE/DELETE. Approval requires the preview digest, rereads the file
  and saves that digest in the snapshot; execution checks it again. Missing or
  changed files are refused. Protected and outside paths remain blocked.
- Updated UI labels, demo presets, tests, API description, README and this guide.
  Verification results are recorded in section 12.

### 2026-10-26 — Domain agents, local recipients, real files and approval send

- Filtered the dashboard agent picker by explicit domain grant. Permissionless
  demo agents remain in the registry but no longer appear in normal forms.
- Updated the ignored local SMTP allowlist to the two agreed classroom inboxes.
  No address or credential was added to tracked source files. A backend restart
  is required for the running process to read the new value.
- Added a real demo filesystem tool with contained logical paths, exclusive
  writes, bounded reads, approval-gated deletes, a durable one-attempt receipt,
  and honest UI/audit wording. The earlier simulator helper is retained for its
  existing isolated policy tests but no longer executes API actions.
- Manager approval now executes SMTP requests immediately using the saved action
  and existing one-attempt reservation. Policy-allowed SMTP still uses an explicit
  Send click. Verification results are recorded in section 12.

### 2026-10-26 — Recorded agent segregation follow-up

- Documented the requested future separation of Email, Refund and Sandbox agents
  in the shared picker, including multi-grant and permission-test considerations.
- Recorded a second, separate classroom-demo follow-up to add an agreed recipient
  to the ignored local SMTP allowlist before restarting the backend. No address or
  credential was committed, and no configuration was changed in this update.
- Recorded a third follow-up for a future real, disposable-directory Sandbox Files
  demonstration covering write, read and approval-gated delete. It remains a plan;
  the current sandbox executor is still a pure dry run and accesses no real files.
- No application behavior, API, database structure, configuration, or tests changed.

### 2026-10-23 — Separate demonstration domains in the dashboard

- Added DomainSelector.jsx with prominent Refunds, Email and Sandbox Files cards,
  explicit selection, responsive layout and per-domain headings and request forms.
- Added input-only demo presets, domain-filtered review queues, and domain alignment
  when restoring a record. Switching clears the displayed request without deleting it.
- Updated login copy to include all three domains and corrected email instructions
  for real SMTP mode. No dependencies, schema, or API behavior changed.
- Production build and mocked browser verification are recorded in section 12.

### 2026-10-21 — Sandbox-file dry-run simulator

- Added explicit SANDBOX_FILE grants, an additive enum migration, strict READ,
  WRITE and DELETE schemas, portable logical paths and bounded plain-text content.
- Added checked OPA sandbox assets: reads/writes under workspace/ are allowed,
  deletes need approval, and protected/outside paths are blocked. The shared
  pipeline retains owner/current-grant checks, exact snapshots and replay refusal.
- Added pure receipts and SANDBOX_FILE_SIMULATED audit events, with no OS file
  access or virtual file state. Extended the dashboard form, queue, review and
  receipt views, and added Demo-Sandbox to repeatable demo provisioning.
- Added policy/schema and API integration tests. Commands, errors and scope
  limits are explained in section 4; actual verification belongs in section 12.

### 2026-10-20 — Optional Gmail/SMTP delivery to configured test inboxes

- Added Nodemailer, validated server-side settings, an exact recipient allowlist,
  TLS transport, safe configuration metadata, and a no-send SMTP verification CLI.
- Added an additive migration saving mode/sender per action. Existing requests stay
  simulated; SMTP approvals include sender/mode and cannot be silently converted.
- Added a committed reservation before the SMTP call, persisted acceptance/unknown
  outcomes, and refusal to resend uncertain or crashed attempts. Acceptance does
  not claim confirmed inbox delivery; automated retries/recovery remain unimplemented.
- Updated the dashboard to show real-email intent, explicit Send Real Email,
  safe receipts, and no-send configuration failures. Added a hidden Gmail setup
  helper and SMTP integration tests with a mocked transport. Verification below
  records what actually ran; Gmail credentials/inbox delivery require local setup.

### 2026-10-12 — Email simulation scope

- Added SEND_EMAIL with explicit agent grants, strict recipient/message validation,
  compiled OPA domain rules, generic policy snapshots, shared review/execution,
  nondelivery receipts, and EMAIL_SIMULATED audit events. The additive migration
  preserves existing refund decisions and permissions.
- Added the dashboard email form, mixed-action queue, complete message review,
  and clearly labeled simulation receipts. Demo setup now includes Demo-Email.
  Email rules/settings, commands, error cases, and boundaries are explained in
  section 4; verification results belong in section 12.

### 2026-10-12 — Embedded OPA refund policy

- Replaced JavaScript amount branching with a real Rego policy compiled for
  OPA WebAssembly. Kept current database limits, approval workflow, and execution
  checks. Added checked policy assets, fail-closed errors, and engine/fingerprint
  audit metadata. New versions use opa-refund-r1-vN; existing records remain intact.
- Added reproducible build commands and focused policy/failure tests, updated
  integration expectations, and documented the request flow and validation limits.
  No database migration or external policy server was added.

### 2026-10-12 — Local login service recovery

- Restored reachable independent frontend, backend, and existing local database
  processes after browser connection failures. Removed the duplicate restricted
  Vite process, and verified session and invalid-login responses through the
  dashboard proxy. Section 12 records the checks and their limits.

### 2026-10-11 — Manager refund policy customization

- Added persisted, versioned current refund limits and Manager/Admin settings
  controls. New submissions snapshot the selected limits and policy version;
  existing requests retain their original rules.
- Added strict bounds, CSRF/role enforcement, and stale-edit conflict handling.
  The additive migration creates only the policy configuration table. No new
  dependencies were added. Validation results are recorded in section 12.

### 2026-10-11 — Independent database process recovery

- Preferred the cached tooling's ESM entry point in the local launcher. Started
  the database independently through Windows process management after another
  outage, initialized the available store, and reprovisioned the two demo accounts
  and four agents. Verification and the missing earlier history are recorded in
  section 12.

### 2026-10-11 — Reliable local database launcher

- Added a cached-tooling database command that keeps the local server launcher
  alive and preserves demo data. Explained database-related agent-loading errors
  in the picker. Verified dropdown opening and selection in the browser.

### 2026-10-11 — Automatic manager review queue

- Added a role-protected pending-request endpoint and a manager queue that polls
  every four seconds. Managers select incoming requests instead of copying IDs.
- Replaced the manager submission form with the review queue; retained existing
  approval, rejection, execution integrity checks, audit details, and user polling.
- Added integration coverage for authentication, roles, filtering, review removal,
  safe owner fields, ordering, and the 100-request bound. No dependencies or
  database schema changes were needed.

### 2026-10-11 — Local demo account maintenance

- Restored the existing local database and dev servers, changed the two demo
  account passwords at the operator's request, and revoked their previous
  sessions. Existing account roles, agents, and refund records were retained.
- Verified both new passwords through the dashboard API proxy; see section 12.

### 2026-10-10 — Tool permissions, execution rechecks, and presentation journey

- Added default-empty Agent.allowedTools and its additive migration; require
  explicit REFUND on submission and current registry access during execution.
- Added shared agent locks/access checks, trusted configuration CLI, owned-agent
  GET endpoint, and dashboard selection/status/permissions/refresh/empty states.
- Added repeatable transactional demo setup with hidden stdin password prompts,
  preserved accounts/requests, fixture collision rollback, and a presentation guide.
- Added 17 backend cases; all 97 passed. Migration/schema agreement and frontend
  build passed. Section 12 records browser checks and concurrency limitations.

### 2026-10-10 — Enforce registered agent ownership on refund submission

- Added submitRefundRequest to lock/read the registered agent and require the
  authenticated caller to own an active entry before policy evaluation or saving.
- Added explicit 403 registry-denial errors for all roles. Denied submissions
  create no request, policy, approval, execution, or request-scoped audit rows.
- Passed the transaction client into createActionRecord, preserving nested saves
  and rolling back all writes on failure. Preserved successful API response fields.
- Updated owned-agent fixtures and added 12 API/database tests; all 80 passed.
- Updated request flow, error contracts, setup, limitations, and verification.
  Execution-time registry checks, agent credentials, and tool scopes remain planned.

### 2026-10-10 — Local agent registry and registration command

- Added Agent with a unique caller-chosen ID, name, required User owner,
  active/inactive flag, and timestamps, plus an additive migration and owner index.
- Added agentRegistrationSchema, registerAgent, and npm run agent:register.
  Validate inputs, require an existing active owner, and refuse duplicate IDs
  without updating prior registrations. No new dependencies or API routes.
- Added 17 registration/database/CLI tests and sequential file execution for
  shared disposable-database cleanup. All 68 backend tests passed.
- Verified migration preservation and schema agreement. Kept action-time
  agent identity checks, tool scopes, and registry-management UI explicitly planned.
- Updated setup instructions, limits, error cases, and verification record.

### 2026-10-10 — JWT login, revocable sessions, roles, and owner access

- Added User/UserRole/AuthSession, nullable owner/reviewer relationships, and an
  additive migration preserving historical requests and reviews.
- Added bcryptjs hashing, JWT verification with fixed HS256/issuer/audience,
  30-minute HTTP-only cookies, database expiry/revocation, and current role checks.
- Added login/me/logout routes, login throttling, custom-header/origin login
  protection, session-bound CSRF checks, and local account provisioning from stdin.
- Protected all action endpoints, restricted User access to owned requests,
  required Manager/Admin reviews, and saved reviewer identity in records/audits.
- Refused legacy approvals without reviewer identity. Kept agent IDs self-reported.
- Added login/logout UI, role-aware reviews, user-scoped saved selection, session
  restoration, and API-401 handling. Updated environment/setup documentation.
- Passed migration/schema checks, 51 API/database tests, browser role journeys, frontend build, and
  dependency audit. Verification details and limitations are recorded in section 12.

### 2026-10-09 — Backend refund execution, snapshots, audit, dashboard recovery

- Added ApprovalRecord, ExecutionRecord, AuditEvent and an additive migration.
- Bound reviews to stored snapshots and serialized reviews/execution with row locks.
- Added execute and paginated audit routes, strict execution validation, a pure
  refund simulator, integrity checks, replay denial, and failure rollback/audit.
- Added atomic request/review/execution audit writes and a unique execution per request.
- Replaced browser-only execution with API calls; added saved-ID recovery, lookup,
  selected-request polling, persistent audit display, and mutation error handling.
- Preserved local-demo scope: no manager authentication, real payments, or new tools.
- Passed 37 API/database tests and Chrome workflow checks; applied the migration
  to the existing development DB. Verification details are in section 12.


### 2026-10-09 — Persist pending-action reviews and begin folder walkthrough

- Added POST `/api/actions/:id/review`, strict body validation, and a conditional
  database update from PENDING_APPROVAL to APPROVED or REJECTED.
- Added invalid-input, unknown-ID, state-conflict, and competing-review tests.
- Connected the dashboard approval/rejection buttons to the API. Local approval
  records are created only after a successful backend save.
- Kept reviewer authorization, approval records, execution, and audit persistence
  explicitly outside this slice; this endpoint remains a local demo.
- Added `src/services/actions.js` for the review HTTP call and
  `docs/FOLDER_WALKTHROUGH.md` for a student-friendly folder map and request trace.
- Verification results are recorded in section 10.

### 2026-09-19 — Retrieve a persisted action by ID

- Added `GET /api/actions/:id` without changing the existing POST contract.
- Added Zod UUID validation for the route parameter.
- Added a repository lookup that includes the one-to-one policy decision.
- Added explicit HTTP 400 and 404 responses for malformed and unknown IDs.
- Returned the stored action, current status, policy version, policy limits,
  decision time, and request timestamps.
- Added three API/database tests and moved database lifecycle hooks to the
  shared suite level.
- Restarted the stopped isolated development database and verified all 15
  tests pass.

### 2026-09-18 — PostgreSQL and Prisma request persistence

- Added Prisma Client, Prisma CLI, dotenv, a PostgreSQL schema, and an initial
  migration.
- Added `ActionRequest` and one-to-one `PolicyDecision` models with UUID keys,
  enums, JSONB arguments, timestamps, indexes, and a cascading foreign key.
- Added a shared Prisma client and a small action repository.
- Changed `POST /api/actions` to persist the request and decision atomically and
  return the database UUID and timestamp.
- Extended API tests to verify the stored request, decision, limits, and
  `refund-v1` policy version.
- Applied the initial migration and verified all 12 tests pass against an
  isolated local database.
- Diagnosed a prepared-statement collision in the local pooled development
  database and added `pgbouncer=true` only to the ignored machine-local URL.
- Verified the standalone Express server persists a request successfully and
  that the migration status is current.
- Pinned Prisma and Prisma Client to 6.12.0 after audits of newer installed
  versions reported high-severity transitive dependency advisories.
- Confirmed the final npm audit reports zero vulnerabilities.

### 2026-09-18 — Automated backend API tests

- Added Vitest and Supertest as backend development dependencies.
- Added separate one-run and watch-mode test commands.
- Added a Node-specific backend Vitest configuration.
- Added 12 API tests covering normal decisions, exact boundaries, invalid
  requests, unsupported values, response fields, and malformed JSON.
- Verified all 12 tests pass.
- Upgraded Vitest from version 3 to 5 after npm reported a moderate advisory in
  the test-only dependency tree.
- Verified the final backend dependency audit reports zero vulnerabilities.

### 2026-09-17 — Frontend-to-backend policy integration

- Replaced the browser-side refund policy evaluation with an HTTP POST to
  `POST /api/actions`.
- Added Vite's local `/api` proxy to the Express server on port 3000.
- Added submitting, evaluating, and API-error UI states.
- Added a response-shape guard so an incomplete or outdated API response shows
  an error instead of crashing the React page.
- Made backend-returned policy limits read-only in the dashboard.
- Added the temporary backend request UUID to the policy decision display.
- Removed the unused duplicate frontend policy evaluator.
- Kept approval and execution behaviour local for this intentionally small
  integration slice.

### 2026-09-17 — Planning document alignment

- Corrected the domain description to email, refund, and sandbox-file
  simulators.
- Added the user, manager, and admin roles.
- Recorded the exact MVP inclusions and exclusions.
- Recorded the complete selected stack, polling approach, testing tools, and
  Docker Compose plan.
- Clarified that planning v1 specifies deterministic policies but does not
  select OPA or Cedar.
- Added the official action-state model, AI fail-safe rule, quality criteria,
  and 12-week implementation plan.

### 2026-09-17 — Backend policy API

- Added a JavaScript Node.js and Express backend.
- Added `POST /api/actions`.
- Added Zod validation for refund requests.
- Added deterministic refund-policy decisions.
- Added structured HTTP 400 and HTTP 500 error responses.
- Installed Express and Zod.
- Verified the three policy branches and invalid-input handling manually.

### Earlier prototype — React demonstration

- Built the React, Vite, and Material UI dashboard.
- Added a configurable frontend refund policy, which was later replaced by the
  backend-controlled policy during API integration.
- Added simulated approval, rejection, verification, execution, replay
  detection, identity mismatch detection, and an in-memory audit log.
