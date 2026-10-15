import { id } from './financeData.js';

const defaultRows = [
  ['Aldi',['aldi stores','aldi kirkcaldy','aldi ferrard road'],'aldi.co.uk'],
  ['Lidl',['lidl stores'],'lidl.co.uk'],['Tesco',['tesco express','tesco extra','tesco supermarket'],'tesco.com'],
  ['Asda',['asda stores'],'asda.com'],['Morrisons',['wm morrisons','morrisons daily'],'morrisons.com'],
  ["Sainsbury's",['sainsburys','sainsbury’s','sainsburys local'],'sainsburys.co.uk'],
  ['Farmfoods',['farm foods'],'farmfoods.co.uk'],["McDonald's",['mcdonalds','mcdonald','mcd'],'mcdonalds.com'],
  ['KFC',['kentucky fried chicken'],'kfc.co.uk'],['Burger King',['burgerking'],'burgerking.co.uk'],
  ['Costa',['costa coffee'],'costa.co.uk'],['Starbucks',['starbucks coffee'],'starbucks.co.uk'],
  ['Subway',['subway restaurants'],'subway.com'],['Greggs',['greggs plc'],'greggs.co.uk'],
  ['Stagecoach',['stagecoach bus'],'stagecoachbus.com'],['ScotRail',['scotrail trains'],'scotrail.co.uk'],
  ['Amazon',['amazon prime','amazon marketplace'],'amazon.co.uk'],['eBay',['ebay uk'],'ebay.co.uk'],
  ['Deliveroo',['deliveroo uk'],'deliveroo.co.uk'],['Uber',['uber trip'],'uber.com'],['Uber Eats',['ubereats','uber eats uk'],'ubereats.com'],
];

export const defaultMerchants = defaultRows.map(([displayName, aliases, domain]) => ({
  id: `system-${displayName.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,
  displayName, aliases: [...new Set([displayName, ...aliases])], normalizedAliases: [...new Set([displayName, ...aliases])].map(normalizeMerchantName), logoType: 'default',
  logoUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, domain,
  categorySuggestions: [], createdAt: null, updatedAt: null, system: true,
}));

export function normalizeMerchantName(value='') {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

export function matchMerchant(value, customMerchants=[]) {
  const query = normalizeMerchantName(value);
  if (!query) return null;
  const custom = (Array.isArray(customMerchants)?customMerchants:[]).filter(item=>item && item.id && item.displayName);
  const all = [...custom.map(item=>({...item,system:false})), ...defaultMerchants];
  const aliases = merchant => [...new Set([...(merchant.normalizedAliases||[]),merchant.displayName,...(merchant.aliases||[])])].map(normalizeMerchantName).filter(Boolean);
  for (const merchant of custom) if (normalizeMerchantName(merchant.displayName)===query) return merchant;
  for (const merchant of defaultMerchants) if (normalizeMerchantName(merchant.displayName)===query) return merchant;
  for (const merchant of custom) if (aliases(merchant).includes(query)) return merchant;
  for (const merchant of defaultMerchants) if (aliases(merchant).includes(query)) return merchant;
  // Match a complete known name at the start, allowing store/location or note suffixes.
  for (const merchant of all) {
    const names=aliases(merchant).sort((a,b)=>b.length-a.length);
    if (names.some(name=>query.startsWith(`${name} `))) return merchant;
  }
  // Safe typo tolerance is restricted to single-token brand names and one edit.
  if (!query.includes(' ')) {
    for (const merchant of all) for (const name of aliases(merchant)) {
      if (name.includes(' ') || name.length < 5 || Math.abs(name.length-query.length)>1) continue;
      let i=0,j=0,diff=0; while(i<query.length&&j<name.length){if(query[i]===name[j]){i++;j++;continue;}if(++diff>1)break;if(query.length>name.length)i++;else if(name.length>query.length)j++;else{i++;j++;}}
      diff += (query.length-i)+(name.length-j);
      if(diff===1)return merchant;
    }
  }
  return null;
}

export function resolveMerchant(transaction, customMerchants=[]) {
  const list=Array.isArray(customMerchants)?customMerchants:[];
  if(transaction?.merchantId){const linked=list.find(item=>item.id===transaction.merchantId)||defaultMerchants.find(item=>item.id===transaction.merchantId);if(linked)return linked;}
  return matchMerchant(transaction?.title, list);
}

export function merchantSuggestions(value, customMerchants=[]) {
  const query=normalizeMerchantName(value);
  if(!query)return [];
  return [...customMerchants,...defaultMerchants].filter(merchant=>[merchant.displayName,...(merchant.aliases||[])].some(alias=>normalizeMerchantName(alias).includes(query))).slice(0,6);
}

export async function prepareMerchantLogo(file) {
  if(!file || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPG, or WEBP logo image.');
  if(file.size>3*1024*1024) throw new Error('Logo image must be smaller than 3 MB.');
  const source=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read this image.'));reader.readAsDataURL(file)});
  const image=await new Promise((resolve,reject)=>{const item=new Image();item.onload=()=>resolve(item);item.onerror=()=>reject(new Error('This image could not be opened.'));item.src=source});
  const scale=Math.min(1,256/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const optimized=canvas.toDataURL('image/webp',.86);
  if(optimized.length>500000) throw new Error('The resized logo is still too large. Choose a smaller image.');
  return optimized;
}

export function makeMerchant(displayName, aliases, logoData) {
  const name=String(displayName||'').trim();
  if(!name || name.length>80) throw new Error('Enter a merchant name up to 80 characters.');
  const aliasList=String(aliases||'').split(/[,\n]/).map(item=>item.trim()).filter(Boolean);
  if(!aliasList.some(item=>normalizeMerchantName(item)===normalizeMerchantName(name))) aliasList.unshift(name);
  const savedAliases=[...new Set(aliasList)];
  return {id:id(),displayName:name,aliases:savedAliases,normalizedAliases:[...new Set(savedAliases.map(normalizeMerchantName).filter(Boolean))],logoType:logoData?'custom':'none',logoData:logoData||'',categorySuggestions:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}

export function merchantLogo(merchant) { return merchant?.logoData || merchant?.logoUrl || ''; }
