# AgentShield presentation walkthrough

Plan about 7 minutes. AgentShield is a working local refund gateway: authenticated
users request refunds through registered agents, Managers review larger amounts,
and the backend verifies permission and exact approved details before a simulator
records a receipt. No money moves.

## Prepare once

On the configured Windows demo machine, run `npm run demo:dev` at the project
root and keep that terminal open throughout the presentation. It starts or reuses
the existing database, backend, and frontend and checks for stopped processes
every five seconds, plus a read-only database query every 30 seconds. A database
process started by the monitor is restarted if it stops answering. It does not
reset data. The separate-terminal commands below
remain available. If agents fail to load during a temporary outage, the dashboard
retries automatically after the database returns; Refresh agents is also available.

1. Start PostgreSQL. In `backend/.env`, set DATABASE_URL, JWT_SECRET (a random
   value of at least 32 bytes), and APP_ORIGIN=http://localhost:5173. Use
   `.env.example` for the format. Generate a secret with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
   ```

2. From the backend directory:

   ```powershell
   npm install
   npm run prisma:generate
   npx prisma migrate deploy
   .\scripts\setup-demo.ps1
   npm start
   ```

   Setup asks for your own USER and MANAGER passwords through hidden prompts.
   Each needs at least 12 characters and at most 72 UTF-8 bytes. Remember them.
   The wrapper sends JSON to `npm run demo:setup` on stdin; no default password
   is supplied. If your shell policy prevents this local script, use an allowed
   PowerShell session under your machine's policy.

3. In a second terminal at the repository root:

   ```powershell
   npm install
   npm run dev -- --port 5173 --strictPort
   ```

4. Open http://localhost:5173 in a normal window for user@agentshield.test and
   an incognito window or separate browser profile for manager@agentshield.test.
   Use the passwords you chose. Two ordinary tabs share the same login cookie;
   separate browser contexts keep the two accounts independent.

The USER has four agents. The Manager intentionally has none and sees incoming
pending requests in an automatically refreshed review queue. Repeat setup using the same passwords to restore the four
demo agents. It retains saved refunds and existing password hashes. A conflicting
account password/role/status or agent owner fails with no committed setup changes.
It does not configure environment variables, migrate, or erase other records.

## Main journey

Before the main journey, show Customize refund policy on the Manager dashboard.
Defaults are INR 5,000 auto approval and INR 20,000 maximum. Save different limits
to demonstrate customization, then restore these defaults before the INR 8,000
example below. Changes apply only to requests submitted after saving; existing
requests retain the limits and version captured when submitted.

1. **Identity and permission:** As USER select Demo-Refund. Point out its Active
   status and REFUND grant. Explain that the backend requires an owned registered
   agent and explicit permission, regardless of the caller's role.
2. **Policy:** Submit INR 8,000. Show REQUIRE_APPROVAL and PENDING_APPROVAL. Rules
   allow up to INR 5,000 automatically, require review through INR 20,000, and
   block larger amounts. The dashboard cannot edit those limits.
3. **Review:** In the Manager window, wait up to four seconds for the request to
   appear under Pending refund requests. Click Review on its row, then Approve.
   Show the saved amount and
   reviewer identity. The USER window picks up the approval through polling.
4. **Integrity:** Explain that changed details and wrong-agent execution remain
   denied by the backend and covered by automated API tests. These developer-only
   simulation controls are intentionally absent from the normal dashboard.
5. **Execution:** Press Execute Approved Refund. Show the simulated receipt and
   EXECUTED status. Reload; the session, saved selection, receipt and audit recover.
6. **Replay:** Press Simulate Replay Attempt. Show the refusal and original receipt.
   The backend permits only one execution record for each request ID.

Reset Demo clears the current selection only; it never deletes database records.
Changing the agent dropdown affects new submissions, while saved requests execute
using their own stored agent. Copy errors show a manual-copy fallback.

## Permission can change after approval

1. Select Demo-NoRefund and submit INR 8,000: TOOL_NOT_ALLOWED. It is active but
   lacks REFUND permission. No new request is saved. Select Demo-Disabled and
   submit: AGENT_INACTIVE.
2. Select Demo-Revocable, submit INR 8,000, and approve its new ID as Manager.
3. In a third terminal inside backend, disable it:

   ```powershell
   npm run agent:configure -- Demo-Revocable inactive REFUND
   ```

4. Execute the approved request as USER. It is denied, with no receipt and an
   audit event. Approval remains saved, but current agent access is required.
5. Optionally demonstrate removing just the grant:

   ```powershell
   npm run agent:configure -- Demo-Revocable active none
   ```

   Execute again: TOOL_NOT_ALLOWED. Press Refresh agents to show current settings.
6. Restore permission and execute the matching approved request successfully:

   ```powershell
   npm run agent:configure -- Demo-Revocable active REFUND
   ```

These commands are local operator controls with database access, not public HTTP
endpoints. Execution checks the original request owner's agent even if a Manager
performs execution. Registry changes cannot produce a second receipt after execution.

## Optional short checks

- Demo-Refund, INR 2,000: policy allows and the dashboard automatically calls
  backend execution. Show the receipt.
- Demo-Refund, INR 25,000: BLOCKED, no execution control.
- A new INR 8,000 request rejected by Manager: REJECTED, cannot execute.

## Explain what is complete

React/Material UI dashboard; Express/Zod validation; PostgreSQL/Prisma storage;
bcrypt passwords, JWT HttpOnly cookies, revocable sessions and CSRF protection;
User ownership and Manager/Admin review roles; agent registration and explicit
REFUND grants; deterministic policy; bound approval snapshots; current permission
rechecks; tampering/replay refusal; simulated receipts; persistent audit; request
polling and recovery. The final backend suite passed 97 tests, the frontend build
passed, and the main two-account browser journey was verified against a disposable
database. See IMPLEMENTATION_GUIDE.md for the verification detail.

Be precise about boundaries: this is a local simulator, with no payment provider,
email/file tools, independent agent credentials, approval expiry/revocation, AI
classifier, audit search, or production deployment. Agent IDs are identifiers under
authenticated user sessions. Audit is append-only through the API, not immutable
against database administration. Ordinary production PostgreSQL multi-connection
lock competition has not been tested. Restoring agent access enables retry; it
does not create a new approval or revoke the existing one.

## Before presenting

- Rehearse with both browser contexts. Copying the ID manually is always possible.
- If login says the origin is forbidden, align APP_ORIGIN and the exact Vite URL,
  then restart backend. The fixed-port command prevents silent port switching.
- If the session expires after 30 minutes, log in again and load the saved ID.
- If an older registered agent lacks permission after migration, explicitly grant
  it with `agent:configure -- <id> active REFUND`; no automatic grants are made.
- No agents in the Manager window is expected. An empty USER list usually means
  setup was run against a different database or with another account logged in.
- A denied new submission may leave the previous saved request visible. Confirm
  its ID and agent before describing the display as a newly saved request.
