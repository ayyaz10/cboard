import { loadFinance } from './financeService.js';
import { loadTraining } from './trainingService.js';
import { getFoodDiaryDays } from './foodDiaryService.js';
import { loadLatestWeights } from './weightService.js';
import { getUserScopedClient, assertSupabaseResult } from './supabaseCrud.js';
import { normalizeFinanceState, today as financeToday } from '../features/finance/financeData.js';
import { deriveFinancePosition } from '../features/finance/financeLedger.js';
import { financeSummary } from '../features/finance/financeMath.js';
import { getCreditDueSoon, getOverdueCreditPayments } from '../features/finance/creditPurchases.js';
import { validateState, dayIndex, localDate } from '../features/training/trainingData.js';
import { diaryTotals } from '../features/diary/diaryData.js';
import { GOAL_KEY, emptyGoals, hydrateCalculatedGoals } from '../features/nutrition/nutritionGoals.js';

function paymentSummary(row) {
  return { id: `credit:${row.agreement.id}:${row.instalment.id}`, title: row.agreement.title,
    dueDate: row.instalment.dueDate, remaining: row.remaining };
}

export async function loadFinanceLifeSummary(expectedUserId) {
  const data = await loadFinance({ runAutomations: false });
  if (data.userId !== expectedUserId) throw new Error('Your account changed. Reload My Life.');
  if (data.bankError) throw new Error(data.bankError);
  const state = normalizeFinanceState(data.state);
  const asOfDate = financeToday();
  const month = asOfDate.slice(0, 7);
  const position = deriveFinancePosition(state);
  const monthly = financeSummary(state, month);
  return { currency: state.settings.currency, spendable: position.spendable,
    debtOutstanding: position.debtOutstanding, monthlyIncome: monthly.income,
    monthlyExpenses: monthly.expenses,
    overduePayments: getOverdueCreditPayments(state, asOfDate).slice(0, 20).map(paymentSummary),
    upcomingPayments: getCreditDueSoon(state, asOfDate).slice(0, 20).map(paymentSummary) };
}

export async function loadTrainingLifeSummary(expectedUserId) {
  const remote = await loadTraining(expectedUserId);
  if (!remote) return { configured: false, recent: null };
  const data = validateState(remote.data);
  const today = localDate();
  const todayPlan = data.plan.days[dayIndex(today)];
  const upcomingPlan = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(); date.setDate(date.getDate() + offset);
    const key = localDate(date), day = data.plan.days[dayIndex(key)];
    return day.exercises.length ? { date: key, name: day.name, exercises: day.exercises.length } : null;
  }).find(Boolean) || null;
  const active = data.sessions.some(session => session.status === 'active');
  const recent = [...data.sessions].filter(session => session.status !== 'active' && session.sets.length)
    .sort((left, right) => right.date.localeCompare(left.date) || right.started - left.started)[0] || null;
  return { configured: true, active,
    todayPlan: todayPlan.exercises.length ? { date: today, name: todayPlan.name, exercises: todayPlan.exercises.length } : null,
    upcomingPlan, recent: recent ? { date: recent.date, name: recent.name, status: recent.status, sets: recent.sets.length } : null };
}

export async function loadGoalLifeSummary(expectedUserId) {
  const { client, userId } = await getUserScopedClient();
  if (userId !== expectedUserId) throw new Error('Your account changed. Reload My Life.');
  const today = localDate();
  const [countResult, deadlineResult] = await Promise.all([
    client.from('goals').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    client.from('goals').select('title,deadline').eq('user_id', userId)
      .gte('deadline', today).order('deadline', { ascending: true }).limit(1),
  ]);
  assertSupabaseResult(countResult);
  assertSupabaseResult(deadlineResult);
  const nextDeadline = deadlineResult.data?.[0] || null;
  return { count: countResult.count || 0,
    nextDeadline: nextDeadline ? { title: nextDeadline.title, date: nextDeadline.deadline } : null };
}

export async function loadWeightLifeSummary(expectedUserId) {
  const entries = await loadLatestWeights(expectedUserId, 2);
  return entries.map(entry => ({ date: entry.date, weightKg: Number(entry.weight_kg) }));
}

export async function loadFoodLifeSummary(expectedUserId) {
  const date = localDate();
  const [{ client, userId }, days] = await Promise.all([getUserScopedClient(), getFoodDiaryDays([date], expectedUserId)]);
  if (userId !== expectedUserId) throw new Error('Your account changed. Reload My Life.');
  const targetResult = await client.from('user_tool_preferences').select('value')
    .eq('user_id', userId).eq('key', GOAL_KEY).maybeSingle();
  assertSupabaseResult(targetResult);
  const targetValue = targetResult.data?.value;
  const targets = targetValue ? hydrateCalculatedGoals(targetValue) : emptyGoals();
  const day = days.find(entry => entry.date === date), meals = day?.meals || [];
  const calories = diaryTotals(meals).calories;
  return { date, mealCount: meals.filter(meal => meal.items?.length).length,
    foodCount: meals.reduce((count, meal) => count + (meal.items?.length || 0), 0),
    calories: calories.known ? calories.value : null, caloriesMissing: calories.missing,
    calorieTarget: targets.calories };
}
