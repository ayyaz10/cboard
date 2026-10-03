import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReceipt,normalizeReceiptPrice,receiptWarnings} from './receiptParser.js';
import {aldiReceipt,aldiExpectedPrices} from './fixtures/aldiReceipt.js';
import {reconstructReceiptLines,scoreReceiptCandidate} from './receiptLayout.js';
import {perspectiveMap,thermalVariants,detectReceiptRegion} from './receiptImageProcessing.js';
import {receiptDraft,serializeReceipt} from './receiptData.js';

test('Aldi regression: eight products, nine units, total and metadata',()=>{
  const result=parseReceipt(aldiReceipt);
  assert.equal(result.merchantName,'ALDI STORES');assert.equal(result.date,'2026-09-29');assert.equal(result.time,'15:16');
  assert.equal(result.currency,'GBP');assert.equal(result.total,985);assert.equal(result.tax,0);assert.equal(result.itemCount,9);
  assert.equal(result.totalConfirmed,true);assert.equal(result.confidence.total,98);
  assert.deepEqual(result.items.map(item=>item.lineTotal),aldiExpectedPrices);
  assert.equal(result.items.reduce((sum,item)=>sum+item.quantity,0),9);
  const chia=result.items[4];assert.equal(chia.name,'MILLED/WHOLE CHIA');assert.equal(chia.quantity,2);assert.equal(chia.unitPrice,179);
  assert.equal(chia.retailerProductCode,'386021');assert.equal(chia.rawName,'MILLED/WHOLE CHIA');assert.equal(chia.normalizedName,'milled whole chia');
  assert.equal(result.items[6].name,'GREEK MARINADES');
  assert.ok(result.items.every(item=>!/vat|card|total|eft|sale|aldi/i.test(item.name)));
  assert.deepEqual(receiptWarnings(result),[]);
});
test('corrupted screenshot metadata cannot become a product; payment confirms total',()=>{
  const text=aldiReceipt.replace('T o t a l 9.85','T oO ties 9.85').replace('A 00.0%','2 A 00.0%');
  const result=parseReceipt(text);assert.equal(result.items.length,8);assert.equal(result.total,985);
  for(const line of ['2 A 00.0% Net 9.85 Vat 0.00','VAT 0.00','Card Sales GBP 9.85','EFT No 4885','Merchant ID 41644','9 Items']) assert.equal(parseReceipt(line).items.length,0);
});
test('quantity association requires arithmetic agreement, not merely adjacency',()=>{
  const result=parseReceipt(aldiReceipt.replace('1.79','1.19'));
  assert.equal(result.items[4].quantity,null);assert.equal(result.items[4].unitPrice,null);
  assert.ok(receiptWarnings(result).some(warning=>warning.includes('Receipt says 9')));
});
test('price corrections are restricted to monetary context',()=>{
  assert.equal(normalizeReceiptPrice('OIL SOAP O.65 A'),'OIL SOAP 0.65 A');
  assert.equal(normalizeReceiptPrice('MILK 1.S9 A'),'MILK 1.59 A');
  assert.equal(normalizeReceiptPrice('SOAP SODA'),'SOAP SODA');
  assert.equal(parseReceipt('SHOP\nOIL SOAP O.65 A\nTOTAL 0.65').items[0].name,'OIL SOAP');
});
test('spatial reconstruction joins a price block to its product row',()=>{
  const word=(text,x,y,confidence=90)=>({text,confidence,bbox:{x0:x,y0:y,x1:x+text.length*8,y1:y+15}});
  const words=[word('762747',10,100),word('GREEK',80,100),word('MARINADES',135,101),word('0.25',400,102),word('A',450,101),word('TOTAL',10,140),word('0.25',400,141)];
  const lines=reconstructReceiptLines({blocks:words.map(item=>({paragraphs:[{lines:[{words:[item]}]}]}))});
  assert.equal(lines.length,2);assert.equal(lines[0].text,'762747 GREEK MARINADES 0.25 A');
  assert.equal(parseReceipt({text:'',lines}).items[0].lineTotal,25);
});
test('candidate scoring favours complete products rather than high-confidence footer',()=>{
  const good=scoreReceiptCandidate(parseReceipt(aldiReceipt),75),bad=scoreReceiptCandidate(parseReceipt('ALDI\nTOTAL 9.85\n9 Items'),99);
  assert.ok(good.score>bad.score);assert.equal(good.complete,true);assert.equal(good.countMatches,true);
});
test('projective transform maps all four corners exactly',()=>{
  const corners=[[10,20],[90,15],[100,180],[5,190]],map=perspectiveMap(corners);
  [[0,0],[1,0],[1,1],[0,1]].forEach(([u,v],i)=>map(u,v).forEach((value,j)=>assert.ok(Math.abs(value-corners[i][j])<1e-6)));
});
test('thermal normalization retains dark ink under uneven lighting; blank image does not crop',()=>{
  const width=100,height=160,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*4;const ink=x>30&&x<40&&y>40&&y<100;data[p]=data[p+1]=data[p+2]=ink?45:150+x/2;data[p+3]=255;}
  const {normalized,adaptive}=thermalVariants({data,width,height});
  assert.ok(normalized[60*width+35]<60);assert.equal(adaptive[60*width+35],0);assert.equal(adaptive[20*width+70],255);
  assert.equal(detectReceiptRegion({data:new Uint8ClampedArray(width*height*4).fill(255),width,height}),null);
});
test('saved items preserve raw name and SKU separately from corrected display name',()=>{
  const draft=receiptDraft(parseReceipt(aldiReceipt));draft.items[0].name='Corrected name';
  const saved=serializeReceipt(draft,{id:'tx',title:'ALDI',date:'2026-09-29',amount:985,updatedAt:'now'});
  assert.equal(saved.items[0].rawName,'ASIA GREEN GARDEN');assert.equal(saved.items[0].retailerProductCode,'727175');assert.equal(saved.itemCount,9);
});
