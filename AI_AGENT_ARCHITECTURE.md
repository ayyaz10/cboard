# Future AI agent architecture

C Board's AI features should remain `React → Supabase Edge Function → model/provider → validated Supabase operation`. The browser may request an action, but it must never hold provider keys, service credentials, or permission to bypass row-level security.

## Gemini account and secret

The Google AI Studio account used to create and manage the Gemini API key is `ayyazahmed004@gmail.com`.

Store the key only as the Supabase Edge Function secret named `GEMINI_API_KEY`. The email identifies the owning account for maintenance; it is not an API credential and must not be used by the React client. Never add the API key itself to this file or commit it to Git.

## Safe action model

Future agents should use a small registry of named actions such as `finance.transaction.draft`, `recipe.create`, or `reminder.create`. Each action needs:

- an explicit input schema and maximum payload size;
- authenticated user identity derived on the server;
- an authorization check for the specific resource;
- server-side validation before and after any model call;
- an idempotency key for writes;
- a preview result for any destructive, financial, external, or bulk action;
- explicit user confirmation before committing those actions;
- a concise audit event containing the action name, user ID, timestamp, outcome, and affected record IDs, without secrets or full sensitive prompts;
- rate and cost limits enforced atomically in PostgreSQL.

Never give a model arbitrary SQL, unrestricted HTTP access, raw Supabase clients, browser control, or a generic “execute code” tool. Tool arguments and model output are untrusted. The Edge Function must construct every database payload from approved fields and rely on RLS as a second boundary.

## Suggested lifecycle

1. The React client submits a plain-language request.
2. An authenticated Edge Function selects only allowlisted read tools needed to form a proposal.
3. The model returns a strict action plan schema, with no direct side effects.
4. Server code validates permissions, values, record ownership, limits, and conflicts.
5. React displays a human-readable preview.
6. The user confirms actions that spend money, delete or overwrite data, contact another person, publish content, or affect multiple records.
7. A separate commit request uses a short-lived proposal ID and idempotency key. Server code executes fixed application functions, then records an audit event.

The recipe parser is the first narrow example: it accepts one bounded input, has no tools, produces one strict shape, is independently validated, uses the caller's RLS context, and enforces a daily allowance. Keep later agent features equally narrow until the action registry, proposal store, confirmations, and audit log are implemented.
