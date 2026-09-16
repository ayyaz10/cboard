import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFinanceRequest, validateFinanceDraft } from './financeParser.js';
const context = { text: 'add 100 pound in travel title trip to spain', currency: 'GBP', today: '2026-09-16', categories: [{ id: 'travel', name: 'Travel', type: 'expense' }] };
const ready = { status: 'ready', amount: '100.00', currency: 'GBP', type: 'expense', title: 'Trip to Spain', categoryId: 'travel', date: '2026-09-16' };
test('converts pounds to exact minor units and only returns permitted draft fields', () => {
  const result = validateFinanceDraft({ ...ready, id: 'overwrite', recurring: true, balance: 100000 }, context);
  assert.deepEqual(result.transaction, { title: 'Trip to Spain', amount: 10000, type: 'expense', categoryId: 'travel', date: '2026-09-16', note: '', paymentMethod: '' });
  assert.equal(validateFinanceDraft({ ...ready, amount: '0.29' }, context).transaction.amount, 29);
});
test('ambiguous requests can only return a clarification, not a transaction', () => {
  assert.deepEqual(validateFinanceDraft({ status: 'clarify', question: 'Expense or budget?', transaction: ready }, context), { status: 'clarify', question: 'Expense or budget?' });
});
test('rejects wrong currency, invalid dates, invented categories and amounts', () => {
  for (const patch of [{currency:'USD'}, {date:'2026-02-30'}, {categoryId:'invented'}, {type:'income'}, {amount:'-100'}, {amount:'1.234'}, {amount:100}, {amount:'0'}, {amount:'9007199254740991'}, {title:''}, {status:'delete'}])
    assert.throws(() => validateFinanceDraft({ ...ready, ...patch }, context));
  assert.equal(validateFinanceDraft({ ...ready, categoryId: null }, context).transaction.categoryId, '');
});
test('request validation bounds prompts and sends only category context', () => {
  const result = validateFinanceRequest({ ...context, transactions: [{ secret: 'history' }], categories: [{ ...context.categories[0], balance: 999 }] });
  assert.equal(result.transactions, undefined); assert.equal(result.categories[0].balance, undefined);
  assert.throws(() => validateFinanceRequest({ ...context, text: 'x'.repeat(1001) }));
  assert.throws(() => validateFinanceRequest({ ...context, today: '2026-13-01' }));
});
