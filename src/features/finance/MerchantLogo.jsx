import { useState } from 'react';
import { merchantLogo, resolveMerchant } from './merchantDirectory.js';

const symbols={income:'↑',expense:'−',savings:'S',goal:'★',investment:'↗',donation:'+',budget:'B',debt:'✓',transfer:'↔'};

export function MerchantLogo({transaction,merchants=[],className='',showLogos=true}) {
  const [failed,setFailed]=useState(false);
  const merchant=transaction?.type==='transfer'?null:resolveMerchant(transaction,merchants);
  const src=showLogos&&!failed?merchantLogo(merchant):'';
  const initials=(merchant?.displayName||transaction?.title||'£').trim().slice(0,1).toUpperCase();
  return <span className={`f-merchant-avatar ${className}`} data-type={transaction?.type||'opening'} title={merchant?.displayName||transaction?.title||'Finance movement'} aria-label={merchant?.displayName||transaction?.title||`${transaction?.type||'finance'} movement`}>
    {src?<img src={src} alt={`${merchant?.displayName||'Merchant'} logo`} loading="lazy" onError={()=>setFailed(true)}/>:<span aria-hidden="true">{transaction?.type==='transfer'?symbols.transfer:initials||symbols[transaction?.type]||'£'}</span>}
  </span>;
}
