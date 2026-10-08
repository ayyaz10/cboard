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
  return url?<img src={url} alt={`Progress photo from ${date}`} onError={()=>setError('Photo could not load.')} />:<p>Loading photo...</p>;
}
export function WeightProgress() {
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [unit,setUnit]=useState('kg'),[form,setForm]=useState(blank),[editing,setEditing]=useState(null),[photo,setPhoto]=useState(null),[reading,setReading]=useState(false);
  const [confirm,setConfirm]=useState(null),[compare,setCompare]=useState(['','']),[cleanup,setCleanup]=useState([]);
  const [photoViewer,setPhotoViewer]=useState(false),[compareMode,setCompareMode]=useState(false),[activePhotoId,setActivePhotoId]=useState(null);
  const lock=useRef(false),mounted=useRef(true),imageJob=useRef(0),formRef=useRef(null),photoDialog=useRef(null);
  useEffect(()=>{mounted.current=true;reload();return()=>{mounted.current=false;imageJob.current++}},[]);
  useEffect(()=>{
    const dialog=photoDialog.current;
    if(!dialog)return;
    if(photoViewer&&!dialog.open)dialog.showModal();
    else if(!photoViewer&&dialog.open)dialog.close();
  },[photoViewer]);
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
  const entries=data?.entries||[],stats=weightSummary(entries),photos=entries.filter(e=>e.photo_path).sort((a,b)=>a.date.localeCompare(b.date));
  const activePhotoIndex=photos.findIndex(entry=>entry.id===activePhotoId);
  const activePhoto=photos[activePhotoIndex]||photos.at(-1);
  const earlierPhoto=photos.find(entry=>entry.id===compare[0])||photos[0];
  const laterPhoto=photos.find(entry=>entry.id===compare[1])||photos.at(-1);
  const chart=[...entries].reverse().map(e=>({date:e.date,time:Date.parse(e.date),weight:displayWeight(e.weight_kg,unit)}));
  const format=kg=>`${displayWeight(kg,unit)} ${unit}`;
  return <PageShell><section className="panel weight-page p-5 sm:p-8 lg:p-10">
    <AppNavigation activePath="/weight-progress"/>
      <header className="weight-header"><div><span className="pill">Your progress, over time</span><h1>Weight Progress</h1><p>Track weigh-ins over time. Progress photos stay private and load only when you choose to view them.</p></div>
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
            {(photo||form.photo_path)&&<button type="button" className="danger-action" onClick={()=>{setPhoto(null);setForm({...form,photo_path:null})}}>Remove photo</button>}
            <div className="weight-actions"><button className="weight-primary" type="submit">{busy?'Saving...':editing?'Save changes':'Save weigh-in'}</button>{editing&&<button type="button" onClick={reset}>Cancel edit</button>}</div>
          </fieldset>
          {reading&&<p role="status">Preparing photo...</p>}
        </form>
        <section className="weight-card weight-chart-card"><div className="weight-card-heading"><div><span className="weight-eyebrow">Trend</span><h2>Weight over time</h2></div>{entries.length>0&&<span className="weight-count">{entries.length} weigh-in{entries.length===1?'':'s'}</span>}</div>
          {entries.length?<><div className="weight-chart" role="img" aria-label={`Weight trend across ${entries.length} weigh-ins in ${unit}; exact values are in the history below.`}><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{top:20,right:18,left:0,bottom:10}}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)"/><XAxis dataKey="time" type="number" domain={['dataMin','dataMax']} tick={{fill:'var(--color-text-secondary)',fontSize:12}} axisLine={{stroke:'var(--color-border)'}} tickLine={{stroke:'var(--color-border)'}} tickFormatter={value=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'})}/><YAxis domain={['auto','auto']} width={65} tick={{fill:'var(--color-text-secondary)',fontSize:12}} axisLine={{stroke:'var(--color-border)'}} tickLine={{stroke:'var(--color-border)'}}/><Tooltip contentStyle={{background:'var(--color-surface-raised)',borderColor:'var(--color-border-strong)',borderRadius:'var(--radius-card)',color:'var(--color-text)'}} labelFormatter={value=>new Date(value).toISOString().slice(0,10)} formatter={value=>[`${value} ${unit}`,'Weight']}/><Line dataKey="weight" type="monotone" stroke="var(--color-accent)" strokeWidth={3} dot={{r:4,fill:'var(--color-accent)',stroke:'var(--color-surface)'}} activeDot={{r:6}} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>{entries.length===1&&<p className="weight-muted">Add another weigh-in to see how your trend develops.</p>}</>:<div className="weight-empty-chart"><strong>Your trend starts with your first weigh-in.</strong><p>Your dated entries will appear here as a simple chart.</p></div>}
        </section>
      </div>
      <section className="weight-card weight-photo-library"><div className="weight-card-heading"><div><span className="weight-eyebrow">Private gallery</span><h2>Progress photos</h2><p className="weight-muted">Photos stay hidden until you open the viewer.</p></div><span className="weight-count">{photos.length} photo{photos.length===1?'':'s'}</span></div>
        {photos.length?<button className="weight-primary" type="button" onClick={()=>{setCompareMode(false);setActivePhotoId(photos.at(-1).id);setPhotoViewer(true)}}>View progress photos</button>:<p className="weight-muted">Add a photo to any weigh-in to start your private timeline.</p>}
      </section>
      <dialog className="weight-photo-dialog" ref={photoDialog} aria-labelledby="weight-photo-dialog-title" onCancel={()=>setPhotoViewer(false)} onClick={event=>{if(event.target===photoDialog.current)setPhotoViewer(false)}}>
        <div className="weight-photo-dialog-header"><div><span className="weight-eyebrow">Private gallery</span><h2 id="weight-photo-dialog-title">Progress photos</h2></div><button type="button" className="weight-photo-close" aria-label="Close photo viewer" onClick={()=>setPhotoViewer(false)}>×</button></div>
        {photos.length>0&&<>
          <div className="weight-photo-toolbar"><span>{compareMode?'Compare two dates':`${activePhotoIndex+1} of ${photos.length}`}</span><button type="button" disabled={photos.length<2} onClick={()=>setCompareMode(value=>!value)}>{compareMode?'View one photo':'Compare photos'}</button></div>
          {compareMode&&photos.length>1?<div className="weight-compare">
            {[{label:'Earlier photo',entry:earlierPhoto,index:0},{label:'Later photo',entry:laterPhoto,index:1}].map(({label,entry,index})=><figure key={label}>
              <label>{label}<select value={entry.id} onChange={event=>setCompare(values=>values.map((value,i)=>i===index?event.target.value:value))}>{photos.map(item=><option key={item.id} value={item.id}>{item.date} · {format(item.weight_kg)}</option>)}</select></label>
              <Photo path={entry.photo_path} userId={data.userId} date={entry.date}/><figcaption>{entry.date} · {format(entry.weight_kg)}</figcaption>
            </figure>)}
          </div>:activePhoto&&<>
            <div className="weight-photo-stage"><Photo path={activePhoto.photo_path} userId={data.userId} date={activePhoto.date}/></div>
            <div className="weight-photo-caption"><strong>{activePhoto.date}</strong><span>{format(activePhoto.weight_kg)}</span>{activePhoto.note&&<p>{activePhoto.note}</p>}</div>
            <div className="weight-photo-navigation"><button type="button" disabled={activePhotoIndex<=0} onClick={()=>setActivePhotoId(photos[activePhotoIndex-1]?.id)}>← Earlier</button><button type="button" disabled={activePhotoIndex>=photos.length-1} onClick={()=>setActivePhotoId(photos[activePhotoIndex+1]?.id)}>Later →</button></div>
          </>}
        </>}
      </dialog>
      <section className="weight-card"><div className="weight-card-heading"><div><span className="weight-eyebrow">Entries</span><h2>Weigh-in history</h2></div><span className="weight-count">{entries.length} total</span></div>{!entries.length?<p className="weight-muted">No weigh-ins yet. Start with today's weight, or add an earlier date.</p>:<div className="weight-history">{entries.map(entry=><article key={entry.id}>
        <div><strong>{format(entry.weight_kg)}</strong><p>{entry.date}{entry.photo_path?' / Photo attached':''}</p>{entry.note&&<p className="weight-note">{entry.note}</p>}</div>
        <div className="weight-actions"><button disabled={busy||reading} onClick={()=>{imageJob.current++;setPhoto(null);setEditing(entry);setForm({date:entry.date,weight:String(displayWeight(entry.weight_kg,unit)),note:entry.note,photo_path:entry.photo_path});setError('');formRef.current?.scrollIntoView({behavior:'smooth',block:'start'})}}>Edit{entry.photo_path?' / view photo':''}</button><button className="danger-action" disabled={busy} onClick={()=>setConfirm(entry.id)}>Delete</button></div>
        {confirm===entry.id&&<div className="weight-alert">Delete this weigh-in{entry.photo_path?' and its photo':''}? <button className="danger-action" disabled={busy} onClick={()=>remove(entry)}>Delete permanently</button><button disabled={busy} onClick={()=>setConfirm(null)}>Cancel</button></div>}
      </article>)}</div>}</section>
    </>}
  </section></PageShell>;
}
