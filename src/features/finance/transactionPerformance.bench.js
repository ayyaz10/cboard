import { performance } from 'node:perf_hooks';
import { filterTransactions, orderedTransactions } from './transactionOrder.js';

const categories=Array.from({length:12},(_,index)=>({id:`c${index}`,name:index===0?'Groceries':`Category ${index}`}));
const measure=operation=>{const start=performance.now();operation();return Number((performance.now()-start).toFixed(2));};

for(const count of [1_000,10_000]){
  const rows=Array.from({length:count},(_,index)=>({
    id:`tx${index}`,date:`2026-${String(1+(index%11)).padStart(2,'0')}-${String(1+(index%27)).padStart(2,'0')}`,
    title:index%13===0?'ALDI weekly shop':`Merchant ${index%90}`,type:index%4===0?'income':'expense',amount:100+index,
    categoryId:`c${index%12}`,note:index%17===0?'household groceries':'',sequence:index,
  }));
  const options={from:'2026-01-01',to:'2026-12-31',query:'aldi',type:'expense',categories};
  filterTransactions(rows,options); // warm module and JIT paths
  const result={transactions:count};
  result.searchMs=measure(()=>filterTransactions(rows,options));
  result.filterMs=measure(()=>filterTransactions(rows,{...options,query:'',category:'c0'}));
  result.sortMs=measure(()=>[...rows].sort((a,b)=>b.amount-a.amount||b.date.localeCompare(a.date)));
  result.first100RenderPreparationMs=measure(()=>orderedTransactions(rows).slice(0,100).map(({id,title,amount,date,categoryId})=>({id,title,amount,date,categoryId})));
  result.detailLookupMs=measure(()=>rows.find(item=>item.id===`tx${count-1}`));
  result.summaryMs=measure(()=>filterTransactions(rows,options).reduce((total,item)=>total+item.amount,0));
  result.maxRenderedRows=100;
  console.log(JSON.stringify(result));
}
