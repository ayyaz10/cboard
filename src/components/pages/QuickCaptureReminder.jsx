import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button.jsx';
import { Dialog } from '../ui/Dialog.jsx';
import { FormField } from '../ui/FormField.jsx';
import { createReminder, createReminderId } from '../../services/reminderService.js';
import { createTask, createTaskId } from '../../services/taskService.js';
import { localDateTimeToInstant } from '../../services/reminderDateTime.js';
import './quickCaptureReminder.css';

function storageKey(userId) { return `cboard:quick-capture:${userId}:v2`; }
function createEmptyDraft() { return { type: 'task', title: '', description: '', priority: 'normal', date: '', time: '', attempt: null }; }
function reminderDefaults() { const due=new Date(Date.now()+60*60*1000); due.setMinutes(0,0,0); const pad=value=>String(value).padStart(2,'0'); return {date:`${due.getFullYear()}-${pad(due.getMonth()+1)}-${pad(due.getDate())}`,time:`${pad(due.getHours())}:${pad(due.getMinutes())}`}; }function readDraft(userId) {
  try { const saved = JSON.parse(localStorage.getItem(storageKey(userId)) || 'null'); if (saved && ['task','reminder'].includes(saved.type) && typeof saved.title === 'string') return { ...createEmptyDraft(), ...saved }; }
  catch (error) { console.warn('Quick Capture draft could not be read.', error); }
  return createEmptyDraft();
}
function dueInstant(draft, required) {
  if (!draft.date && !draft.time && !required) return null;
  if (!draft.date || !draft.time) throw new Error(required ? 'Choose both a date and time for a reminder.' : 'Choose both a date and time, or clear both fields.');
  const dueAt = localDateTimeToInstant(draft.date, draft.time);
  if (required && Date.parse(dueAt) <= Date.now()) throw new Error('Choose a date and time in the future.');
  return dueAt;
}
export function QuickCaptureReminder({ userId, onSaved }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(() => userId ? readDraft(userId) : createEmptyDraft());
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState('');
  const titleRef = useRef(null), lock = useRef(false), ownerRef = useRef(userId);
  useEffect(() => { ownerRef.current=userId; setDraft(userId?readDraft(userId):createEmptyDraft()); setOpen(false); setSaving(false); setError(''); setSaved(''); lock.current=false; },[userId]);
  useEffect(() => { if(!userId)return; try { localStorage.setItem(storageKey(userId),JSON.stringify(draft)); } catch(error) { console.warn('Quick Capture draft could not be saved locally.',error); } },[draft,userId]);
  useEffect(() => { if(open) requestAnimationFrame(()=>titleRef.current?.focus()); },[open]);
  function change(changes) { setDraft(value=>({...value,...changes,attempt:null})); setError(''); setSaved(''); }
  async function submit(event,retry=false) {
    event.preventDefault(); if(lock.current||!userId)return;
    const type=draft.type, title=draft.title.trim(); if(!title||title.length>120){setError('Enter a title from 1 to 120 characters.');return;}
    const same=draft.attempt&&draft.attempt.type===type&&draft.attempt.title===title&&draft.attempt.description===(draft.description||'').trim()&&draft.attempt.priority===draft.priority&&draft.attempt.date===draft.date&&draft.attempt.time===draft.time;
    let attempt;
    if((retry||same)&&draft.attempt) attempt=draft.attempt;
    else { let dueAt; try { dueAt=dueInstant(draft,type==='reminder'); } catch(problem) { setError(problem.message);return; }
      attempt={id:type==='task'?createTaskId():createReminderId(),type,title,description:(draft.description||'').trim(),priority:draft.priority,dueAt,date:draft.date,time:draft.time}; }    lock.current=true;setSaving(true);setError('');setSaved('');setDraft(value=>({...value,...attempt,attempt}));
    try {
      if(attempt.type==='task') await createTask({id:attempt.id,title:attempt.title,description:attempt.description,dueAt:attempt.dueAt,priority:attempt.priority});
      else await createReminder({id:attempt.id,title:attempt.title,dueAt:attempt.dueAt});
      if(ownerRef.current!==userId)return;
      onSaved?.();try{localStorage.removeItem(storageKey(userId));}catch(problem){console.warn('Saved capture draft could not be cleared.',problem);}
      setDraft(createEmptyDraft());setOpen(false);setSaved(attempt.type==='task'?'Task saved':'Reminder saved');
    } catch(problem) { if(ownerRef.current===userId)setError(problem?.message||`${type==='task'?'Task':'Reminder'} could not be confirmed. Keep this form open and retry.`); }
    finally { if(ownerRef.current===userId){lock.current=false;setSaving(false);} }
  }
  function close(){if(!saving)setOpen(false);}
  return <>
    <div className="quick-capture-entry"><Button variant="primary" onClick={()=>{setError('');setSaved('');setOpen(true);}}>Quick Capture</Button>{saved&&<span role="status" className="quick-capture-saved">{saved}</span>}</div>
    <Dialog open={open} onClose={close} labelledBy="quick-capture-title" className="quick-capture-dialog">
      <form onSubmit={event=>submit(event)} noValidate>
        <header className="quick-capture-heading"><div><span className="ui-eyebrow">Quick Capture</span><h2 id="quick-capture-title">New {draft.type}</h2></div></header>
        <div role="group" aria-label="Capture type" className="quick-capture-type"><Button type="button" aria-pressed={draft.type==='task'} onClick={()=>change({type:'task'})}>Task</Button><Button type="button" aria-pressed={draft.type==='reminder'} onClick={()=>change({type:'reminder',...(!draft.date&&!draft.time?reminderDefaults():{})})}>Reminder</Button></div>
        <FormField label="Title" htmlFor="quick-capture-reminder-title"><input ref={titleRef} id="quick-capture-reminder-title" className="ui-control" autoComplete="off" maxLength={120} required value={draft.title} onChange={event=>change({title:event.target.value})}/></FormField>
        {draft.type==='task'&&<><FormField label="Description (optional)" htmlFor="quick-capture-description"><textarea id="quick-capture-description" className="ui-control" maxLength={2000} value={draft.description} onChange={event=>change({description:event.target.value})}/></FormField><FormField label="Priority" htmlFor="quick-capture-priority"><select id="quick-capture-priority" className="ui-control" value={draft.priority} onChange={event=>change({priority:event.target.value})}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></FormField></>}
        <div className="quick-capture-datetime"><FormField label={`Date${draft.type==='task'?' (optional)':''}`} htmlFor="quick-capture-reminder-date"><input id="quick-capture-reminder-date" className="ui-control" type="date" required={draft.type==='reminder'} value={draft.date} onChange={event=>change({date:event.target.value})}/></FormField><FormField label={`Time${draft.type==='task'?' (optional)':''}`} htmlFor="quick-capture-reminder-time"><input id="quick-capture-reminder-time" className="ui-control" type="time" required={draft.type==='reminder'} value={draft.time} onChange={event=>change({time:event.target.value})}/></FormField></div>
        <p className="quick-capture-timezone">{draft.type==='reminder'?'Reminder time uses your device local timezone.':'Leave date and time empty for an undated task.'}</p>
        {error&&<p className="quick-capture-error" role="alert">{error}</p>}
        <div className="quick-capture-actions">{draft.attempt&&<Button type="button" disabled={saving} onClick={event=>submit(event,true)}>{saving?'Saving...':'Retry save'}</Button>}<Button variant="primary" type="submit" disabled={saving}>{saving?'Saving...':draft.type==='task'?'Save task':'Save reminder'}</Button><Button type="button" disabled={saving} onClick={close}>Cancel</Button></div>
      </form>
    </Dialog>
  </>;
}
