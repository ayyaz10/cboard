# Enable Banking AIS setup

CBoard calls Enable Banking from the `banking` Supabase Edge Function. The function owns the RSA signing key, authorization callback, session identifiers, account identifiers, and raw provider transaction responses. Finance gets safe transaction projections from the authenticated function. There are no payment initiation endpoints or browser-held Enable Banking secrets.

## Apply and deploy

1. Apply `supabase/migrations/202610070001_bank_connections.sql` to the Supabase project.
2. Register an Enable Banking application and deploy the `banking` Edge Function.
3. Set the server-side values below with Supabase Function Secrets. Keep the PEM as a PEM string; escaped `\n` line breaks are accepted.
4. Set the exact callback URL as an allowed redirect URL in Enable Banking and set `APP_ORIGIN` to the CBoard origin.
5. Set `ENABLE_BANKING_ENVIRONMENT=SANDBOX` first.

The bank picker obtains the current Enable Banking list using country `GB`, PSU type `personal`, and service `AIS`. Consent requests ask only for transactions and balances. The requested validity is capped at the maximum returned for that selected bank.

## Server secrets

| Name | Value |
| --- | --- |
| `ENABLE_BANKING_APP_ID` | Enable Banking application ID / JWT `kid` |
| `ENABLE_BANKING_PRIVATE_KEY` | Application's RSA private PEM key |
| `ENABLE_BANKING_ENVIRONMENT` | `SANDBOX` or `PRODUCTION`; this must match the registered application |
| `ENABLE_BANKING_REDIRECT_URI` | `https://<project-ref>.supabase.co/functions/v1/banking/callback` |
| `APP_ORIGIN` | CBoard HTTPS origin (no path) |
| `APP_BASE_PATH` | Vite app base path; this repository uses `/cboard/` |
| `BANKING_ALLOWED_USER_EMAIL` | Email address of the single CBoard account allowed to use bank connections |

The Enable Banking API host stays `https://api.enablebanking.com` in both environments; the registered application and its credentials determine Sandbox or Production. Supabase's standard `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are also required at runtime.

## Sync behavior

- Opening Finance syncs connected accounts whose last successful sync is older than six hours. User can also select **Sync now**.
- There is no existing server scheduler in this project. Automatic background sync while CBoard is closed is not configured; browser/PWA background execution is not reliable enough to promise it.
- Each account uses a 30-day overlapping transaction window, follows every continuation key (including empty pages), and stops safely on repeated keys or after 100 pages.
- `entry_reference` is the primary transaction identity. `transaction_id` is retained as changeable detail only. Missing-reference fallback identity needs amount, currency, direction, a counterparty, and a date; ambiguous records are skipped.
- Pending and hold transactions remain visible but do not affect Finance totals, monthly allocation income bases, or income-triggered allocations. A booked credit triggers existing income allocations once. A pending-to-booked record without a stable reference is reconciled only when exactly one pending record matches amount, currency, direction, counterparty, and a date within three days.
- Deleting a bank-synced Finance transaction hides it in the provider link table; the next sync does not restore it. Restore it from Bank Connections.
- Disconnect closes the provider session when possible and stops sync. Imported Finance history remains.

## Sandbox checklist

1. In Control Panel, create a **SANDBOX** API application. Its certificate/key is application-specific; keep the downloaded RSA private key server-side.
2. Add the exact Supabase callback URL to the application's redirect URLs.
3. Set the five Enable Banking/app secrets above, with `ENABLE_BANKING_ENVIRONMENT=SANDBOX`.
4. Apply the migration and deploy the function; sign into CBoard and use **Finance → Bank Connections**.
5. Select a GB personal AIS Sandbox bank, authorize it, then verify accounts, balances, transaction pagination, repeat sync, category editing, hide/restore, and disconnect/reconnect.

Sandbox and Production applications are separate; a Sandbox application cannot be converted to Production.

## Restricted Production checklist for own NatWest account

1. Register a separate **PRODUCTION** API application in Enable Banking Control Panel; choose Enable Banking authorization, provide application description, data-protection email, privacy-policy URL, and terms-of-service URL as requested by the panel.
2. Add the same exact HTTPS callback URL to that application's redirect URL allow-list. This server-to-server integration does not require a browser origin allow-list.
3. Keep the Production private RSA key on the server. Set the Production app ID, private key, and `ENABLE_BANKING_ENVIRONMENT=PRODUCTION` in Supabase secrets.
4. Use the Control Panel's **Activate by linking accounts** flow to whitelist your own NatWest account for restricted use. Complete that linking flow; it activates restricted production evaluation for the linked account. The API connection still runs the normal `/auth` and `/sessions` flow.
5. Connect NatWest from CBoard and verify the account, balances, recent transactions, status fields, and repeat sync. Do not treat Sandbox evidence as proof of NatWest Production behavior.

Restricted mode is for internal evaluation on whitelisted accounts. Public multi-user production use requires the separate Enable Banking agreements/activation applicable to that use.

This CBoard deployment is configured for the operator's personal use only. The banking Edge Function checks the signed-in email against `BANKING_ALLOWED_USER_EMAIL` and rejects every other account before handling bank requests. Keep this secret set to the operator's own CBoard sign-in email.
