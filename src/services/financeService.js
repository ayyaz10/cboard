import { normalizeFinanceState } from '../features/finance/financeData.js';
import { assertSupabaseResult, getUserScopedClient } from './supabaseCrud.js';
import { loadBankData } from './bankingService.js';
import { applyDueMonthlyAllocations, applyIncomeAllocations, eligibleBookedBankIncome } from '../features/finance/financeAllocations.js';
import { id, today } from '../features/finance/financeData.js';
import { nextTransactionSequence } from '../features/finance/transactionOrder.js';
import { nextRecurringDate } from '../features/finance/financeMath.js';
import { migrateLegacyDebtAllocations } from '../features/finance/debtAccounting.js';

function runFinanceAutomations(state, date = today()) {
  let changed = migrateLegacyDebtAllocations(state) > 0;
  if (!state.settings.configured) return changed;
  const month = date.slice(0, 7);
  const day = Number(date.slice(8, 10));
  const dueMonthly = (state.allocationRules || []).some(rule => rule.active && rule.timing === 'monthly' && (!rule.startedOn || rule.startedOn <= date) && day >= Number(rule.day || 1) && (rule.targetType === 'donation'
    ? !(state.donationAccruals || []).some(item => item.executionKey === `${rule.id}:monthly:${month}`)
    : rule.targetType === 'debt'
      ? !(state.debtAccruals || []).some(item => item.executionKey === `${rule.id}:monthly:${month}`)
      : !state.transactions.some(item => item.allocationRuleId === rule.id && item.date?.slice(0, 7) === month)));
  if (dueMonthly) { applyDueMonthlyAllocations(state, date); changed = true; }

  if ((state.recurring || []).some(item => !item.paused && item.mode === 'auto' && item.nextDate <= date)) {
    for (const rule of state.recurring) {
      if (rule.paused || rule.mode !== 'auto') continue;
      let guard = 0;
      while (rule.nextDate <= date && guard++ < 120) {
        const occurrence = rule.nextDate;
        if (!state.transactions.some(item => item.recurringId === rule.id && item.recurringDate === occurrence)) {
          const transaction = { id: id(), sequence: nextTransactionSequence(state), title: rule.title, amount: rule.amount, type: rule.type, categoryId: rule.categoryId || '', donationCategoryId: rule.donationCategoryId || '', date: occurrence, note: 'Automatically recorded recurring item', paymentMethod: rule.paymentMethod || '', createdAt: new Date().toISOString(), recurringId: rule.id, recurringDate: occurrence };
          state.transactions.push(transaction);
          if (transaction.type === 'income') applyIncomeAllocations(state, transaction);
        }
        rule.nextDate = nextRecurringDate(rule.nextDate, rule.frequency, rule.customMonths);
        changed = true;
      }
    }
  }

  const credits = eligibleBookedBankIncome(state);
  if (credits.length) {
    for (const item of credits) {
      const transaction = state.transactions.find(current => current.id === item.id);
      if (transaction && !transaction.bankIncomeAllocationsApplied) {
        applyIncomeAllocations(state, transaction);
        transaction.bankIncomeAllocationsApplied = true;
        changed = true;
      }
    }
  }
  return changed;
}

export async function loadFinance() {
  const { client, userId } = await getUserScopedClient();
  const result = await client.from('finance_workspaces').select('state,updated_at').eq('user_id', userId).maybeSingle();
  assertSupabaseResult(result);
  const state = normalizeFinanceState(result.data?.state);
  let bankData = { connections: [], accounts: [], transactions: [] };
  let bankError = '';
  try { bankData = await loadBankData(); } catch (error) { bankError = error.message || 'Bank connections are temporarily unavailable.'; }
  const savedById = new Map(state.transactions.map(item => [item.id, item]));
  const bankTransactions = (bankData.transactions || []).filter(item => !item.hiddenAt).map(item => {
    const saved = savedById.get(item.id);
    const prior = state.transactions.find(candidate => candidate.type === item.type && candidate.categoryId && candidate.title?.trim().toLowerCase() === item.title.trim().toLowerCase());
    const category = saved?.categoryId || prior?.categoryId || '';
    // Bank values and identity are provider-owned; user classification remains editable.
    return { ...item, title: saved?.title || item.title, note: saved?.note || '', categoryId: category, tags: saved?.tags || [], userNote: saved?.note || '', sequence: saved?.sequence || 0, bankIncomeAllocationsApplied: Boolean(saved?.bankIncomeAllocationsApplied) };
  });
  state.transactions = [...state.transactions.filter(item => !String(item.id).startsWith('bank-')), ...bankTransactions];
  let version = result.data?.updated_at || null;
  if (runFinanceAutomations(state)) version = await saveFinance(state, version, userId);
  return { state, version, userId, bankData, bankError };
}

export async function saveFinance(state, version, expectedUserId) {
  const { client, userId } = await getUserScopedClient();
  if (userId !== expectedUserId) throw new Error('Your account changed. Reload Finance before saving.');
  const updatedAt = new Date().toISOString();
  const query = version
    ? client.from('finance_workspaces').update({ state, updated_at: updatedAt }).eq('user_id', userId).eq('updated_at', version)
    : client.from('finance_workspaces').insert({ user_id: userId, state, updated_at: updatedAt });
  const result = await query.select('updated_at').maybeSingle();
  if (result.error?.code === '23505' || (!result.error && !result.data)) throw new Error('Finance changed in another tab. Reload before trying again.');
  assertSupabaseResult(result);
  return result.data.updated_at;
}

export async function parseFinanceEntry(body) {
  const { client, userId } = await getUserScopedClient();
  const { data, error } = await client.functions.invoke('parse-finance', { body });
  if (error) {
    let message = 'AI quick add is unavailable. Use Add transaction instead.';
    if (error.context instanceof Response) {
      try { message = (await error.context.json()).error || message; } catch { /* non-JSON failure */ }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  const current = await getUserScopedClient();
  if (current.userId !== userId) throw new Error('Your account changed. Prepare this transaction again.');
  return data;
}
