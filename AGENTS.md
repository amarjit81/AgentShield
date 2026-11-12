# AgentShield repository instructions

## Living documentation requirement

`docs/IMPLEMENTATION_GUIDE.md` is the project's living technical record.

Whenever code, dependencies, API behaviour, database structure, configuration,
or runtime behaviour changes:

1. Read the relevant section of `docs/IMPLEMENTATION_GUIDE.md` before editing.
2. Update the guide in the same change as the implementation.
3. Explain new files, functions, important decisions, request flows, validation,
   error cases, and commands in student-friendly language.
4. Update the implementation history and verification record.
5. Do not describe planned functionality as already implemented.

The project must remain understandable to team members. Prefer small modules,
clear names, and straightforward JavaScript over unnecessary abstractions.
