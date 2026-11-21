import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttentionItems } from './lifeOverview.js';

const now = new Date('2026-11-21T10:00:00Z');

test('attention prioritizes overdue commitments before due-today actions', () => {
  const rows = buildAttentionItems({ now, items: [
    { type: 'task', id: 'today', title: 'Call dentist', dueAt: '2026-11-21T12:00:00Z' },
    { type: 'reminder', id: 'late', title: 'Submit form', dueAt: '2026-11-20T12:00:00Z' },
  ] });
  assert.deepEqual(rows.map(row => row.id), ['shared:reminder:late', 'shared:task:today']);
});

test('attention suppresses a module bill duplicated by a shared reminder', () => {
  const rows = buildAttentionItems({ now,
    items: [{ type: 'reminder', id: 'bill', title: 'Car payment payment', dueAt: '2026-11-19T08:00:00Z' }],
    finance: { overduePayments: [{ id: 'bill', title: 'Car payment', dueDate: '2026-11-19' }] },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'Reminders');
});

test('attention omits future tasks without a supported near-term signal and keeps stable actions', () => {
  const rows = buildAttentionItems({ now, items: [
    { type: 'task', id: 'future', title: 'Later', dueAt: '2026-11-25T12:00:00Z' },
  ], finance: { upcomingPayments: [{ id: 'payment-1', title: 'Insurance', dueDate: '2026-11-22' }] },
    training: { todayPlan: { date: '2026-11-21', name: 'Push', exercises: 3 } },
  });
  assert.deepEqual(rows.map(row => row.id), ['training:2026-11-21', 'finance:payment-1']);
  assert.equal(rows[0].href, '/training');
});
