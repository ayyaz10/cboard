create table if not exists public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'enable_banking'),
  aspsp_name text not null,
  country text not null,
  psu_type text not null default 'personal',
  session_id text,
  consent_valid_until timestamptz,
  status text not null default 'connected' check (status in ('pending','connected','reconnect_required','expired','error','disconnected')),
  environment text not null check (environment in ('SANDBOX','PRODUCTION')),
  connected_at timestamptz not null default now(),
  last_successful_sync_at timestamptz,
  last_sync_attempt_at timestamptz,
  last_error text,
  sync_lock_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.bank_connections(id) on delete cascade,
  provider_account_id text not null,
  provider_account_uid text,
  identification_hash text,
  display_name text not null default 'Bank account',
  currency text,
  account_type text,
  masked_identification text,
  active boolean not null default true,
  last_balance jsonb,
  balance_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (connection_id, provider_account_id)
);

create table if not exists public.bank_authorization_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  aspsp_name text not null,
  country text not null,
  environment text not null check (environment in ('SANDBOX','PRODUCTION')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.bank_connections(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  provider_account_id text not null,
  entry_reference text,
  provider_transaction_id text,
  fallback_fingerprint text,
  transaction jsonb not null,
  status text not null default 'BOOK',
  hidden_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, provider_account_id, entry_reference)
);

create unique index if not exists bank_transactions_fallback_unique
  on public.bank_transactions(user_id, provider_account_id, fallback_fingerprint)
  where entry_reference is null and fallback_fingerprint is not null;
create index if not exists bank_transactions_user_connection_idx
  on public.bank_transactions(user_id, connection_id);

alter table public.bank_connections enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.bank_authorization_states enable row level security;
alter table public.bank_transactions enable row level security;

-- These records include remote session identifiers and sensitive bank activity.
-- Access is intentionally limited to the Edge Function service role.
revoke all on public.bank_connections, public.bank_accounts, public.bank_authorization_states, public.bank_transactions from anon, authenticated;
grant all on public.bank_connections, public.bank_accounts, public.bank_authorization_states, public.bank_transactions to service_role;

