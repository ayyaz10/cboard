const API = 'https://api.enablebanking.com';

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const enc = value => new TextEncoder().encode(value);

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function derLength(length) {
  if (length < 128) return new Uint8Array([length]);
  const bytes = [];
  while (length) { bytes.unshift(length & 255); length >>>= 8; }
  return new Uint8Array([128 | bytes.length, ...bytes]);
}
function der(tag, content) { return new Uint8Array([tag, ...derLength(content.length), ...content]); }
function pkcs1ToPkcs8(pkcs1) {
  const rsaOid = new Uint8Array([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00]);
  return der(0x30, new Uint8Array([...der(0x02, new Uint8Array([0])), ...rsaOid, ...der(0x04, pkcs1)]));
}

async function signingKey(pem) {
  pem = String(pem).replace(/\\n/g, '\n');
  const match = pem.match(/-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (?:RSA )?PRIVATE KEY-----/);
  if (!match) throw new Error('Enable Banking private key must be a PEM RSA private key.');
  const binary = Uint8Array.from(atob(match[2].replace(/\s/g, '')), c => c.charCodeAt(0));
  const pkcs8 = match[1] ? pkcs1ToPkcs8(binary) : binary;
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

function configuration(env) {
  const appId = env('ENABLE_BANKING_APP_ID');
  const privateKey = env('ENABLE_BANKING_PRIVATE_KEY');
  const environment = (env('ENABLE_BANKING_ENVIRONMENT') || 'SANDBOX').toUpperCase();
  const redirectUrl = env('ENABLE_BANKING_REDIRECT_URI');
  if (!appId || !privateKey || !redirectUrl) throw new Error('Enable Banking server configuration is incomplete.');
  if (!['SANDBOX', 'PRODUCTION'].includes(environment)) throw new Error('ENABLE_BANKING_ENVIRONMENT must be SANDBOX or PRODUCTION.');
  const redirect = new URL(redirectUrl);
  if (redirect.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(redirect.hostname)) throw new Error('Enable Banking callback URL must use HTTPS.');
  return { appId, privateKey, environment, redirectUrl };
}

async function jwt(config) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: config.appId })));
  const payload = b64url(enc(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 })));
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(config.privateKey), enc(input));
  return `${input}.${b64url(signature)}`;
}

async function providerRequest(config, path, { method = 'GET', body, signal } = {}, fetchImpl = fetch) {
  const token = await jwt(config);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await fetchImpl(`${API}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: signal || AbortSignal.timeout(15000),
      });
      if (result.ok) return await result.json();
      const retryAfter = Number(result.headers.get('retry-after'));
      if (![408, 429].includes(result.status) && result.status < 500) throw Object.assign(new Error('Enable Banking rejected the request.'), { status: result.status });
      if (attempt === 2) throw Object.assign(new Error('Enable Banking is temporarily unavailable.'), { status: result.status });
      const delay = Math.min(8000, (retryAfter > 0 ? retryAfter * 1000 : 500 * (2 ** attempt)) + Math.random() * 250);
      await new Promise(resolve => setTimeout(resolve, delay));
    } catch (error) {
      if (error.status || attempt === 2) throw error;
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, Math.min(8000, 500 * (2 ** attempt) + Math.random() * 250)));
    }
  }
  throw lastError || new Error('Enable Banking request failed.');
}

function maskedId(account) {
  const value = account.account_id?.iban || account.account_id?.identification || account.account_id?.other?.identification;
  return value ? `••••${String(value).slice(-4)}` : null;
}

export function transactionIdentity(tx) {
  const amount = tx.transaction_amount;
  if (tx.entry_reference) return { entryReference: String(tx.entry_reference), fallback: null };
  // Fallback includes merchant/remittance/date and amount. It intentionally refuses to
  // deduplicate by amount/date alone when provider context is missing.
  const party = tx.creditor?.name || tx.debtor?.name || '';
  const remittance = (tx.remittance_information || []).join('|');
  const reference = tx.reference_number || '';
  // Without an entry_reference, require explicit remittance/reference evidence as
  // well as a counterparty; merchant, amount, and date alone can be two purchases.
  if (!amount?.amount || !amount?.currency || !party || (!remittance && !reference) || (!tx.transaction_date && !tx.booking_date)) return { entryReference: null, fallback: null };
  return { entryReference: null, fallback: [amount.amount, amount.currency, tx.credit_debit_indicator, tx.transaction_date || '', tx.booking_date || '', party.trim().toLowerCase(), reference.trim().toLowerCase(), remittance.trim().toLowerCase()].join('|') };
}

export function pendingBookingMatch(pending, booked) {
  if (!['PDNG', 'HOLD'].includes(String(pending.status || '').toUpperCase()) || String(booked.status || '').toUpperCase() !== 'BOOK') return false;
  const a = pending.transaction || {}, b = booked;
  const aa = a.transaction_amount || {}, ba = b.transaction_amount || {};
  const party = tx => (tx.creditor?.name || tx.debtor?.name || '').trim().toLowerCase();
  if (!party(a) || party(a) !== party(b) || aa.amount !== ba.amount || aa.currency !== ba.currency || a.credit_debit_indicator !== b.credit_debit_indicator) return false;
  const ad = Date.parse(`${a.transaction_date || a.booking_date || ''}T00:00:00Z`);
  const bd = Date.parse(`${b.transaction_date || b.booking_date || ''}T00:00:00Z`);
  return Number.isFinite(ad) && Number.isFinite(bd) && Math.abs(ad - bd) <= 3 * 86400000;
}

function comparableTransaction(transaction) {
  const copy = structuredClone(transaction || {});
  delete copy.transaction_id;
  const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
  return JSON.stringify(sort(copy));
}

export function transactionProjection(row) {
  const tx = row.transaction || {};
  const amount = tx.transaction_amount || {};
  const status = tx.status || row.status || 'OTHR';
  const date = tx.booking_date || tx.transaction_date || tx.value_date || new Date().toISOString().slice(0, 10);
  const counterparty = tx.credit_debit_indicator === 'CRDT' ? tx.debtor?.name : tx.creditor?.name;
  const name = counterparty || tx.note || tx.remittance_information?.[0] || 'Bank transaction';
  const numeric = Math.round(Math.abs(Number(amount.amount)) * 100);
  if (!Number.isSafeInteger(numeric) || numeric <= 0 || !['CRDT', 'DBIT'].includes(tx.credit_debit_indicator)) return null;
  return {
    id: `bank-${row.id}`, title: String(name).slice(0, 100), amount: numeric,
    type: tx.credit_debit_indicator === 'CRDT' ? 'income' : 'expense', date,
    note: '', paymentMethod: '',
    createdAt: row.created_at, updatedAt: row.last_synced_at, sequence: 0,
    source: 'bank', provider: 'enable_banking', bankConnectionId: row.connection_id,
    bankAccountId: row.bank_account_id, providerEntryReference: row.entry_reference,
    providerTransactionId: tx.transaction_id || null, providerStatus: status,
    providerAmount: numeric, providerCurrency: amount.currency || null,
    bankMetadata: { bookingDate: tx.booking_date || null, transactionDate: tx.transaction_date || null, valueDate: tx.value_date || null, merchantCategoryCode: tx.merchant_category_code || null, referenceNumber: tx.reference_number || null },
  };
}

export function createBankingHandler({ createClient, env = key => Deno.env.get(key), fetchImpl = fetch }) {
  return async request => {
    const origin = request.headers.get('origin');
    const allowedOrigin = env('APP_ORIGIN');
    const cors = { 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, GET, OPTIONS', ...(allowedOrigin && origin === allowedOrigin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) };
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });

    const url = new URL(request.url);
    if (url.pathname.endsWith('/callback')) return callback(request, cors);
    if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' }, cors);

    let body;
    try { body = await request.json(); } catch { return response(400, { error: 'Invalid request.' }, cors); }
    const authHeader = request.headers.get('authorization') || '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '');
    if (!bearer) return response(401, { error: 'Sign in to use bank connections.' }, cors);

    let userClient, admin;
    try {
      userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false } });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) return response(401, { error: 'Sign in to use bank connections.' }, cors);
      admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
      const config = configuration(env);
      switch (body.action) {
        case 'aspsps': return response(200, await providerRequest(config, `/aspsps?${new URLSearchParams({ country: 'GB', psu_type: 'personal', service: 'AIS' })}`, {}, fetchImpl), cors);
        case 'start': return response(200, await startAuthorization({ admin, userId: user.id, body, config, fetchImpl }), cors);
        case 'list': return response(200, await listData(admin, user.id), cors);
        case 'sync': return response(200, await sync({ admin, userId: user.id, connectionId: body.connectionId, config, fetchImpl }), cors);
        case 'disconnect': return response(200, await disconnect({ admin, userId: user.id, connectionId: body.connectionId, config, fetchImpl }), cors);
        case 'hide': return response(200, await hideTransaction(admin, user.id, body.transactionId, body.hidden !== false), cors);
        default: return response(400, { error: 'Unsupported bank action.' }, cors);
      }
    } catch (error) {
      // Never return provider bodies, JWTs, private keys, codes or raw account data.
      console.error('Banking request failed:', error.status ? `provider HTTP ${error.status}` : error.message);
      return response(error.status && [401, 403, 404, 422, 429].includes(error.status) ? error.status : 502, { error: error.status === 401 || error.status === 403 ? 'Reconnect your bank to continue syncing.' : 'Bank service is temporarily unavailable.' }, cors);
    }

    async function callback(req, headers) {
      const query = new URL(req.url).searchParams;
      const state = query.get('state');
      const code = query.get('code');
      if (!state || state.length < 24 || state.length > 256) return new Response('Invalid or expired bank authorization. Return to CBoard and try again.', { status: 400, headers });
      let config;
      try { config = configuration(env); } catch { return new Response('Bank connection is not configured.', { status: 503, headers }); }
      const adminClient = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
      const hash = await sha256(state);
      const { data: authState } = await adminClient.from('bank_authorization_states').select('*').eq('state_hash', hash).is('consumed_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (!authState) return new Response('Invalid or expired bank authorization. Return to CBoard and try again.', { status: 400, headers });
      const { data: consumed } = await adminClient.from('bank_authorization_states').update({ consumed_at: new Date().toISOString() }).eq('state_hash', hash).is('consumed_at', null).select('state_hash').maybeSingle();
      if (!consumed) return new Response('This bank authorization has already been used.', { status: 409, headers });
      const appOrigin = (env('APP_ORIGIN') || new URL(config.redirectUrl).origin).replace(/\/$/, '');
      const appBase = env('APP_BASE_PATH') || '/';
      if (!appBase.startsWith('/') || appBase.includes('..') || appBase.includes('?') || appBase.includes('#')) return new Response('Bank connection is not configured.', { status: 503, headers });
      const financePath = `${appOrigin}${appBase.replace(/\/*$/, '/') }finance?section=bank-connections`;
      if (query.has('error') || !code) return Response.redirect(`${financePath}&bank=cancelled`, 303);
      try {
        const session = await providerRequest(config, '/sessions', { method: 'POST', body: { code } }, fetchImpl);
        const accounts = session.accounts || [];
        if (!session.session_id || !accounts.length) throw new Error('No accounts returned from the authorized session.');
        const name = session.aspsp?.name || authState.aspsp_name;
        const { data: connection, error: insertError } = await adminClient.from('bank_connections').insert({ user_id: authState.user_id, provider: 'enable_banking', aspsp_name: name, country: session.aspsp?.country || authState.country, psu_type: session.psu_type || 'personal', session_id: session.session_id, consent_valid_until: session.access?.valid_until || null, environment: config.environment, status: 'connected' }).select().single();
        if (insertError) throw insertError;
        const rows = accounts.map(account => ({ user_id: authState.user_id, connection_id: connection.id, provider_account_id: account.identification_hash || account.uid, provider_account_uid: account.uid || null, identification_hash: account.identification_hash || null, display_name: account.name || account.product || account.details || 'Bank account', currency: account.currency || null, account_type: account.cash_account_type || null, masked_identification: maskedId(account), active: Boolean(account.uid) })).filter(row => row.provider_account_id);
        const { error: accountError } = await adminClient.from('bank_accounts').insert(rows);
        if (accountError) throw accountError;
        return Response.redirect(`${financePath}&bank=connected`, 303);
      } catch (error) {
        console.error('Bank callback failed:', error.status ? `provider HTTP ${error.status}` : error.message);
        return Response.redirect(`${financePath}&bank=error`, 303);
      }
    }
  };
}

async function startAuthorization({ admin, userId, body, config, fetchImpl }) {
  if (typeof body.aspspName !== 'string' || body.aspspName.length > 200) throw Object.assign(new Error('Choose a supported bank.'), { status: 400 });
  const catalog = await providerRequest(config, `/aspsps?${new URLSearchParams({ country: 'GB', psu_type: 'personal', service: 'AIS' })}`, {}, fetchImpl);
  const selectedAspsp = (catalog.aspsps || []).find(item => item.name === body.aspspName && item.country === 'GB' && (item.psu_types || []).includes('personal'));
  if (!selectedAspsp) throw Object.assign(new Error('Choose a currently supported GB personal AIS bank.'), { status: 400 });
  const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const { error } = await admin.from('bank_authorization_states').insert({ state_hash: await sha256(state), user_id: userId, aspsp_name: body.aspspName, country: 'GB', environment: config.environment, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  if (error) throw error;
  const maxValidity = Number(selectedAspsp.maximum_consent_validity);
  if (!Number.isFinite(maxValidity) || maxValidity <= 0) throw new Error('The selected bank did not provide a valid consent period.');
  const validity = Math.min(90 * 86400, maxValidity);
  const authorization = await providerRequest(config, '/auth', { method: 'POST', body: { access: { transactions: true, balances: true, valid_until: new Date(Date.now() + validity * 1000).toISOString() }, aspsp: { name: body.aspspName, country: 'GB' }, state, redirect_url: config.redirectUrl, psu_type: 'personal' } }, fetchImpl);
  if (!authorization.url || new URL(authorization.url).protocol !== 'https:') throw new Error('Enable Banking returned an invalid authorization URL.');
  return { url: authorization.url };
}

async function listData(admin, userId) {
  const [connections, accounts, rows] = await Promise.all([
    admin.from('bank_connections').select('id,provider,aspsp_name,country,psu_type,consent_valid_until,status,environment,connected_at,last_successful_sync_at,last_sync_attempt_at,last_error').eq('user_id', userId).neq('status', 'disconnected').order('created_at', { ascending: false }),
    admin.from('bank_accounts').select('id,connection_id,display_name,currency,account_type,masked_identification,active,last_balance,balance_updated_at').eq('user_id', userId),
    admin.from('bank_transactions').select('id,connection_id,bank_account_id,entry_reference,transaction,status,hidden_at,created_at,last_synced_at').eq('user_id', userId),
  ]);
  if (connections.error || accounts.error || rows.error) throw new Error('Could not load bank connections.');
  return { connections: connections.data, accounts: accounts.data, transactions: rows.data.map(row => ({ ...transactionProjection(row), id: `bank-${row.id}`, hiddenAt: row.hidden_at })) };
}

export async function fetchAllTransactions(config, accountIdValue, fetchImpl, fromDate, request = providerRequest) {
  let continuationKey = null;
  const seenKeys = new Set();
  const all = [];
  let pageCount = 0;
  do {
    if (++pageCount > 100) throw new Error('Transaction pagination exceeded the safe page limit.');
    const query = new URLSearchParams();
    if (fromDate) query.set('date_from', fromDate);
    if (continuationKey) query.set('continuation_key', continuationKey);
    const path = `/accounts/${encodeURIComponent(accountIdValue)}/transactions${query.size ? `?${query}` : ''}`;
    const page = await request(config, path, {}, fetchImpl);
    if (!Array.isArray(page.transactions)) throw new Error('Enable Banking returned malformed transaction data.');
    all.push(...page.transactions);
    const next = page.continuation_key || null;
    if (next && seenKeys.has(next)) throw new Error('Enable Banking repeated a transaction continuation key.');
    if (next) seenKeys.add(next);
    continuationKey = next;
  } while (continuationKey);
  return all;
}

async function sync({ admin, userId, connectionId, config, fetchImpl }) {
  const { data: connection, error } = await admin.from('bank_connections').select('*').eq('id', connectionId).eq('user_id', userId).maybeSingle();
  if (error || !connection || connection.status === 'disconnected') throw Object.assign(new Error('Bank connection not found.'), { status: 404 });
  if (!connection.session_id) throw Object.assign(new Error('Bank reconnection is required.'), { status: 401 });
  const now = new Date().toISOString();
  if (connection.consent_valid_until && Date.parse(connection.consent_valid_until) <= Date.now()) {
    await admin.from('bank_connections').update({ status: 'expired', last_sync_attempt_at: now, last_error: 'Consent expired.' }).eq('id', connection.id);
    return { error: 'Reconnect your bank to continue syncing.' };
  }
  if (connection.sync_lock_until && Date.parse(connection.sync_lock_until) > Date.now()) return { error: 'A bank sync is already running.' };
  const lockUntil = new Date(Date.now() + 3 * 60 * 1000).toISOString();
  const { data: locked } = await admin.from('bank_connections').update({ sync_lock_until: lockUntil, last_sync_attempt_at: now, last_error: null }).eq('id', connection.id).eq('user_id', userId).or(`sync_lock_until.is.null,sync_lock_until.lt.${now}`).select('id').maybeSingle();
  if (!locked) return { error: 'A bank sync is already running.' };
  let added = 0, updated = 0, unchanged = 0;
  try {
    const session = await providerRequest(config, `/sessions/${encodeURIComponent(connection.session_id)}`, {}, fetchImpl);
    const status = String(session.status || '').toUpperCase();
    if (status && status !== 'AUTHORIZED') {
      const nextStatus = ['EXPIRED', 'INVALID', 'REVOKED', 'CLOSED', 'CANCELLED'].includes(status) ? 'reconnect_required' : 'error';
      await admin.from('bank_connections').update({ status: nextStatus, consent_valid_until: session.access?.valid_until || connection.consent_valid_until, sync_lock_until: null, last_error: nextStatus === 'reconnect_required' ? 'Bank access needs to be reconnected.' : 'Bank session is not authorized.' }).eq('id', connection.id);
      return { error: 'Reconnect your bank to continue syncing.' };
    }
    const { data: accounts, error: accountError } = await admin.from('bank_accounts').select('*').eq('connection_id', connection.id).eq('user_id', userId).eq('active', true);
    if (accountError) throw accountError;
    for (const account of accounts || []) {
      const overlap = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const accountUid = account.provider_account_uid || account.provider_account_id;
      const transactions = await fetchAllTransactions(config, accountUid, fetchImpl, overlap);
      const { data: pendingRows, error: pendingError } = await admin.from('bank_transactions').select('id,transaction,status,hidden_at,created_at').eq('user_id', userId).eq('provider_account_id', account.provider_account_id).in('status', ['PDNG','HOLD']).limit(200);
      if (pendingError) throw pendingError;
      const reconciledPendingIds = new Set();
      for (const tx of transactions) {
        const identity = transactionIdentity(tx);
        const valid = tx.transaction_amount?.currency && tx.transaction_amount?.amount && ['CRDT','DBIT'].includes(tx.credit_debit_indicator);
        if (!valid) { unchanged += 1; continue; }
        const payload = { user_id: userId, connection_id: connection.id, bank_account_id: account.id, provider_account_id: account.provider_account_id, entry_reference: identity.entryReference, provider_transaction_id: tx.transaction_id || null, fallback_fingerprint: identity.fallback, transaction: tx, status: tx.status || 'OTHR', last_synced_at: new Date().toISOString() };
        let existingRow = null;
        if (identity.entryReference) {
          const existing = await admin.from('bank_transactions').select('id,transaction,created_at').eq('user_id', userId).eq('provider_account_id', account.provider_account_id).eq('entry_reference', identity.entryReference).maybeSingle();
          if (existing.error) throw existing.error;
          existingRow = existing.data;
        } else if (identity.fallback) {
          const existing = await admin.from('bank_transactions').select('id,transaction,created_at').eq('user_id', userId).eq('provider_account_id', account.provider_account_id).eq('fallback_fingerprint', identity.fallback).maybeSingle();
          if (existing.error) throw existing.error;
          existingRow = existing.data;
        }
        let result;
        const candidate = String(tx.status || '').toUpperCase() === 'BOOK'
          ? (pendingRows || []).filter(row => !existingRow && !reconciledPendingIds.has(row.id) && pendingBookingMatch(row, tx))
          : [];
        if (candidate.length === 1) {
          const match = candidate[0];
          result = await admin.from('bank_transactions').update(payload).eq('id', match.id).select('id,created_at').single();
          if (!result.error) reconciledPendingIds.add(match.id);
        } else if (identity.entryReference) {
          result = await admin.from('bank_transactions').upsert(payload, { onConflict: 'user_id,provider_account_id,entry_reference' }).select('id,created_at').single();
        } else if (identity.fallback) {
          result = existingRow
            ? await admin.from('bank_transactions').update(payload).eq('id', existingRow.id).select('id,created_at').single()
            : await admin.from('bank_transactions').insert(payload).select('id,created_at').single();
        } else {
          // Missing a stable reference and insufficient attributes for conservative identity:
          // don't import it, since repeated sync could create duplicate financial records.
          unchanged += 1; continue;
        }
        if (result.error) throw result.error;
        if (!existingRow && candidate.length !== 1) added += 1;
        else if (existingRow && comparableTransaction(existingRow.transaction) === comparableTransaction(tx)) unchanged += 1;
        else updated += 1;
      }
      try {
        const balanceResponse = await providerRequest(config, `/accounts/${encodeURIComponent(accountUid)}/balances`, {}, fetchImpl);
        const balance = (balanceResponse.balances || []).find(item => item.balance_amount?.amount);
        if (balance) await admin.from('bank_accounts').update({ last_balance: balance, balance_updated_at: new Date().toISOString() }).eq('id', account.id).eq('user_id', userId);
      } catch { /* Balances are optional; transaction sync remains successful. */ }
    }
    await admin.from('bank_connections').update({ status: 'connected', last_successful_sync_at: new Date().toISOString(), last_error: null, sync_lock_until: null }).eq('id', connection.id);
    return { added, updated, unchanged, accounts: accounts?.length || 0 };
  } catch (error) {
    const nextStatus = error.status === 401 || error.status === 403 || error.status === 404 ? 'reconnect_required' : 'error';
    await admin.from('bank_connections').update({ status: nextStatus, last_error: nextStatus === 'reconnect_required' ? 'Bank access needs to be reconnected.' : 'The bank service is temporarily unavailable.', sync_lock_until: null }).eq('id', connection.id);
    throw error;
  }
}

async function disconnect({ admin, userId, connectionId, config, fetchImpl }) {
  const { data: connection, error } = await admin.from('bank_connections').select('id,session_id').eq('id', connectionId).eq('user_id', userId).maybeSingle();
  if (error || !connection) throw Object.assign(new Error('Bank connection not found.'), { status: 404 });
  if (connection.session_id) {
    try { await providerRequest(config, `/sessions/${encodeURIComponent(connection.session_id)}`, { method: 'DELETE' }, fetchImpl); } catch (error) { if (error.status !== 404) console.error('Bank session close failed:', error.status ? `provider HTTP ${error.status}` : 'temporary failure'); }
  }
  const { error: updateError } = await admin.from('bank_connections').update({ status: 'disconnected', session_id: null, sync_lock_until: null, last_error: null }).eq('id', connection.id).eq('user_id', userId);
  if (updateError) throw updateError;
  return { disconnected: true };
}

async function hideTransaction(admin, userId, transactionId, hidden) {
  const rowId = String(transactionId || '').replace(/^bank-/, '');
  const { error } = await admin.from('bank_transactions').update({ hidden_at: hidden ? new Date().toISOString() : null }).eq('id', rowId).eq('user_id', userId);
  if (error) throw error;
  return { hidden };
}

