const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
export const EXECUTION_OUTCOMES = ['DONE', 'MINIMUM_DONE', 'MISSED', 'SKIPPED'];
export const FAILURE_REASONS = ['Forgot', 'No time', 'Too difficult', 'Wrong timing', 'Environment', 'Low energy', 'Interrupted', 'Other'];
export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const parseDate = key => { const [year, month, day] = key.split('-').map(Number); return new Date(year, month - 1, day, 12); };
export const shiftLocalDateKey = (key, amount) => { const date = parseDate(key); date.setDate(date.getDate() + amount); return localDateKey(date); };
const weekday = key => parseDate(key).getDay();
export function isScheduledDate(contract, dateKey) {
  const schedule = contract?.schedule || { type: 'DAILY' };
  if (schedule.type === 'WEEKDAYS') return schedule.days.includes(weekday(dateKey));
  return schedule.type !== 'WEEKLY';
}
function isPausedOn(node, key) { return Boolean(node.pausedAt && key >= node.pausedAt.slice(0,10)) || (node.pausedIntervals || []).some(range => range.start <= key && key <= range.end); }
function weekStart(key) { const date = parseDate(key); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return localDateKey(date); }
export function getExecutionStats(node, today = localDateKey()) {
  const contract = node?.actionContract;
  if (!contract) return { currentStreak: 0, bestStreak: 0, full: 0, minimum: 0, missed: 0, skipped: 0, opportunities: 0, rate: 0, recentMisses: 0, commonReason: '' };
  const records = node.executionHistory || [], byDate = new Map(records.map(record => [record.date, record]));
  const start = contract.createdAt?.slice(0, 10) || records.reduce((min, record) => record.date < min ? record.date : min, today);
  let full = 0, minimum = 0, missed = 0, skipped = 0, opportunities = 0, best = 0, currentStreak = 0;
  const dayCount = Math.min(3660, Math.max(1, Math.round((parseDate(today) - parseDate(start)) / 86400000) + 1));
  for (const record of records) {
    if (record.date < start || record.date > today) continue;
    if (record.outcome === 'DONE') full++;
    if (record.outcome === 'MINIMUM_DONE') minimum++;
    if (record.outcome === 'MISSED') missed++;
    if (record.outcome === 'SKIPPED') skipped++;
  }
  if ((contract.schedule || {}).type === 'WEEKLY') {
    const target = contract.schedule.target, weeks = new Map();
    for (let offset = dayCount - 1; offset >= 0; offset--) {
      const date = shiftLocalDateKey(today, -offset); if (isPausedOn(node, date)) continue; const key = weekStart(date);
      if (!weeks.has(key)) weeks.set(key, 0);
      if (['DONE', 'MINIMUM_DONE'].includes(byDate.get(date)?.outcome)) weeks.set(key, weeks.get(key) + 1);
    }
    const ordered = [...weeks.entries()].sort(([left], [right]) => left.localeCompare(right));
    const priorWeeks = ordered.filter(([key]) => key < weekStart(today));
    for (const [weekKey, count] of priorWeeks) { const weekRecords = records.filter(record => weekStart(record.date) === weekKey); opportunities += target; missed += Math.max(0, target - count - weekRecords.filter(record => ['MISSED','SKIPPED'].includes(record.outcome)).length); if (count >= target) { let streak = 1; for (let index = priorWeeks.findIndex(([, n]) => n === count); index > 0 && priorWeeks[index - 1][1] >= target; index--) streak++; best = Math.max(best, streak); } }
    const currentCount = weeks.get(weekStart(today)) || 0, currentRecords = records.filter(record => weekStart(record.date) === weekStart(today));
    opportunities += Math.min(target, currentCount + currentRecords.filter(record => ['MISSED','SKIPPED'].includes(record.outcome)).length);
    if (currentCount >= target) { opportunities++; currentStreak = 1; for (let index = priorWeeks.length - 1; index >= 0 && priorWeeks[index][1] >= target; index--) currentStreak++; }
    else { for (let index = priorWeeks.length - 1; index >= 0 && priorWeeks[index][1] >= target; index--) currentStreak++; }
    best = Math.max(best, currentStreak);
  } else {
    const scheduled = [];
    for (let offset = dayCount - 1; offset >= 0; offset--) { const date = shiftLocalDateKey(today, -offset); if (isScheduledDate(contract, date)) scheduled.push(date); }
    for (const date of scheduled) {
      if (isPausedOn(node, date)) continue;
      if (date < today && !byDate.has(date)) missed++;
      if (date === today && !byDate.has(date)) continue;
      opportunities++;
      const successful = ['DONE', 'MINIMUM_DONE'].includes(byDate.get(date)?.outcome);
      if (successful) best = Math.max(best, 1); // calculated below as a single chronological pass
    }
    let run = 0;
    for (const date of scheduled) {
      if (isPausedOn(node, date)) continue;
      if (date === today && !byDate.has(date)) continue;
      if (['DONE', 'MINIMUM_DONE'].includes(byDate.get(date)?.outcome)) run++;
      else run = 0;
      best = Math.max(best, run);
    }
    for (let offset = 0; offset < dayCount; offset++) {
      const date = shiftLocalDateKey(today, -offset);
      if (isPausedOn(node, date) || !isScheduledDate(contract, date)) continue;
      if (date === today && !byDate.has(date)) continue;
      if (['DONE', 'MINIMUM_DONE'].includes(byDate.get(date)?.outcome)) currentStreak++;
      else break;
    }
  }
  const reasonCounts = new Map();
  for (const record of records.filter(entry => entry.reason && shiftLocalDateKey(today, -30) <= entry.date && entry.date <= today)) reasonCounts.set(record.reason, (reasonCounts.get(record.reason) || 0) + 1);
  const commonReason = [...reasonCounts].sort((left, right) => right[1] - left[1])[0]?.[0] || '';
  let recentMisses = records.filter(record => record.outcome === 'MISSED' && shiftLocalDateKey(today, -14) <= record.date && record.date <= today).length;
  if ((contract.schedule || {}).type !== 'WEEKLY') for (let offset = 1; offset <= 14; offset++) { const date = shiftLocalDateKey(today, -offset); if (!isPausedOn(node,date) && isScheduledDate(contract,date) && !byDate.has(date)) recentMisses++; }
  return { currentStreak, bestStreak: Math.max(best, currentStreak), full, minimum, missed, skipped, opportunities, rate: opportunities ? Math.min(100, Math.round(((full + minimum) / opportunities) * 100)) : 0, recentMisses, commonReason };
}
export function recordExecution(node, outcome, { date = localDateKey(), reason = null, focusSessionId = null, now = new Date().toISOString() } = {}) {
  if (!EXECUTION_OUTCOMES.includes(outcome)) throw new Error('Choose a valid habit outcome.');
  if (reason && !FAILURE_REASONS.includes(reason) && (typeof reason !== 'string' || reason.length > 120)) throw new Error('Choose a valid reason.');
  const existing = (node.executionHistory || []).find(record => record.date === date);
  if (existing?.outcome === outcome && (existing.reason || null) === (reason || null)) return node;
  const record = { id: existing?.id || uuid(), date, outcome, reason: reason || null, recordedAt: now, startedAt: node.activeSession?.date === date ? node.activeSession.startedAt : null, focusSessionId, contract: structuredClone(node.actionContract) };
  return { ...node, executionHistory: [...(node.executionHistory || []).filter(entry => entry.date !== date), record].sort((a, b) => a.date.localeCompare(b.date)), activeSession: null, updatedAt: now };
}
export function startExecution(node, { date = localDateKey(), now = new Date().toISOString() } = {}) {
  if (!node.actionContract) throw new Error('Set an Action Contract before starting this habit.');
  if (node.activeSession?.date === date) return node;
  return { ...node, activeSession: { date, startedAt: now }, updatedAt: now };
}
export function getOpportunity(node, today = localDateKey()) {
  if (!node.focusNow || !node.actionContract) return { due: false, recovery: false };
  if (isPausedOn(node, today)) return { due: false, recovery: false, paused: true };
  const record = (node.executionHistory || []).find(entry => entry.date === today);
  if (record) return { due: false, completed: true, record, recovery: false };
  const contract = node.actionContract, weekly = contract.schedule?.type === 'WEEKLY';
  const weekSuccesses = weekly ? (node.executionHistory || []).filter(entry => weekStart(entry.date) === weekStart(today) && ['DONE', 'MINIMUM_DONE'].includes(entry.outcome)).length : 0;
  if (weekly ? weekSuccesses >= contract.schedule.target : !isScheduledDate(contract, today)) return { due: false, recovery: false };
  const yesterday = shiftLocalDateKey(today, -1), yesterdayRecord = (node.executionHistory || []).find(entry => entry.date === yesterday), missedYesterday = !weekly && !isPausedOn(node, yesterday) && isScheduledDate(contract, yesterday) && (!yesterdayRecord || ['MISSED', 'SKIPPED'].includes(yesterdayRecord.outcome));
  return { due: true, completed: false, recovery: missedYesterday };
}
export function getContractSnapshot(contract, now = new Date().toISOString()) { return { ...structuredClone(contract), createdAt: now }; }
