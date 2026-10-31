export const DRIVING_STATUSES = ['NEEDS_WORK', 'IMPROVING', 'CONFIDENT'];
export const DRIVING_STATUS_LABELS = {
  NEEDS_WORK: 'Needs Work', IMPROVING: 'Improving', CONFIDENT: 'Confident',
};
export const STARTER_CATEGORIES = [
  'Roundabouts', 'Mirrors', 'Stopping & Braking', 'Speed Management', 'Speed Bumps',
  'Lane Discipline', 'Changing Lanes', 'Traffic Signals & Junctions',
  'General Awareness & Driving Habits', 'Lane Positioning Reference Tips',
];
const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const INITIAL_MISTAKES = [
  ['roundabouts', 'Unnecessary Stopping at Roundabouts', "Stopping when it’s safe to proceed."],
  ['roundabouts', 'Incorrect Lane Selection at Roundabouts', 'Choosing the wrong lane for the intended exit.'],
  ['roundabouts', 'Unsafe Lane Changes at Roundabouts', 'Changing lanes without proper observations or positioning.'],
  ['mirrors', 'Forgetting Regular Mirror Checks', 'Not monitoring traffic behind and around the vehicle.'],
  ['mirrors', 'Missing Mirror Checks When Going Straight', 'Not checking relevant mirrors while driving ahead.'],
  ['mirrors', 'Missing Mirror Checks Before Turning Left', 'Forgetting left-side and interior mirror observations.'],
  ['mirrors', 'Missing Mirror Checks Before Turning Right', 'Forgetting right-side and interior mirror observations.'],
  ['mirrors', 'Infrequent Mirror Observations', 'Going too long without checking mirrors as road conditions require.'],
  ['stopping', 'Harsh or Sudden Braking', 'Braking too late instead of slowing down smoothly.'],
  ['stopping', 'Incorrect Handbrake Timing', 'Applying the handbrake before the vehicle has fully stopped.'],
  ['stopping', 'Poor Speed Reduction Before Stopping', 'Not slowing progressively and adjusting speed to the situation.'],
  ['speed', 'Inconsistent Speed Control', 'Failing to maintain a safe speed within the posted limit.'],
  ['bumps', 'Approaching Speed Bumps Too Fast', 'Not reducing speed appropriately before the bump.'],
  ['bumps', 'Forgetting Mirror Checks Before Slowing Down', 'Braking for a bump without checking following traffic when practical.'],
  ['lane', 'Drifting Out of My Lane', 'Failing to maintain my lane position.'],
  ['lane', 'Poor Lane Centring', 'Not keeping the car appropriately positioned within the lane.'],
  ['lane', 'Driving Too Close to Lane Edges', 'Moving unnecessarily towards the left or right edge.'],
  ['lane', 'Overcorrecting the Steering Wheel', 'Making excessive steering adjustments instead of small, smooth corrections.'],
  ['changing-lanes', 'Rushing Lane Changes', 'Changing lanes without allowing enough time to assess traffic.'],
  ['changing-lanes', 'Changing Lanes Without Checking for a Safe Gap', 'Failing to check mirrors, blind spots and surrounding traffic before moving.'],
  ['changing-lanes', 'Incorrect Lane Change Sequence', 'Not following the correct observation, signal and manoeuvre process.'],
  ['junctions', 'Failing to Give Way When Turning Right', 'Turning across oncoming traffic without waiting for a safe gap.'],
  ['junctions', 'Failing to Give Way When Turning Left', 'Turning without checking pedestrians, cyclists or other traffic with priority.'],
  ['awareness', 'Rushing Instead of Driving Calmly', 'Making hurried decisions or braking unnecessarily hard.'],
  ['awareness', 'Missing Pedestrians at Crossings', 'Failing to anticipate pedestrians at zebra crossings and in busy areas.'],
  ['awareness', 'Missing Important Road Signs', 'Not identifying and responding to signs early enough.'],
];

const INITIAL_REMINDERS = [
  ['left-leg', 'Left Leg Position Reference', 'Use your left leg as a rough guide to lane positioning. This is approximate and varies with the car and seating position.'],
  ['steering-logo', 'Steering Wheel Logo Alignment', 'Use the steering wheel logo as a visual reference for your driving position. This is approximate and varies with the car and seating position.'],
  ['windscreen-wiper', 'Windscreen Wiper Reference', 'Use the wiper position as an additional guide to road-edge distance. This is approximate and varies with the car and seating position.'],
  ['side-mirror', 'Side Mirror Distance Check', 'Use your mirrors to judge safe clearance from road edges and obstacles. This is an approximate reference.'],
];

export const DRIVING_GUIDANCE_NOTES = [
  'Stopping: 12–16 mph is not a fixed stopping speed. Slow progressively according to road conditions.',
  'Speed bumps: 15–18 mph is not a universal rule. Choose speed for the bump, road signs and conditions.',
  'Mirrors: do not use a rigid 5–10 second rule. Check regularly and especially before changing speed, direction or position.',
  'Lane references from leg, steering logo or wiper position are approximate and vary by car and seating position.',
  'At signals, give way to oncoming traffic especially when turning right. On a left turn, check pedestrians, cyclists, signs, signals and other traffic with priority.',
];

export function createInitialDrivingData(userId = '', now = new Date().toISOString()) {
  const categories = STARTER_CATEGORIES.map((name, index) => ({ id: `driving-category-${index + 1}`, name, createdAt: now, updatedAt: now }));
  const categoryFor = key => ({
    roundabouts: categories[0], mirrors: categories[1], stopping: categories[2], speed: categories[3], bumps: categories[4],
    lane: categories[5], 'changing-lanes': categories[6], junctions: categories[7], awareness: categories[8],
  })[key];
  return {
    version: 1,
    presetVersion: 1,
    categories,
    mistakes: INITIAL_MISTAKES.map(([category, title, description], index) => ({
      id: `driving-mistake-v1-${String(index + 1).padStart(2, '0')}`,
      userId, categoryId: categoryFor(category).id, title, description, cause: '', correction: '',
      status: 'NEEDS_WORK', createdAt: now, updatedAt: now,
    })),
    reminders: INITIAL_REMINDERS.map(([id, title, text]) => ({ id: `driving-reminder-v1-${id}`, userId, categoryId: categories[9].id, title, text, createdAt: now, updatedAt: now })),
    guidanceNotes: [...DRIVING_GUIDANCE_NOTES],
  };
}

export function seedDrivingPresets(data, userId, now = new Date().toISOString()) {
  validateDrivingData(data);
  if (data.presetVersion >= 1) return data;
  const next = structuredClone(data);
  const aliases = {
    'Speed Management': ['Speed Control'],
    'Traffic Signals & Junctions': ['Junctions & Traffic Signals'],
    'General Awareness & Driving Habits': ['Pedestrian Awareness'],
  };
  const categoryIds = new Map();
  STARTER_CATEGORIES.forEach((name, index) => {
    let category = next.categories.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (!category) {
      category = next.categories.find(item => (aliases[name] || []).some(alias => item.name.toLowerCase() === alias.toLowerCase()));
      if (category) { category.name = name; category.updatedAt = now; }
    }
    if (!category) {
      category = { id: `driving-category-${index + 1}`, name, createdAt: now, updatedAt: now };
      if (next.categories.some(item => item.id === category.id)) category.id = uuid();
      next.categories.push(category);
    }
    categoryIds.set(name, category.id);
  });
  const categoryFor = key => ({
    roundabouts: 'Roundabouts', mirrors: 'Mirrors', stopping: 'Stopping & Braking', speed: 'Speed Management',
    bumps: 'Speed Bumps', lane: 'Lane Discipline', 'changing-lanes': 'Changing Lanes',
    junctions: 'Traffic Signals & Junctions', awareness: 'General Awareness & Driving Habits',
  })[key];
  INITIAL_MISTAKES.forEach(([category, title, description], index) => {
    const categoryId = categoryIds.get(categoryFor(category));
    if (next.mistakes.some(item => item.id === `driving-mistake-v1-${String(index + 1).padStart(2, '0')}` || (item.categoryId === categoryId && item.title.toLowerCase() === title.toLowerCase()))) return;
    next.mistakes.push({ id: `driving-mistake-v1-${String(index + 1).padStart(2, '0')}`, userId, categoryId, title, description, cause: '', correction: '', status: 'NEEDS_WORK', createdAt: now, updatedAt: now });
  });
  const reminderCategoryId = categoryIds.get('Lane Positioning Reference Tips');
  next.reminders ||= [];
  INITIAL_REMINDERS.forEach(([id, title, text]) => {
    const reminderId = `driving-reminder-v1-${id}`;
    if (!next.reminders.some(item => item.id === reminderId || (item.categoryId === reminderCategoryId && item.title.toLowerCase() === title.toLowerCase()))) {
      next.reminders.push({ id: reminderId, userId, categoryId: reminderCategoryId, title, text, createdAt: now, updatedAt: now });
    }
  });
  next.guidanceNotes = [...new Set([...(next.guidanceNotes || []), ...DRIVING_GUIDANCE_NOTES])];
  next.presetVersion = 1;
  return validateDrivingData(next);
}

export function validateDrivingData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.categories) || !Array.isArray(data.mistakes)) throw new Error('Driving Improvement data is invalid.');
  if (data.reminders !== undefined && !Array.isArray(data.reminders)) throw new Error('Driving reminder data is invalid.');
  const categoryIds = new Set();
  for (const category of data.categories) {
    if (!category || typeof category.id !== 'string' || categoryIds.has(category.id) || typeof category.name !== 'string' || !category.name.trim() || category.name.length > 80) throw new Error('Driving category data is invalid.');
    categoryIds.add(category.id);
  }
  const mistakeIds = new Set();
  for (const mistake of data.mistakes) {
    if (!mistake || typeof mistake.id !== 'string' || mistakeIds.has(mistake.id) || typeof mistake.title !== 'string' || !mistake.title.trim() || mistake.title.length > 160 || !categoryIds.has(mistake.categoryId) || !DRIVING_STATUSES.includes(mistake.status) || typeof mistake.cause !== 'string' || typeof mistake.correction !== 'string' || (mistake.description !== undefined && typeof mistake.description !== 'string')) throw new Error('Driving mistake data is invalid.');
    if (mistake.cause.length > 5000 || mistake.correction.length > 5000 || (mistake.description || '').length > 2000) throw new Error('Driving mistake notes are too long.');
    mistakeIds.add(mistake.id);
  }
  const reminderIds = new Set();
  for (const reminder of data.reminders || []) {
    if (!reminder || typeof reminder.id !== 'string' || reminderIds.has(reminder.id) || typeof reminder.title !== 'string' || !reminder.title.trim() || reminder.title.length > 160 || typeof reminder.text !== 'string' || reminder.text.length > 2000 || !categoryIds.has(reminder.categoryId)) throw new Error('Driving reminder data is invalid.');
    reminderIds.add(reminder.id);
  }
  if (data.guidanceNotes !== undefined && (!Array.isArray(data.guidanceNotes) || data.guidanceNotes.some(note => typeof note !== 'string' || note.length > 2000))) throw new Error('Driving guidance data is invalid.');
  if (JSON.stringify(data).length > 500000) throw new Error('Driving Improvement data exceeds the supported size.');
  return data;
}

export function sortDrivingMistakes(mistakes) {
  const priority = { NEEDS_WORK: 0, IMPROVING: 1, CONFIDENT: 2 };
  return [...mistakes].sort((a, b) => priority[a.status] - priority[b.status] || b.updatedAt.localeCompare(a.updatedAt));
}

export function getDrivingSummary(mistakes) {
  return { total: mistakes.length, ...Object.fromEntries(DRIVING_STATUSES.map(status => [status, mistakes.filter(item => item.status === status).length])) };
}

export function makeDrivingMistake(input, userId, now = new Date().toISOString()) {
  return { id: uuid(), userId, categoryId: input.categoryId, title: input.title.trim(), description: (input.description || '').trim(), cause: input.cause.trim(), correction: input.correction.trim(), status: input.status || 'NEEDS_WORK', createdAt: now, updatedAt: now };
}
