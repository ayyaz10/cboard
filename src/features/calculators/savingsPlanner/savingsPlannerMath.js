export const scheduleModes = [
  { value: 'specific', label: 'Specific days of the week' },
  { value: 'weekly', label: 'Number of days each week' },
  { value: 'monthly', label: 'Number of days each month' },
];

export const weekdays = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 0, short: 'Sun', label: 'Sunday' },
];

export function localDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createSavingsPlannerForm() {
  const startDate = localDateInput();
  const deadline = new Date();
  deadline.setMonth(deadline.getMonth() + 1);
  return { target: '100', alreadySaved: '0', planMode: 'contribution', savingMode: 'amount', amountPerDay: '10', dailyIncome: '100', savingPercentage: '10', equalPayments: false, scheduleMode: 'specific', selectedDays: [1, 3, 5], daysPerWeek: '3', daysPerMonth: '12', startDate, targetDate: localDateInput(deadline), currency: 'GBP' };
}

const positiveNumber = value => String(value ?? '').trim() && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const nonNegativeNumber = value => String(value ?? '').trim() && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function validateSavingsPlanner(values) {
  const errors = {};
  const target = positiveNumber(values.target);
  const alreadySaved = nonNegativeNumber(values.alreadySaved);
  if (target === null) errors.target = 'Enter a target greater than zero.';
  if (alreadySaved === null) errors.alreadySaved = 'Enter zero or a positive amount.';
  if (!['contribution', 'deadline'].includes(values.planMode)) errors.planMode = 'Choose how you want to plan.';
  if (values.planMode === 'contribution' && !['amount', 'percentage'].includes(values.savingMode)) errors.savingMode = 'Choose a saving amount type.';
  if (values.planMode === 'contribution' && values.savingMode === 'amount' && positiveNumber(values.amountPerDay) === null) errors.amountPerDay = 'Enter an amount greater than zero.';
  if (values.planMode === 'contribution' && values.savingMode === 'percentage') {
    if (positiveNumber(values.dailyIncome) === null) errors.dailyIncome = 'Enter daily earnings greater than zero.';
    const percentage = positiveNumber(values.savingPercentage);
    if (percentage === null || percentage > 100) errors.savingPercentage = 'Enter a percentage from 0.01 to 100.';
  }
  if (values.planMode === 'deadline' && positiveNumber(values.dailyIncome) === null) errors.dailyIncome = 'Enter daily earnings greater than zero to calculate the percentage.';
  if (target !== null && alreadySaved !== null && alreadySaved > target) errors.alreadySaved = 'Already saved cannot be more than the target.';
  if (!parseLocalDate(values.startDate)) errors.startDate = 'Choose a valid start date.';
  const targetDate = parseLocalDate(values.targetDate);
  const startDate = parseLocalDate(values.startDate);
  if (values.planMode === 'deadline' && !targetDate) errors.targetDate = 'Choose a valid target date.';
  if (values.planMode === 'deadline' && targetDate && startDate && targetDate < startDate) errors.targetDate = 'Target date must be on or after the start date.';
  if (!scheduleModes.some(({ value }) => value === values.scheduleMode)) errors.scheduleMode = 'Choose a saving schedule.';
  if (values.scheduleMode === 'specific' && (!Array.isArray(values.selectedDays) || values.selectedDays.length === 0)) errors.selectedDays = 'Choose at least one saving day.';
  const perWeek = positiveNumber(values.daysPerWeek);
  if (values.scheduleMode === 'weekly' && (perWeek === null || !Number.isInteger(perWeek) || perWeek > 7)) errors.daysPerWeek = 'Enter a whole number from 1 to 7.';
  const perMonth = positiveNumber(values.daysPerMonth);
  if (values.scheduleMode === 'monthly' && (perMonth === null || !Number.isInteger(perMonth) || perMonth > 31)) errors.daysPerMonth = 'Enter a whole number from 1 to 31.';
  return errors;
}

function addDays(date, count) { const next = new Date(date); next.setDate(next.getDate() + count); return next; }

function findSpecificFinish(startDate, selectedDays, contributions) {
  const selected = new Set(selectedDays.map(Number));
  let date = new Date(startDate), savedDays = 0;
  while (savedDays < contributions) {
    if (selected.has(date.getDay())) savedDays += 1;
    if (savedDays < contributions) date = addDays(date, 1);
  }
  return date;
}

function calendarDaysBetween(startDate, endDate) {
  return Math.round((endDate - startDate) / 86400000) + 1;
}

function countSpecificSavingDays(startDate, targetDate, selectedDays) {
  const selected = new Set(selectedDays.map(Number));
  let count = 0;
  for (let date = new Date(startDate); date <= targetDate; date = addDays(date, 1)) if (selected.has(date.getDay())) count += 1;
  return count;
}

export function calculateSavingsPlan(values) {
  const errors = validateSavingsPlanner(values);
  if (Object.keys(errors).length) return { errors };
  const target = Number(values.target), alreadySaved = Number(values.alreadySaved);
  const remaining = Math.max(0, target - alreadySaved), startDate = parseLocalDate(values.startDate);
  if (values.planMode === 'deadline') {
    const targetDate = parseLocalDate(values.targetDate);
    const calendarDays = calendarDaysBetween(startDate, targetDate);
    let contributions, exactDate = false;
    if (values.scheduleMode === 'specific') {
      contributions = countSpecificSavingDays(startDate, targetDate, values.selectedDays);
      exactDate = true;
    } else if (values.scheduleMode === 'weekly') {
      contributions = Math.floor(calendarDays * Number(values.daysPerWeek) / 7);
    } else {
      contributions = Math.floor(calendarDays * Number(values.daysPerMonth) / 30.4375);
    }
    if (remaining > 0 && contributions < 1) return { errors: { targetDate: 'There are no saving days in this date range. Extend the deadline or change the schedule.' } };
    const amountPerDay = contributions ? Math.ceil(remaining * 100 / contributions) / 100 : 0;
    const requiredPercentage = contributions ? amountPerDay / Number(values.dailyIncome) * 100 : 0;
    const periods = values.scheduleMode === 'monthly' ? Math.ceil(calendarDays / 30.4375) : Math.ceil(calendarDays / 7);
    const finalContribution = contributions ? values.equalPayments ? amountPerDay : Math.round(Math.max(0, remaining - amountPerDay * (contributions - 1)) * 100) / 100 : 0;
    const projectedTotal = Math.round((alreadySaved + (values.equalPayments ? amountPerDay * contributions : remaining)) * 100) / 100;
    const overTarget = Math.round(Math.max(0, projectedTotal - target) * 100) / 100;
    return { errors: {}, calculationMode: 'deadline', target, alreadySaved, amountPerDay, requiredPercentage, dailyIncome: Number(values.dailyIncome), remaining, contributions, savingDaysPerPeriod: values.scheduleMode === 'monthly' ? Number(values.daysPerMonth) : values.scheduleMode === 'weekly' ? Number(values.daysPerWeek) : values.selectedDays.length, periods, periodLabel: values.scheduleMode === 'monthly' ? (periods === 1 ? 'month' : 'months') : (periods === 1 ? 'week' : 'weeks'), finishDate: values.targetDate, exactDate, equalPayments: Boolean(values.equalPayments), finalContribution, projectedTotal, overTarget };
  }
  const amountPerDay = values.savingMode === 'percentage' ? Math.round(Number(values.dailyIncome) * Number(values.savingPercentage)) / 100 : Number(values.amountPerDay);
  const contributions = Math.ceil(remaining / amountPerDay);
  let savingDaysPerPeriod, periods, finishDate = new Date(startDate), exactDate = false, periodLabel;
  if (contributions > 0 && values.scheduleMode === 'specific') {
    savingDaysPerPeriod = values.selectedDays.length; periods = Math.ceil(contributions / savingDaysPerPeriod);
    finishDate = findSpecificFinish(startDate, values.selectedDays, contributions); exactDate = true; periodLabel = periods === 1 ? 'week' : 'weeks';
  } else if (contributions > 0 && values.scheduleMode === 'weekly') {
    savingDaysPerPeriod = Number(values.daysPerWeek); periods = Math.ceil(contributions / savingDaysPerPeriod);
    finishDate = addDays(startDate, Math.max(0, Math.ceil((contributions - 1) * 7 / savingDaysPerPeriod))); periodLabel = periods === 1 ? 'week' : 'weeks';
  } else if (contributions > 0) {
    savingDaysPerPeriod = Number(values.daysPerMonth); periods = Math.ceil(contributions / savingDaysPerPeriod);
    finishDate = addDays(startDate, Math.max(0, Math.ceil((contributions - 1) * 30.4375 / savingDaysPerPeriod))); periodLabel = periods === 1 ? 'month' : 'months';
  } else {
    savingDaysPerPeriod = values.scheduleMode === 'monthly' ? Number(values.daysPerMonth) : values.scheduleMode === 'weekly' ? Number(values.daysPerWeek) : values.selectedDays.length;
    periods = 0; exactDate = true; periodLabel = 'weeks';
  }
  const finalContribution = contributions ? Math.round((remaining - amountPerDay * (contributions - 1)) * 100) / 100 : 0;
  return { errors: {}, calculationMode: 'contribution', target, alreadySaved, amountPerDay, remaining, contributions, savingDaysPerPeriod, periods, periodLabel, finishDate: localDateInput(finishDate), exactDate, finalContribution };
}
