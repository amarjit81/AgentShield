# Part 1 — You: Project Overview, Architecture and Dashboard

**Speaking time:** About 2 minutes. You open the presentation.
**Your responsibility:** Explain the problem, connect the main components, and
introduce the working interface. This is a presentation allocation, not a claim
about who originally wrote each feature.

## Content to read and explain

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

## Your demo moment

Show the logged-in User dashboard and point out agent selection, amount, saved
status and audit. Explain the architecture before handing over; leave policy
examples and execution attacks to the later speakers.

## Questions to prepare for

- **Is this connected to a real AI agent?** The current dashboard submits requests
  using registered agent identifiers under an authenticated user session.
  Independent agent credentials and integration with other AI apps are future work.
- **Why have a backend?** It enforces permissions and rules and persists records;
  the frontend displays results and initiates requests.

**Code to recognize:** `src/App.jsx`, `src/components/`, `src/services/`,
`backend/src/app.js`, and `backend/src/routes/`.

**Handoff:** “Avnish will explain how we authenticate users and decide which
registered agents they are allowed to use.”
