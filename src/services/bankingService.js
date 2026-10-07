import { getUserScopedClient } from './supabaseCrud.js';

export async function bankingRequest(body) {
  const { client, userId } = await getUserScopedClient();
  const { data, error } = await client.functions.invoke('banking', { body });
  if (error) {
    let message = 'Bank connections are temporarily unavailable.';
    if (error.context instanceof Response) {
      try { message = (await error.context.json()).error || message; } catch { /* Edge Function returned no JSON. */ }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  const current = await getUserScopedClient();
  if (current.userId !== userId) throw new Error('Your account changed. Reload Finance and try again.');
  return data;
}

export const loadBankData = () => bankingRequest({ action: 'list' });
export const getBankAspsps = () => bankingRequest({ action: 'aspsps' });
export const startBankAuthorization = aspspName => bankingRequest({ action: 'start', aspspName });
export const syncBankConnection = connectionId => bankingRequest({ action: 'sync', connectionId });
export const disconnectBankConnection = connectionId => bankingRequest({ action: 'disconnect', connectionId });
export const setBankTransactionHidden = (transactionId, hidden) => bankingRequest({ action: 'hide', transactionId, hidden });

/** Provider boundary used by Finance; future AIS providers can implement this shape. */
export const bankDataProvider = Object.freeze({
  listInstitutions: getBankAspsps,
  connect: startBankAuthorization,
  sync: syncBankConnection,
  disconnect: disconnectBankConnection,
  setTransactionHidden: setBankTransactionHidden,
});
