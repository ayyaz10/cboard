import { useEffect, useRef, useState } from 'react';
import { parseFinanceEntry } from '../../services/financeService.js';
export function FinanceQuickAdd({ data, onReview, disabled }) {
  const [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [question, setQuestion] = useState('');
  const job = useRef(0), lock = useRef(false);
  useEffect(() => () => { job.current++; }, []);
  async function submit(event) {
    event.preventDefault();
    if (lock.current || disabled || !text.trim()) return;
    lock.current = true;
    const request = ++job.current;
    setBusy(true); setError(''); setQuestion('');
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    try {
      const result = await parseFinanceEntry({ text, today: date, currency: data.settings.currency,
        categories: data.categories.filter((c) => !c.archived).map(({ id, name, type }) => ({ id, name, type })),
      });
      if (request !== job.current) return;
      if (result.status === 'clarify') setQuestion(result.question);
      else if (result.status === 'ready' && result.transaction) {
        onReview({ ...result.transaction, aiReview: true, expectedCurrency: data.settings.currency });
        setText('');
      } else throw new Error('No transaction draft returned. Try rewording your message.');
    } catch (err) { if (request === job.current) setError(err.message); }
    finally { if (request === job.current) { lock.current = false; setBusy(false); } }
  }
  return <details className="f-card f-quick-add mb-5">
    <summary className="font-bold cursor-pointer">Quick add with AI</summary>
    <form className="f-form mt-3" onSubmit={submit}>
      <label>What would you like to record?
        <textarea rows="2" maxLength={1000} value={text} disabled={busy || disabled}
          onChange={(event) => { setText(event.target.value); setError(''); }}
          placeholder="Add 100 pounds in Travel, title Trip to Spain" />
      </label>
      <p className="f-help">Describe one transaction. Gemini prepares a draft for you to check before saving. Currency: {data.settings.currency}.</p>
      <p className="f-help">Only your message, active category names/types/IDs, currency and today's date are sent. AI requests share the daily allowance with recipe and label reading.</p>
      {question && <p role="status" className="f-alert">{question} Update your message above with the answer, then send again.</p>}
      {error && <p role="alert" className="f-alert">{error}</p>}
      <button className="f-primary" disabled={busy || disabled || !text.trim()}>{busy ? 'Preparing preview...' : 'Send and preview'}</button>
      {busy && <span role="status">Reading your instruction...</span>}
    </form>
  </details>;
}
