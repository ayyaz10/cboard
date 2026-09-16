import { useEffect, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AppNavigation } from '../../components/layout/AppNavigation';
import { PageShell } from '../../components/layout/PageShell';
import { loadWeights, saveWeight, deleteWeight, weightPhotoUrl, removeWeightPhoto } from '../../services/weightService';
import { readRecipeImage } from '../recipes/recipeImage';
import { displayWeight, localDate, weightInKg, weightSummary } from './weightData';
import './weightProgress.css';
const blank = () => ({ date:localDate(), weight:'', note:'', photo_path:null });
function Photo({path,userId,date}) {
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;
    setUrl(''); setError('');
    const refresh=()=>weightPhotoUrl(path,userId).then(url=>{if(active)setUrl(url)}).catch(()=>{if(active)setError('Photo could not load.')});
    refresh(); const timer=setInterval(refresh,50*60*1000);
    return()=>{active=false;clearInterval(timer)};
  },[path,userId,retry]);
  if(error)return <p>{error} <button type="button" onClick={()=>setRetry(x=>x+1)}>Retry photo</button></p>;
  return url?<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Progress photo from ${date}`} onError={()=>setError('Photo could not load.')} /></a>:<p>Loading photo...</p>;
}
export function WeightProgress() {
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [unit,setUnit]=useState('kg'),[form,setForm]=useState(blank),[editing,setEditing]=useState(null),[photo,setPhoto]=useState(null),[reading,setReading]=useState(false);
  const [confirm,setConfirm]=useState(null),[compare,setCompare]=useState(['','']),[cleanup,setCleanup]=useState([]);
  const lock=useRef(false),mounted=useRef(true),imageJob=useRef(0),formRef=useRef(null);
  useEffect(()=>{mounted.current=true;reload();return()=>{mounted.current=false;imageJob.current++}},[]);
  async function reload(){
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try{const result=await loadWeights();if(mounted.current)setData(result)}
    catch(e){if(mounted.current)setError(e.message)}
    finally{lock.current=false;if(mounted.current)setBusy(false)}
  }
  function reset(){imageJob.current++;setReading(false);setEditing(null);setForm(blank());setPhoto(null)}
  function addCleanup(path){if(path)setCleanup(paths=>[...new Set([...paths,path])])}
  async function submit(e){
    e.preventDefault();if(lock.current||reading||!data)return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try{
      const result=await saveWeight({date:form.date,weight_kg:editing&&Number(form.weight)===displayWeight(editing.weight_kg,unit)?Number(editing.weight_kg):weightInKg(form.weight,unit),note:form.note,photo_path:form.photo_path},editing,photo,data.userId);
      if(!mounted.current)return;
      setData(d=>({...d,entries:[...d.entries.filter(x=>x.id!==result.entry.id),result.entry].sort((a,b)=>b.date.localeCompare(a.date))}));
      addCleanup(result.cleanup);reset();setNotice('Weigh-in saved.');
    }catch(e){if(mounted.current){setError(e.message);addCleanup(e.cleanup)}}
    finally{lock.current=false;if(mounted.current)setBusy(false)}
  }
  async function remove(entry){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{const result=await deleteWeight(entry,data.userId);if(!mounted.current)return;setData(d=>({...d,entries:d.entries.filter(x=>x.id!==entry.id)}));addCleanup(result.cleanup);setConfirm(null);if(editing?.id===entry.id)reset();setNotice('Weigh-in deleted.');}
    catch(e){if(mounted.current)setError(e.message)}finally{lock.current=false;if(mounted.current)setBusy(false)}
  }
  async function upload(file){
    if(!file)return;const job=++imageJob.current;setReading(true);setError('');
    try{const result=await readRecipeImage(file);if(job===imageJob.current&&mounted.current)setPhoto(result)}
    catch(e){if(job===imageJob.current&&mounted.current)setError(e.message)}finally{if(job===imageJob.current&&mounted.current)setReading(false)}
  }
  function changeUnit(next){
    if(form.weight.trim()){
      try{setForm(f=>({...f,weight:String(displayWeight(weightInKg(f.weight,unit),next))}))}catch{setError('Clear or correct the weight before changing units.');return}
    }
    setUnit(next);
  }
  const entries=data?.entries||[],stats=weightSummary(entries),photos=entries.filter(e=>e.photo_path);
  const chart=[...entries].reverse().map(e=>({date:e.date,time:Date.parse(e.date),weight:displayWeight(e.weight_kg,unit)}));
  const format=kg=>`${displayWeight(kg,unit)} ${unit}`;
  return <PageShell><section className="panel weight-page p-5 sm:p-8 lg:p-10">
    <AppNavigation activePath="/weight-progress"/>
    <header className="weight-header"><div><span className="pill">Your progress, over time</span><h1>Weight Progress</h1><p>Log your weigh-ins and keep a private photo record of your changes.</p></div>
      <label>Weight unit<select value={unit} disabled={busy||reading} onChange={e=>changeUnit(e.target.value)}><option value="kg">Kilograms (kg)</option><option value="lb">Pounds (lb)</option></select></label>
    </header>
    {error&&<p className="weight-alert" role="alert">{error} <button disabled={busy} onClick={reload}>Reload</button></p>}
    {notice&&<p role="status">{notice}</p>}
    {cleanup.length>0&&<div className="weight-alert" role="alert">The record was updated, but an old photo could not be removed from private storage.
      <button disabled={busy} onClick={async()=>{setBusy(true);try{for(const path of cleanup){await removeWeightPhoto(path,data.userId);setCleanup(paths=>paths.filter(p=>p!==path))}}catch(e){setError(e.message)}finally{setBusy(false)}}}>Retry photo removal</button>
    </div>}
    {!data?<p>{busy?'Loading your progress...':'Reload to load your progress.'}</p>:<>
      {stats&&<div className="weight-stats">
        <div><small>Starting weight</small><strong>{format(stats.start)}</strong></div>
        <div><small>Latest weight</small><strong>{format(stats.latest)}</strong></div>
        <div><small>Change since first weigh-in</small><strong>{stats.change>0?'+':''}{format(stats.change)}</strong></div>
        <div><small>Weigh-ins</small><strong>{stats.count}</strong></div>
      </div>}
      <div className="weight-columns">
        <form className="weight-card weight-form" ref={formRef} onSubmit={submit}>
          <h2>{editing?'Edit weigh-in':'Add a weigh-in'}</h2>
          <fieldset disabled={busy||reading}>
            <label>Date<input required type="date" max={localDate()} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
            <label>Weight ({unit})<input required type="number" min="0.01" step="any" placeholder={unit==='kg'?'e.g. 85.5':'e.g. 188.5'} value={form.weight} onChange={e=>setForm({...form,weight:e.target.value})}/></label>
            <label>Notes (optional)<textarea maxLength={1000} rows="2" placeholder="Anything you want to remember" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>
            <label>Body photo (optional)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{upload(e.target.files?.[0]);e.target.value=''}}/></label>
            <p className="weight-help">JPG, PNG or WebP, up to 5 MB. Photos are private to your account and are not sent to AI.</p>
            {photo?<img className="weight-preview" src={photo} alt="New progress photo preview"/>:form.photo_path?<Photo path={form.photo_path} date={form.date} userId={data.userId}/>:null}
            {(photo||form.photo_path)&&<button type="button" onClick={()=>{setPhoto(null);setForm({...form,photo_path:null})}}>Remove photo</button>}
            <div className="weight-actions"><button className="weight-primary" type="submit">{busy?'Saving...':editing?'Save changes':'Save weigh-in'}</button>{editing&&<button type="button" onClick={reset}>Cancel edit</button>}</div>
          </fieldset>
          {reading&&<p role="status">Preparing photo...</p>}
        </form>
        <section className="weight-card"><h2>Weight over time</h2>
          {entries.length?<><div className="weight-chart" role="img" aria-label={`Weight trend across ${entries.length} weigh-ins in ${unit}; exact values are in the history below.`}><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{top:20,right:20,left:0,bottom:10}}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="time" type="number" domain={['dataMin','dataMax']} tickFormatter={value=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'})}/><YAxis domain={['auto','auto']} width={65}/><Tooltip labelFormatter={value=>new Date(value).toISOString().slice(0,10)} formatter={value=>[`${value} ${unit}`,'Weight']}/><Line dataKey="weight" type="linear" stroke="#397044" strokeWidth={3} dot={{r:4}} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>{entries.length===1&&<p>Add another weigh-in to see your trend.</p>}</>:<p>Your chart will appear after your first weigh-in.</p>}
        </section>
      </div>
      <section className="weight-card"><h2>Photo comparison</h2>{photos.length<2?<p>Add photos to two weigh-ins to compare them side by side.</p>:<div className="weight-compare">{[0,1].map(index=>{
        const selected=photos.find(p=>p.id===compare[index])||photos[index===0?photos.length-1:0];
        return <figure key={index}><label>{index===0?'Earlier photo':'Later photo'}<select value={selected.id} onChange={e=>setCompare(values=>values.map((v,i)=>i===index?e.target.value:v))}>{photos.map(p=><option key={p.id} value={p.id}>{p.date} - {format(p.weight_kg)}</option>)}</select></label><Photo path={selected.photo_path} userId={data.userId} date={selected.date}/><figcaption>{selected.date} / {format(selected.weight_kg)}</figcaption></figure>;
      })}</div>}</section>
      <section className="weight-card"><h2>Weigh-in history</h2>{!entries.length?<p>No weigh-ins yet. Start with today's weight, or add an earlier date.</p>:<div className="weight-history">{entries.map(entry=><article key={entry.id}>
        <div><strong>{format(entry.weight_kg)}</strong><p>{entry.date}{entry.photo_path?' / Photo attached':''}</p>{entry.note&&<p className="weight-note">{entry.note}</p>}</div>
        <div className="weight-actions"><button disabled={busy||reading} onClick={()=>{imageJob.current++;setPhoto(null);setEditing(entry);setForm({date:entry.date,weight:String(displayWeight(entry.weight_kg,unit)),note:entry.note,photo_path:entry.photo_path});setError('');formRef.current?.scrollIntoView({behavior:'smooth',block:'start'})}}>Edit{entry.photo_path?' / view photo':''}</button><button disabled={busy} onClick={()=>setConfirm(entry.id)}>Delete</button></div>
        {confirm===entry.id&&<div className="weight-alert">Delete this weigh-in{entry.photo_path?' and its photo':''}? <button disabled={busy} onClick={()=>remove(entry)}>Delete permanently</button><button disabled={busy} onClick={()=>setConfirm(null)}>Cancel</button></div>}
      </article>)}</div>}</section>
    </>}
  </section></PageShell>;
}
