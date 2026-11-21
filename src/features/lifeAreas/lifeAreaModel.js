const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLORS = ['#8b5cf6', '#22c55e', '#0ea5e9', '#f97316', '#ec4899', '#eab308'];
const ICONS = ['✨', '💪', '📚', '💼', '🏠', '🌱', '🎯', '🎨'];
export const LIFE_AREA_COLORS = COLORS;
export const LIFE_AREA_ICONS = ICONS;

export function createLifeRecordId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure Life Area IDs are unavailable in this browser.');
  return globalThis.crypto.randomUUID();
}

export function normalizeAreaInput(input) {
  const name = String(input?.name || '').trim(), description = String(input?.description || '').trim();
  const icon = ICONS.includes(input?.icon) ? input.icon : ICONS[0];
  const color = COLORS.includes(String(input?.color || '').toLowerCase()) ? String(input.color).toLowerCase() : COLORS[0];
  if (!name || name.length > 80) throw new Error('Give this life area a name up to 80 characters.');
  if (description.length > 500) throw new Error('Keep the life area description under 500 characters.');
  return { name, description, icon, color };
}

export function normalizeLifeItemInput(input) {
  const name = String(input?.name || '').trim(), description = String(input?.description || '').trim();
  const itemType = input?.itemType, status = input?.status || 'active', targetDate = input?.targetDate || null;
  if (!name || name.length > 100) throw new Error('Give this project or skill a name up to 100 characters.');
  if (description.length > 1000) throw new Error('Keep the description under 1,000 characters.');
  if (!['project', 'skill'].includes(itemType)) throw new Error('Choose Project or Skill.');
  if (!['active', 'paused', 'completed', 'archived'].includes(status)) throw new Error('Choose a valid status.');
  if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new Error('Choose a valid target date.');
  if (targetDate) {
    const [year, month, day] = targetDate.split('-').map(Number), parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error('Choose a valid target date.');
  }
  return { name, description, itemType, status, targetDate };
}

export function normalizeSourceUrl(value, sourceType) {
  const input = String(value || '').trim();
  if (!input) return '';
  if (input.length > 2048) throw new Error('Keep the source URL under 2,048 characters.');
  let parsed;
  try { parsed = new URL(input); } catch { throw new Error('Enter a valid source URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error('Source links must use HTTP or HTTPS and must not contain login credentials.')
  if (sourceType === 'youtube' && !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(parsed.hostname.toLowerCase())) throw new Error('For a YouTube source, use a youtube.com or youtu.be link.');
  return parsed.toString();
}

export function parseYouTubeTimestamp(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  if (/^\d+$/.test(input)) { const seconds = Number(input); if (seconds <= 360000) return seconds; }
  else {
    const match = input.match(/^(?:(\d{1,3}):)?([0-5]?\d):([0-5]?\d)$/);
    if (match) { const seconds = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]); if (seconds <= 360000) return seconds; }
  }
  throw new Error('Enter a YouTube timestamp such as 4:32 or 1:04:32.');
}

export function youtubeTimestampUrl(sourceUrl, seconds) {
  if (!sourceUrl || !Number.isInteger(seconds) || seconds < 0) return '';
  let parsed;
  try { parsed = new URL(sourceUrl); } catch { return ''; }
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(parsed.hostname.toLowerCase())) return '';
  parsed.searchParams.set('t', `${seconds}s`);
  return parsed.toString();
}

export function validLifeAreaId(value) { return UUID.test(String(value || '')); }
