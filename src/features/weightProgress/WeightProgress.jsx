import { useEffect, useMemo, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Camera, ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import { AppNavigation } from '../../components/layout/AppNavigation';
import { PageShell } from '../../components/layout/PageShell';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { loadWeights, saveWeight, deleteWeight, weightPhotoUrl, removeWeightPhoto } from '../../services/weightService.js';
import { getFoodDiaryDays } from '../../services/foodDiaryService.js';
import { getPreference, setPreference } from '../../services/preferenceService.js';
import { DEFAULT_WEIGHT_FOOD_PAIRING, getFoodDiaryDateForWeight, getLinkedCaloriesForWeight, normalizeWeightFoodPairing, SAME_DAY_PAIRING, WEIGHT_FOOD_PAIRING_KEY } from '../../services/weightFoodPairing.js';
import { getAppHref, navigateTo } from '../../app/useRoute.js';
import { readRecipeImage } from '../recipes/recipeImage.js';
import { displayWeight, formatWeightDate, localDate, weightEntriesInRange, weightInKg, weightSummary, WEIGHT_RANGES } from './weightData.js';
import './weightProgress.css';

const blank = () => ({ date: localDate(), weight: '', note: '', photo_path: null });
const format = (kg, unit) => displayWeight(kg, unit) + ' ' + unit;
const dateTime = date => Date.parse(date + 'T12:00:00Z');

function Photo({ path, userId, date }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setUrl('');
    setError('');
    const refresh = () => weightPhotoUrl(path, userId)
      .then(value => { if (active) setUrl(value); })
      .catch(() => { if (active) setError('Photo could not load.'); });
    refresh();
    const timer = setInterval(refresh, 50 * 60 * 1000);
    return () => { active = false; clearInterval(timer); };
  }, [path, userId, retry]);
  if (error) return <p className="weight-photo-error" role="status">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry photo</button></p>;
  return url ? <img src={url} alt={'Progress photo from ' + formatWeightDate(date)} onError={() => setError('Photo could not load.')} /> : <p className="weight-muted" role="status">Loading photo…</p>;
}

function WeightTooltip({ active, payload, unit }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return <div className="weight-tooltip"><strong>{formatWeightDate(point.date)}</strong><span>{point.weight} {unit}</span></div>;
}

export function WeightProgress() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unit, setUnit] = useState('kg');
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [reading, setReading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [compare, setCompare] = useState(['', '']);
  const [cleanup, setCleanup] = useState([]);
  const [photoViewer, setPhotoViewer] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [activePhotoId, setActivePhotoId] = useState(null);
  const [pairingMode, setPairingMode] = useState(DEFAULT_WEIGHT_FOOD_PAIRING);
  const [pairingReady, setPairingReady] = useState(false);
  const [pairingSaving, setPairingSaving] = useState(false);
  const [pairingError, setPairingError] = useState('');
  const [diaryDays, setDiaryDays] = useState([]);
  const [diaryLoading, setDiaryLoading] = useState(false);
  const [diaryError, setDiaryError] = useState('');
  const [range, setRange] = useState('30d');
  const [historyLimit, setHistoryLimit] = useState(50);
  const lock = useRef(false);
  const mounted = useRef(true);
  const imageJob = useRef(0);
  const photoDialog = useRef(null);

  useEffect(() => {
    mounted.current = true;
    reload();
    return () => { mounted.current = false; imageJob.current++; };
  }, []);
  useEffect(() => {
    const dialog = photoDialog.current;
    if (!dialog) return;
    if (photoViewer && !dialog.open) dialog.showModal();
    else if (!photoViewer && dialog.open) dialog.close();
  }, [photoViewer]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('date');
    if (data?.entries.some(entry => entry.date === requested)) {
      window.requestAnimationFrame(() => document.getElementById('weight-date-' + requested)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  }, [data]);

  async function reload() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await loadWeights();
      if (mounted.current) setData(result);
      const dateKeys = [...new Set(result.entries.flatMap(entry => [
        getFoodDiaryDateForWeight(entry.date, DEFAULT_WEIGHT_FOOD_PAIRING),
        getFoodDiaryDateForWeight(entry.date, SAME_DAY_PAIRING),
      ]).filter(Boolean))];
      if (mounted.current) { setDiaryLoading(true); setDiaryError(''); }
      const [savedPairing, savedDays] = await Promise.allSettled([
        getPreference(WEIGHT_FOOD_PAIRING_KEY, DEFAULT_WEIGHT_FOOD_PAIRING),
        getFoodDiaryDays(dateKeys, result.userId),
      ]);
      if (!mounted.current) return;
      if (savedPairing.status === 'fulfilled') setPairingMode(normalizeWeightFoodPairing(savedPairing.value));
      else setPairingError('Pairing preference could not load. Using the recommended previous-day setting.');
      setPairingReady(true);
      if (savedDays.status === 'fulfilled') setDiaryDays(savedDays.value);
      else setDiaryError(savedDays.reason?.message || 'Food Diary data could not load.');
    } catch (cause) {
      if (mounted.current) setError(cause.message || 'Weight Progress could not load.');
    } finally {
      lock.current = false;
      if (mounted.current) { setBusy(false); setDiaryLoading(false); }
    }
  }
  function addCleanup(path) {
    if (path) setCleanup(paths => [...new Set([...paths, path])]);
  }
  function openNewForm() {
    setEditing(null);
    setForm(blank());
    setPhoto(null);
    setFormDirty(false);
    setError('');
    setFormOpen(true);
  }
  function closeFormNow() {
    imageJob.current++;
    setReading(false);
    setFormOpen(false);
    setDiscardOpen(false);
    setEditing(null);
    setForm(blank());
    setPhoto(null);
    setFormDirty(false);
  }
  function requestCloseForm() {
    if (busy || reading) return;
    if (formDirty) setDiscardOpen(true);
    else closeFormNow();
  }
  function openEditForm(entry) {
    imageJob.current++;
    setPhoto(null);
    setEditing(entry);
    setForm({ date: entry.date, weight: String(displayWeight(entry.weight_kg, unit)), note: entry.note, photo_path: entry.photo_path });
    setFormDirty(false);
    setError('');
    setFormOpen(true);
  }
  async function submit(event) {
    event.preventDefault();
    if (lock.current || reading || !data) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const unchangedWeight = editing && Number(form.weight) === displayWeight(editing.weight_kg, unit);
      const result = await saveWeight({
        date: form.date,
        weight_kg: unchangedWeight ? Number(editing.weight_kg) : weightInKg(form.weight, unit),
        note: form.note,
        photo_path: form.photo_path,
      }, editing, photo, data.userId);
      if (!mounted.current) return;
      setData(current => ({ ...current, entries: [...current.entries.filter(entry => entry.id !== result.entry.id), result.entry].sort((a, b) => b.date.localeCompare(a.date)) }));
      const relatedDates = [getFoodDiaryDateForWeight(result.entry.date, DEFAULT_WEIGHT_FOOD_PAIRING), getFoodDiaryDateForWeight(result.entry.date, SAME_DAY_PAIRING)].filter(Boolean);
      setDiaryLoading(true);
      getFoodDiaryDays(relatedDates, data.userId)
        .then(days => { if (mounted.current) setDiaryDays(current => [...new Map([...current, ...days].map(day => [day.date, day])).values()]); })
        .catch(cause => { if (mounted.current) setDiaryError(cause.message || 'Food Diary data could not load.'); })
        .finally(() => { if (mounted.current) setDiaryLoading(false); });
      addCleanup(result.cleanup);
      closeFormNow();
      setNotice('Weigh-in saved.');
    } catch (cause) {
      if (mounted.current) { setError(cause.message || 'Weigh-in could not be saved.'); addCleanup(cause.cleanup); }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function remove(entry) {
    if (lock.current || !data) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await deleteWeight(entry, data.userId);
      if (!mounted.current) return;
      setData(current => ({ ...current, entries: current.entries.filter(item => item.id !== entry.id) }));
      addCleanup(result.cleanup);
      setDeleteTarget(null);
      if (editing?.id === entry.id) closeFormNow();
      setNotice('Weigh-in deleted.');
    } catch (cause) {
      if (mounted.current) setError(cause.message || 'Weigh-in could not be deleted.');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function upload(file) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP photo up to 5 MB.');
      return;
    }
    const job = ++imageJob.current;
    setReading(true);
    setFormDirty(true);
    setError('');
    try {
      const result = await readRecipeImage(file);
      if (job === imageJob.current && mounted.current) setPhoto(result);
    } catch (cause) {
      if (job === imageJob.current && mounted.current) setError(cause.message || 'Photo could not be prepared.');
    } finally {
      if (job === imageJob.current && mounted.current) setReading(false);
    }
  }
  function changeUnit(next) {
    if (!['kg', 'lb'].includes(next)) return;
    if (formOpen && form.weight.trim()) {
      try { setForm(current => ({ ...current, weight: String(displayWeight(weightInKg(current.weight, unit), next)) })); setFormDirty(true); }
      catch { setError('Clear or correct the weight before changing units.'); return; }
    }
    setUnit(next);
  }
  async function savePairingMode(next) {
    if (next === pairingMode || pairingSaving) return;
    setPairingSaving(true);
    setPairingError('');
    try { await setPreference(WEIGHT_FOOD_PAIRING_KEY, next); if (mounted.current) setPairingMode(next); }
    catch (cause) { if (mounted.current) setPairingError(cause.message || 'Pairing preference could not be saved.'); }
    finally { if (mounted.current) setPairingSaving(false); }
  }

  const entries = data?.entries || [];
  const stats = useMemo(() => weightSummary(entries), [entries]);
  const photos = useMemo(() => entries.filter(entry => entry.photo_path).sort((a, b) => a.date.localeCompare(b.date)), [entries]);
  const chartEntries = useMemo(() => weightEntriesInRange(entries, range), [entries, range]);
  const chart = useMemo(() => chartEntries.map(entry => ({ date: entry.date, time: dateTime(entry.date), weight: displayWeight(entry.weight_kg, unit) })), [chartEntries, unit]);
  const diaryByDate = useMemo(() => new Map(diaryDays.map(day => [day.date, day])), [diaryDays]);
  const linkedDiaryByWeightDate = useMemo(() => new Map(entries.map(entry => [entry.date, getLinkedCaloriesForWeight(entry, diaryByDate, pairingMode)])), [entries, diaryByDate, pairingMode]);
  useEffect(() => {
    if (!data?.userId || diaryLoading) return undefined;
    let active = true;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      const dates = [...new Set(entries.flatMap(entry => [
        getFoodDiaryDateForWeight(entry.date, DEFAULT_WEIGHT_FOOD_PAIRING),
        getFoodDiaryDateForWeight(entry.date, SAME_DAY_PAIRING),
      ]).filter(Boolean))];
      const [preference, linkedDays] = await Promise.allSettled([
        getPreference(WEIGHT_FOOD_PAIRING_KEY, DEFAULT_WEIGHT_FOOD_PAIRING),
        getFoodDiaryDays(dates, data.userId),
      ]);
      if (preference.status === 'fulfilled' && active) { setPairingMode(normalizeWeightFoodPairing(preference.value)); setPairingError(''); }
      else if (active) setPairingError('Pairing preference could not refresh. Using the last saved setting.');
      if (linkedDays.status === 'fulfilled' && active) { setDiaryDays(linkedDays.value); setDiaryError(''); }
      else if (active) setDiaryError(linkedDays.reason?.message || 'Food Diary data could not load.');
    };
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [data?.userId, entries, diaryLoading]);

  const activePhotoIndex = photos.findIndex(entry => entry.id === activePhotoId);
  const activePhoto = photos[activePhotoIndex] || photos.at(-1);
  const earlierPhoto = photos.find(entry => entry.id === compare[0]) || photos[0];
  const laterPhoto = photos.find(entry => entry.id === compare[1]) || photos.at(-1);
  const latestLinked = stats ? linkedDiaryByWeightDate.get(entries[0]?.date) : null;
  const changeText = stats ? (stats.change > 0 ? '+' : stats.change < 0 ? '−' : '') + format(Math.abs(stats.change), unit) : '—';

  return <PageShell><section className="panel weight-page">
    <AppNavigation activePath="/weight-progress"/>
    <header className="weight-header">
      <div><span className="weight-eyebrow">Personal tracking</span><h1>Weight Progress</h1><p>Measurements and trends, at a glance.</p></div>
      <div className="weight-header-actions">
        <label className="weight-unit-control">Unit<select disabled={busy || reading} value={unit} onChange={event => changeUnit(event.target.value)} aria-label="Weight unit"><option value="kg">kg</option><option value="lb">lb</option></select></label>
        <button type="button" className="weight-primary weight-add-button" onClick={openNewForm} disabled={!data || busy}><Plus size={17} aria-hidden="true"/> Add weigh-in</button>
      </div>
    </header>

    {error && !formOpen && <p className="weight-alert" role="alert">{error} <button type="button" disabled={busy} onClick={reload}>Retry</button></p>}
    {notice && <p className="weight-notice" role="status">{notice}</p>}
    {cleanup.length > 0 && <div className="weight-alert" role="alert">A previous photo could not be removed from private storage.
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { for (const path of cleanup) { await removeWeightPhoto(path, data.userId); setCleanup(paths => paths.filter(item => item !== path)); } } catch (cause) { setError(cause.message || 'Photo cleanup failed.'); } finally { setBusy(false); } }}>Retry photo removal</button>
    </div>}

    {!data ? <section className="weight-load-state" aria-live="polite">{busy ? <><span className="weight-loading-dot" aria-hidden="true"/> Loading your measurements…</> : <><strong>Weight Progress could not load.</strong><button type="button" onClick={reload}>Retry</button></>}</section> : <>
      <section className="weight-overview" aria-label="Weight overview">
        <div className="weight-latest"><span className="weight-eyebrow">Latest measurement</span>
          {stats ? <><strong>{format(stats.latest, unit)}</strong><span className="weight-latest-date">Recorded {formatWeightDate(entries[0]?.date)}</span></> : <><strong>—</strong><span className="weight-latest-date">No weigh-ins recorded</span></>}
        </div>
        <div className="weight-overview-stats">
          <div><span>Starting</span><strong>{stats ? format(stats.start, unit) : '—'}</strong></div>
          <div><span>Change</span><strong>{changeText}</strong></div>
          <div><span>Entries</span><strong>{stats?.count ?? 0}</strong></div>
        </div>
      </section>

      <section className="weight-section weight-trend-section" aria-labelledby="weight-trend-title">
        <div className="weight-section-heading"><div><span className="weight-eyebrow">Measurement history</span><h2 id="weight-trend-title">Weight trend</h2></div>
          <div className="weight-range" role="group" aria-label="Chart date range">{WEIGHT_RANGES.map(option => <button key={option.id} type="button" aria-pressed={range === option.id} onClick={() => setRange(option.id)}>{option.label}</button>)}</div>
        </div>
        {chart.length ? <>
          <p className="weight-chart-summary" id="weight-chart-summary">{chart.length} recorded {chart.length === 1 ? 'measurement' : 'measurements'} from {formatWeightDate(chart[0].date)} to {formatWeightDate(chart.at(-1).date)}. Values are shown in {unit}.</p>
          <div className="weight-chart" role="img" aria-label={'Weight trend with ' + chart.length + ' recorded measurements from ' + formatWeightDate(chart[0].date) + ' to ' + formatWeightDate(chart.at(-1).date) + ' in ' + unit} aria-describedby="weight-chart-summary">
            <ResponsiveContainer width="100%" height="100%"><LineChart accessibilityLayer data={chart} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--color-border)"/>
              <XAxis dataKey="time" type="number" domain={chart.length === 1 ? [chart[0].time - 86400000, chart[0].time + 86400000] : ['dataMin', 'dataMax']} tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} axisLine={{ stroke: 'var(--color-border)' }} tickLine={false} tickFormatter={value => formatWeightDate(new Date(value).toISOString().slice(0, 10), { month: 'short', day: 'numeric' })} minTickGap={24}/>
              <YAxis domain={['auto', 'auto']} width={54} tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={value => String(value)}/>
              <Tooltip content={<WeightTooltip unit={unit}/>} cursor={{ stroke: 'var(--color-border-strong)', strokeDasharray: '3 3' }}/>
              <Line dataKey="weight" type="linear" stroke="var(--color-accent)" strokeWidth={2.5} dot={{ r: 3.5, fill: 'var(--color-accent)', stroke: 'var(--surface-primary)', strokeWidth: 2 }} activeDot={{ r: 6, stroke: 'var(--surface-primary)', strokeWidth: 2 }} isAnimationActive={false} connectNulls={false}/>
            </LineChart></ResponsiveContainer>
          </div>
          {chart.length === 1 && <p className="weight-muted">One measurement is recorded in this range. Add another to see a trend.</p>}
          <details className="weight-data-table"><summary>View chart data table</summary><div className="weight-table-scroll"><table><caption>Recorded measurements in the selected range</caption><thead><tr><th scope="col">Date</th><th scope="col">Weight</th></tr></thead><tbody>{chart.map(point => <tr key={point.date}><th scope="row">{formatWeightDate(point.date)}</th><td>{point.weight} {unit}</td></tr>)}</tbody></table></div></details>
        </> : entries.length ? <div className="weight-empty-chart"><strong>No measurements in this range.</strong><p>Choose a wider range or view all recorded dates.</p></div> : <div className="weight-empty-chart"><strong>Your trend starts with your first weigh-in.</strong><p>Save a measurement to see it here.</p><button type="button" className="weight-primary" onClick={openNewForm}><Plus size={16} aria-hidden="true"/> Add weigh-in</button></div>}
      </section>

      <section className="weight-context" aria-labelledby="weight-context-title">
        <div className="weight-context-copy"><span className="weight-eyebrow">Daily context</span><h2 id="weight-context-title">Food Diary pairing</h2><p>Linked intake provides context for each date. It does not explain a weight change on its own.</p></div>
        <fieldset className="weight-pairing" disabled={!pairingReady || pairingSaving}><legend>Pair a weigh-in with</legend>
          <label className={pairingMode === DEFAULT_WEIGHT_FOOD_PAIRING ? 'is-selected' : ''}><input type="radio" name="weight-food-pairing" value={DEFAULT_WEIGHT_FOOD_PAIRING} checked={pairingMode === DEFAULT_WEIGHT_FOOD_PAIRING} onChange={() => savePairingMode(DEFAULT_WEIGHT_FOOD_PAIRING)}/>Previous day</label>
          <label className={pairingMode === SAME_DAY_PAIRING ? 'is-selected' : ''}><input type="radio" name="weight-food-pairing" value={SAME_DAY_PAIRING} checked={pairingMode === SAME_DAY_PAIRING} onChange={() => savePairingMode(SAME_DAY_PAIRING)}/>Same day</label>
        </fieldset>
        {pairingSaving && <span className="weight-context-status" role="status">Saving…</span>}
        {pairingError && <span className="weight-context-status" role="status">{pairingError}</span>}
        {diaryError && <span className="weight-context-status" role="status">{diaryError}</span>}
        {stats && <p className="weight-latest-diary">Latest linked intake: {diaryLoading ? 'Loading…' : latestLinked?.report?.calories == null ? 'No Food Diary entry' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(latestLinked.report.calories) + ' kcal' + (latestLinked.report.missing ? ' · partial' : !latestLinked.day?.complete ? ' · logged' : '')}{latestLinked?.date ? <> · <a href={getAppHref('/food-diary?date=' + latestLinked.date)} onClick={event => { event.preventDefault(); navigateTo('/food-diary?date=' + latestLinked.date); }}>View {formatWeightDate(latestLinked.date)}</a></> : null}</p>}
      </section>

      <div className="weight-lower-grid">
        <section className="weight-section weight-history-section" aria-labelledby="weight-history-title">
          <div className="weight-section-heading"><div><span className="weight-eyebrow">Records</span><h2 id="weight-history-title">History</h2></div><span className="weight-count">{entries.length} total</span></div>
          {!entries.length ? <div className="weight-empty-history"><p>No weigh-ins yet. Add your first measurement when you’re ready.</p><button type="button" className="weight-primary" onClick={openNewForm}><Plus size={16} aria-hidden="true"/> Add weigh-in</button></div> : <>
            <div className="weight-history">{entries.slice(0, historyLimit).map(entry => {
              const linked = linkedDiaryByWeightDate.get(entry.date);
              const linkedLabel = pairingMode === DEFAULT_WEIGHT_FOOD_PAIRING ? 'Previous day' : 'Same day';
              return <article key={entry.id} id={'weight-date-' + entry.date} className={new URLSearchParams(window.location.search).get('date') === entry.date ? 'is-linked-date' : ''}>
                <div className="weight-entry-date">{formatWeightDate(entry.date)}</div>
                <strong className="weight-entry-value">{format(entry.weight_kg, unit)}</strong>
                <div className="weight-entry-markers" aria-label={[entry.note ? 'Has notes' : '', entry.photo_path ? 'Has photo' : '', linked?.day ? 'Food Diary linked' : ''].filter(Boolean).join(', ') || undefined}>
                  {entry.note && <span title="Notes">Note</span>}{entry.photo_path && <Camera size={15} aria-label="Photo attached"/>}{linked?.day && <span title="Food Diary entry">Diary</span>}
                </div>
                <details className="weight-entry-menu"><summary aria-label={'More actions for ' + formatWeightDate(entry.date)}><MoreHorizontal aria-hidden="true" size={19}/></summary><div>
                  <button type="button" disabled={busy || reading} onClick={event => { event.currentTarget.closest('details').open = false; openEditForm(entry); }}>Edit</button>
                  {linked?.date && <a href={getAppHref('/food-diary?date=' + linked.date)} onClick={event => { event.currentTarget.closest('details').open = false; event.preventDefault(); navigateTo('/food-diary?date=' + linked.date); }}>View {linkedLabel} Food Diary</a>}
                  {entry.photo_path && <button type="button" onClick={event => { event.currentTarget.closest('details').open = false; setCompareMode(false); setActivePhotoId(entry.id); setPhotoViewer(true); }}>View photo</button>}
                  <button type="button" className="danger-action" disabled={busy} onClick={event => { event.currentTarget.closest('details').open = false; setDeleteTarget(entry); }}>Delete</button>
                </div></details>
                {entry.note && <p className="weight-note">{entry.note}</p>}
                {linked?.date && <span className="weight-history-diary">{linkedLabel} intake · {diaryError ? 'unavailable' : diaryLoading ? 'loading…' : linked.report?.calories == null ? 'not logged' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(linked.report.calories) + ' kcal' + (linked.report.missing ? ' · partial' : !linked.day?.complete ? ' · logged' : '')}</span>}
              </article>;
            })}</div>
            {entries.length > historyLimit && <button type="button" className="weight-show-more" onClick={() => setHistoryLimit(limit => limit + 50)}>Show {Math.min(50, entries.length - historyLimit)} more entries</button>}
          </>}
        </section>

        <section className="weight-section weight-photo-library" aria-labelledby="weight-photo-title"><div className="weight-section-heading"><div><span className="weight-eyebrow">Private media</span><h2 id="weight-photo-title">Progress photos</h2></div><span className="weight-count">{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</span></div>
          <p className="weight-muted">Photos are private and load only when you open the gallery.</p>
          {photos.length ? <button type="button" className="weight-gallery-button" onClick={() => { setCompareMode(false); setActivePhotoId(photos.at(-1).id); setPhotoViewer(true); }}><Camera size={16} aria-hidden="true"/> Open gallery</button> : <span className="weight-muted">Add a photo to a weigh-in to start your timeline.</span>}
        </section>
      </div>
    </>}

    <Dialog open={formOpen} onClose={requestCloseForm} labelledBy="weight-form-title" className="weight-form-dialog">
      <div className="weight-dialog-heading"><div><span className="weight-eyebrow">{editing ? 'Update measurement' : 'New measurement'}</span><h2 id="weight-form-title">{editing ? 'Edit weigh-in' : 'Add weigh-in'}</h2></div><button type="button" className="weight-close-button" aria-label="Close weigh-in form" onClick={requestCloseForm}>×</button></div>
      {error && <p className="weight-alert" role="alert">{error}</p>}
      <form className="weight-form" onSubmit={submit}>
        <fieldset disabled={busy || reading}><label>Date<input required type="date" max={localDate()} value={form.date} onChange={event => { setForm(current => ({ ...current, date: event.target.value })); setFormDirty(true); }}/></label>
          <label>Weight ({unit})<input required type="number" min="0.01" max={unit === 'kg' ? '1000' : '2204.62'} step="any" inputMode="decimal" autoFocus placeholder={unit === 'kg' ? 'e.g. 72.4' : 'e.g. 159.6'} value={form.weight} onChange={event => { setForm(current => ({ ...current, weight: event.target.value })); setFormDirty(true); }}/></label>
          <details className="weight-optional-fields"><summary>Notes and progress photo <span>Optional</span></summary><div>
            <label>Notes<textarea maxLength={1000} rows="3" placeholder="Anything you want to remember" value={form.note} onChange={event => { setForm(current => ({ ...current, note: event.target.value })); setFormDirty(true); }}/></label>
            <label>Progress photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }}/></label>
            <p className="weight-help">JPG, PNG or WebP up to 5 MB. Photos are stored privately and are not sent to AI.</p>
            {photo ? <img className="weight-preview" src={photo} alt="New progress photo preview"/> : form.photo_path ? <Photo path={form.photo_path} date={form.date} userId={data?.userId}/> : null}
            {(photo || form.photo_path) && <button type="button" className="danger-action" onClick={() => { setPhoto(null); setForm(current => ({ ...current, photo_path: null })); setFormDirty(true); }}>Remove photo</button>}
          </div></details>
          {reading && <p role="status">Preparing photo…</p>}
          <div className="weight-form-actions"><button type="button" onClick={requestCloseForm}>Cancel</button><button type="submit" className="weight-primary" disabled={busy || reading}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save weigh-in'}</button></div>
        </fieldset>
      </form>
    </Dialog>
    <ConfirmDialog isOpen={discardOpen} title="Discard this weigh-in?" message="Your unsaved changes will be lost." confirmLabel="Discard changes" onConfirm={closeFormNow} onCancel={() => setDiscardOpen(false)}/>
    <ConfirmDialog isOpen={Boolean(deleteTarget)} title="Delete weigh-in?" message={'Delete the measurement from ' + (deleteTarget ? formatWeightDate(deleteTarget.date) : '') + (deleteTarget?.photo_path ? ' and its attached progress photo' : '') + '? Related Food Diary records will stay unchanged.' + (error ? ' ' + error : '')} confirmLabel={busy ? 'Deleting…' : 'Delete weigh-in'} onConfirm={() => deleteTarget && remove(deleteTarget)} onCancel={() => !busy && setDeleteTarget(null)}/>

    <dialog className="weight-photo-dialog" ref={photoDialog} aria-labelledby="weight-photo-dialog-title" onCancel={event => { event.preventDefault(); setPhotoViewer(false); }} onClick={event => { if (event.target === photoDialog.current) setPhotoViewer(false); }}>
      <div className="weight-dialog-heading"><div><span className="weight-eyebrow">Private gallery</span><h2 id="weight-photo-dialog-title">Progress photos</h2></div><button type="button" className="weight-close-button" aria-label="Close photo gallery" onClick={() => setPhotoViewer(false)}>×</button></div>
      {photos.length > 0 && <><div className="weight-photo-toolbar"><span>{compareMode ? 'Compare two dates' : (activePhotoIndex + 1) + ' of ' + photos.length}</span><button type="button" disabled={photos.length < 2} onClick={() => setCompareMode(value => !value)}>{compareMode ? 'View one photo' : 'Compare photos'}</button></div>
        {compareMode && photos.length > 1 ? <div className="weight-compare">{[{ label: 'Earlier photo', entry: earlierPhoto, index: 0 }, { label: 'Later photo', entry: laterPhoto, index: 1 }].map(({ label, entry, index }) => <figure key={label}>
          <label>{label}<select value={entry.id} onChange={event => setCompare(values => values.map((value, i) => i === index ? event.target.value : value))}>{photos.map(item => <option key={item.id} value={item.id}>{formatWeightDate(item.date)} · {format(item.weight_kg, unit)}</option>)}</select></label>
          <Photo path={entry.photo_path} userId={data.userId} date={entry.date}/><figcaption>{formatWeightDate(entry.date)} · {format(entry.weight_kg, unit)}</figcaption>
        </figure>)}</div> : activePhoto && <><div className="weight-photo-stage"><Photo path={activePhoto.photo_path} userId={data.userId} date={activePhoto.date}/></div>
          <div className="weight-photo-caption"><strong>{formatWeightDate(activePhoto.date)}</strong><span>{format(activePhoto.weight_kg, unit)}</span>{activePhoto.note && <p>{activePhoto.note}</p>}</div>
          <div className="weight-photo-navigation"><button type="button" disabled={activePhotoIndex <= 0} onClick={() => setActivePhotoId(photos[activePhotoIndex - 1]?.id)}><ChevronLeft size={16} aria-hidden="true"/> Earlier</button><button type="button" disabled={activePhotoIndex >= photos.length - 1} onClick={() => setActivePhotoId(photos[activePhotoIndex + 1]?.id)}>Later <ChevronRight size={16} aria-hidden="true"/></button></div>
        </>}</>}
    </dialog>
  </section></PageShell>;
}
