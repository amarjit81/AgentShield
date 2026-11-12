# Part 2 — Avnish: Authentication, Roles and Agent Permissions

**Speaking time:** About 2 minutes, after the project overview.
**Your responsibility:** Explain who is calling the system and whether their
agent is permitted to request a refund.

## Content to read and explain

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

## Your demo moment

Show Demo-NoRefund: active but without REFUND permission. Submit a refund and
show the denial. Then show Demo-Disabled and its inactive-agent denial. These
are access failures, separate from the amount policy Deepanjan will explain.

## Questions to prepare for

- **Why store sessions if we use JWT?** To support immediate logout/revocation and
  current user checks; token validity alone does not grant access.
- **Can an Admin submit through anyone's agent?** No. Submission still requires
  ownership. Admin review/access privileges are separate.

**Code to recognize:** `authService.js`, `authRoutes.js`, `agentService.js`,
`agentSchema.js`, `agentRoutes.js`, `AuthGate.jsx`, and `AgentPicker.jsx`.

**Handoff:** “Once identity and agent permission are verified, Deepanjan will
explain how policy decides whether the refund needs approval.”
