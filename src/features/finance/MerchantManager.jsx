import { useMemo, useState } from 'react';
import { defaultMerchants, makeMerchant, normalizeMerchantName, prepareMerchantLogo } from './merchantDirectory.js';
import { MerchantLogo } from './MerchantLogo.jsx';

const blank={displayName:'',aliases:'',logoData:''};

export function MerchantManager({data,change,confirmAction}) {
  const profiles=data.merchantProfiles||[];
  const [draft,setDraft]=useState(blank),[editing,setEditing]=useState(null),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const entries=useMemo(()=>{
    const defaults=defaultMerchants.map(item=>({...item,...(profiles.find(profile=>profile.id===item.id)||{}),system:true,defaultLogo:item.logoUrl,customized:profiles.some(profile=>profile.id===item.id)}));
    const customs=profiles.filter(item=>!defaultMerchants.some(base=>base.id===item.id)).map(item=>({...item,system:false}));
    return [...defaults,...customs].filter(item=>(filter==='all'||(filter==='default'?item.system:!item.system))&&(!query||`${item.displayName} ${(item.aliases||[]).join(' ')}`.toLowerCase().includes(query.toLowerCase())));
  },[profiles,query,filter]);
  async function readLogo(file){try{const logoData=await prepareMerchantLogo(file);setDraft(current=>({...current,logoData}));setError('')}catch(err){setError(err.message)}}
  function begin(item=null){setEditing(item?.id||null);setDraft(item?{displayName:item.displayName,aliases:(item.aliases||[]).join(', '),logoData:item.logoData||''}:blank);setError('')}
  async function save(event){event.preventDefault();try{
    const base=editing&&defaultMerchants.find(item=>item.id===editing);
    const previous=profiles.find(item=>item.id===editing);
    const next=makeMerchant(draft.displayName,draft.aliases,draft.logoData);
    next.id=editing||next.id;next.createdAt=previous?.createdAt||next.createdAt;next.updatedAt=new Date().toISOString();
    if(base){next.system=true;next.logoUrl=base.logoUrl;next.domain=base.domain;if(!next.logoData&&previous?.logoData)next.logoData=previous.logoData;}
    const saved=await change(state=>{state.merchantProfiles=state.merchantProfiles.filter(item=>item.id!==next.id);state.merchantProfiles.push(next);return state},editing?'Merchant profile updated':'Merchant profile added');
    if(!saved)return;setDraft(blank);setEditing(null);setError('');
  }catch(err){setError(err.message)}}
  async function remove(item){if(!await confirmAction({title:item.system?'Reset merchant logo?':'Delete merchant profile?',message:item.system?`“${item.displayName}” will return to its built-in logo. Transactions will keep matching the default merchant.`:`“${item.displayName}” will be removed. Past transactions stay in your history and will show their fallback badge.`,confirmLabel:item.system?'Reset logo':'Delete profile'}))return;await change(state=>{state.merchantProfiles=state.merchantProfiles.filter(profile=>profile.id!==item.id);return state},item.system?'Default merchant restored':'Merchant profile deleted');if(editing===item.id)begin()}
  async function submit(event){setBusy(true);try{await save(event)}finally{setBusy(false)}}
  return <section className="f-merchant-manager">
    <header className="f-between"><div><h2 className="text-3xl font-bold">Merchant logos</h2><p className="f-help">Add a merchant once; matching names reuse its logo across Finance.</p></div><span className="f-tag">{profiles.length} saved profiles</span></header>
    <div className="f-merchant-layout mt-5">
      <form className="f-card f-form" onSubmit={submit}><h3>{editing?'Edit merchant profile':'Add merchant profile'}</h3><label>Display name<input required maxLength="80" value={draft.displayName} onChange={event=>setDraft({...draft,displayName:event.target.value})} placeholder="e.g. Spice of India"/></label><label>Aliases<input value={draft.aliases} onChange={event=>setDraft({...draft,aliases:event.target.value})} placeholder="spice india, spice-of-india"/><small className="f-help">Separate alternate names with commas.</small></label><label>Logo image (PNG, JPG, WEBP)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>readLogo(event.target.files?.[0])}/></label>{draft.logoData&&<div className="f-logo-preview"><img src={draft.logoData} alt="Merchant logo preview"/><span>Logo ready</span><button type="button" className="f-button" onClick={()=>setDraft({...draft,logoData:''})}>Remove logo</button></div>}{error&&<p role="alert" className="f-alert">{error}</p>}<div className="f-actions"><button className="f-primary" disabled={busy}>{editing?'Save merchant':'Add merchant'}</button>{editing&&<button type="button" className="f-button" onClick={()=>begin()}>Cancel</button>}</div></form>
      <div><div className="f-toolbar f-merchant-filter"><input className="f-input" aria-label="Search merchants" placeholder="Search merchants or aliases" value={query} onChange={event=>setQuery(event.target.value)}/><select className="f-input" aria-label="Merchant type" value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">All merchants</option><option value="default">Built in</option><option value="custom">My merchants</option></select></div><div className="f-list">{entries.map(item=><article className="f-item f-merchant-row" key={item.id}><MerchantLogo transaction={{title:item.displayName,merchantId:item.id,type:'expense'}} merchants={[...profiles,...defaultMerchants]} /><div className="f-merchant-row-copy"><strong>{item.displayName}</strong><small>{(item.aliases||[]).map(alias=>normalizeMerchantName(alias)).filter(Boolean).join(' · ')}</small><span className="f-tag">{item.system?'Built in':'Custom'}{item.customized?' · customised':''}</span></div><div className="f-actions"><button className="f-button" onClick={()=>begin(item)}>Edit</button><button className="f-button" onClick={()=>begin({...item,logoData:''})}>{item.system?'Replace logo':'Change logo'}</button>{(item.customized||!item.system)&&<button className="f-button danger-action" onClick={()=>remove(item)}>{item.system?'Reset':'Delete'}</button>}</div></article>)}{!entries.length&&<p className="f-empty">No merchants match this search.</p>}</div></div>
    </div>
  </section>;
}
