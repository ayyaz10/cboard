// Dependency-free, bounded image processing, also used by the preprocessing worker.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
export function grayscale({ data, width, height }) {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = .299 * data[i * 4] + .587 * data[i * 4 + 1] + .114 * data[i * 4 + 2];
  return gray;
}
function meanImage(gray, width, height, radius) {
  const stride = width + 1, integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) { row += gray[y * width + x]; integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row; }
  }
  const mean = new Float32Array(gray.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1), y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
    mean[y * width + x] = (integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0]) / ((x1 - x0) * (y1 - y0));
  }
  return mean;
}

// Conservative paper component on a small thumbnail. Colour rejects patterned
// surroundings; only coherent, tall, approximately straight regions are accepted.
export function detectReceiptRegion(image, diagnostics = {}, {minAspect=1.15,minHeight=.55} = {}) {
  const scale = Math.min(1, 360 / image.width, 480 / image.height);
  const width = Math.round(image.width * scale), height = Math.round(image.height * scale);
  const mask = new Uint8Array(width * height), values = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (Math.floor(y / scale) * image.width + Math.floor(x / scale)) * 4;
    const r = image.data[offset], g = image.data[offset + 1], b = image.data[offset + 2];
    const light = (r + g + b) / 3;
    if (Math.max(r, g, b) - Math.min(r, g, b) < 18 && light > 90) values.push(light);
  }
  if (values.length < width * height * .15) return null;
  const floor = Math.max(100, median(values) - 20);
  diagnostics.floor=floor;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (Math.floor(y / scale) * image.width + Math.floor(x / scale)) * 4;
    const rgb = [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
    mask[y * width + x] = Math.max(...rgb) - Math.min(...rgb) < 18 && (rgb[0] + rgb[1] + rgb[2]) / 3 > floor ? 1 : 0;
  }
  const queue = new Int32Array(mask.length), labels = new Int32Array(mask.length);
  let best = [], label = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    label++; let head = 0, tail = 1; queue[0] = start; labels[start] = label;
    while (head < tail) {
      const p = queue[head++], x = p % width;
      for (const n of [p - width, p + width, ...(x ? [p - 1] : []), ...(x < width - 1 ? [p + 1] : [])]) {
        if (n >= 0 && n < mask.length && mask[n] && !labels[n]) { labels[n] = label; queue[tail++] = n; }
      }
    }
    if (tail > best.length) best = Array.from(queue.slice(0, tail));
  }
  if (best.length < width * height * .22) return null;
  diagnostics.coverage=best.length/(width*height);
  // Row spans resist connected background speckles. Close small gaps from letters
  // without following long, thin bridges into the surrounding tablecloth.
  const rows = new Map(), gapLimit=Math.max(3,Math.round(width*.025));
  for(let y=0;y<height;y++){
    let start=-1,last=-1,longest=[0,0];
    for(let x=0;x<=width;x++){
      if(x<width&&mask[y*width+x]){if(start<0)start=x;last=x;}
      if(start>=0&&(x===width||x-last>gapLimit)){if(last-start>longest[1]-longest[0])longest=[start,last];start=-1;}
    }
    if(longest[1]-longest[0]>width*.25)rows.set(y,longest);
  }
  const candidates = [...rows].filter(([, edge]) => edge[1] - edge[0] > width * .25).sort((a, b) => a[0] - b[0]);
  if (candidates.length < height * minHeight) return null;
  const top = candidates[0][0], bottom = candidates.at(-1)[0];
  const middle = candidates.filter(([y]) => y > top + (bottom - top) * .1 && y < bottom - (bottom - top) * .1);
  const fit = side => {
    const slopes=[];
    for(let i=0;i<middle.length;i+=3)for(let j=i+20;j<middle.length;j+=3)slopes.push((middle[j][1][side]-middle[i][1][side])/(middle[j][0]-middle[i][0]));
    const slope=median(slopes),intercept=median(middle.map(([y,e])=>e[side]-slope*y));
    return { at: y => intercept + slope * y, error: median(middle.map(([y, e]) => Math.abs(e[side] - intercept - slope * y))) };
  };
  const left = fit(0), right = fit(1);
  Object.assign(diagnostics,{top,bottom,leftError:left.error,rightError:right.error,left:[left.at(top),left.at(bottom)],right:[right.at(top),right.at(bottom)],width,height});
  if (!Number.isFinite(left.error + right.error) || left.error + right.error > width * .04) return null;
  const receiptWidth = right.at((top + bottom) / 2) - left.at((top + bottom) / 2);
  if (receiptWidth < width * .3 || receiptWidth > width * .94 || (bottom - top) / receiptWidth < minAspect) return null;
  const margin = 5;
  return { corners: [[left.at(top) - margin, top - margin], [right.at(top) + margin, top - margin], [right.at(bottom) + margin, bottom + margin], [left.at(bottom) - margin, bottom + margin]]
    .map(([x, y]) => [clamp(x / scale, 0, image.width - 1), clamp(y / scale, 0, image.height - 1)]), confidence: 'medium' };
}

// Projective mapping from unit square to a detected quadrilateral.
export function perspectiveMap(corners) {
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] = corners;
  const dx1=x1-x2, dx2=x3-x2, dx3=x0-x1+x2-x3, dy1=y1-y2, dy2=y3-y2, dy3=y0-y1+y2-y3;
  const determinant=dx1*dy2-dx2*dy1;
  const g=determinant ? (dx3*dy2-dx2*dy3)/determinant : 0, h=determinant ? (dx1*dy3-dx3*dy1)/determinant : 0;
  return (u,v) => { const divisor=g*u+h*v+1; return [((x1-x0+g*x1)*u+(x3-x0+h*x3)*v+x0)/divisor,((y1-y0+g*y1)*u+(y3-y0+h*y3)*v+y0)/divisor]; };
}
export function warpReceipt(image, region) {
  if (!region) return image;
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const corners=region.corners;
  const width=Math.round(Math.max(distance(corners[0],corners[1]),distance(corners[3],corners[2])));
  const height=Math.round(Math.max(distance(corners[0],corners[3]),distance(corners[1],corners[2])));
  const data=new Uint8ClampedArray(width*height*4), map=perspectiveMap(corners);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const [sx,sy]=map(x/Math.max(1,width-1),y/Math.max(1,height-1));
    const ix=clamp(Math.floor(sx),0,image.width-2),iy=clamp(Math.floor(sy),0,image.height-2),fx=clamp(sx-ix,0,1),fy=clamp(sy-iy,0,1);
    const target=(y*width+x)*4;
    for(let c=0;c<3;c++) data[target+c]=(1-fy)*((1-fx)*image.data[(iy*image.width+ix)*4+c]+fx*image.data[(iy*image.width+ix+1)*4+c])+fy*((1-fx)*image.data[((iy+1)*image.width+ix)*4+c]+fx*image.data[((iy+1)*image.width+ix+1)*4+c]);
    data[target+3]=255;
  }
  return {data,width,height};
}

// Long paper edges remain detectable when neutral backgrounds join the paper's
// connected component. A bounded line search rejects short keyboard/pattern edges.
export function detectReceiptEdges(image) {
  const scale=Math.min(1,320/image.width,440/image.height),width=Math.round(image.width*scale),height=Math.round(image.height*scale);
  const light=new Float32Array(width*height),colour=new Float32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=(Math.floor(y/scale)*image.width+Math.floor(x/scale))*4,r=image.data[p],g=image.data[p+1],b=image.data[p+2];
    light[y*width+x]=(r+g+b)/3;colour[y*width+x]=Math.max(r,g,b)-Math.min(r,g,b);
  }
  const smooth=meanImage(light,width,height,2),saturation=meanImage(colour,width,height,2),edges=[];
  for(const side of [1,-1]){
    const options=[];
    for(let slope=-.22;slope<=.22;slope+=.01)for(let intercept=8;intercept<width-8;intercept+=2){
      let score=0,hits=0,n=0;
      for(let y=Math.round(height*.18);y<height*.94;y+=3){
        const x=Math.round(intercept+slope*y);if(x<6||x>=width-6)continue;
        const difference=side*(smooth[y*width+x+4]-smooth[y*width+x-4]+saturation[y*width+x-4]-saturation[y*width+x+4]);
        score+=clamp(difference,-15,40);if(difference>8)hits++;n++;
      }
      if(n>height*.2&&hits/n>.45)options.push({slope,intercept,score:score/n,hits:hits/n});
    }
    options.sort((a,b)=>b.score-a.score);edges.push(options.slice(0,20));
  }
  let best=null;
  for(const left of edges[0])for(const right of edges[1]){
    const l=left.intercept+left.slope*height/2,r=right.intercept+right.slope*height/2,span=r-l;
    if(span<width*.3||span>width*.9||height/span<1.25||Math.abs(left.slope-right.slope)>.24)continue;
    if(!best||left.score+right.score>best.score)best={left,right,score:left.score+right.score};
  }
  if(!best||best.score<22)return null;
  let top=0;
  // Locate the leading dark-to-paper transition inside the detected side edges.
  const rowLight=y=>{let sum=0,n=0;const l=best.left.intercept+best.left.slope*y,r=best.right.intercept+best.right.slope*y;for(let x=Math.round(l+(r-l)*.25);x<r-(r-l)*.25;x++){if(x>=0&&x<width){sum+=smooth[y*width+x];n++;}}return sum/Math.max(1,n);};
  for(let y=4;y<height*.3;y++)if(rowLight(y)>135&&rowLight(y)-rowLight(y-4)>20){top=Math.max(0,y-4);break;}
  const point=(edge,y,margin)=>[clamp((edge.intercept+edge.slope*y+margin)/scale,0,image.width-1),clamp(y/scale,0,image.height-1)];
  return {corners:[point(best.left,top,-3),point(best.right,top,3),point(best.right,height-1,3),point(best.left,height-1,-3)],confidence:'medium',method:'long-edges'};
}

export function thermalVariants(image) {
  const {width,height}=image, gray=grayscale(image);
  const background=meanImage(gray,width,height,Math.max(12,Math.round(width/35)));
  const normalized=new Uint8ClampedArray(gray.length), adaptive=new Uint8ClampedArray(gray.length);
  // Ratios remove shadows. Contrast separation suppresses faint reverse-side ink.
  // The adaptive difference depends on local brightness, never a single global cutoff.
  for(let i=0;i<gray.length;i++) {
    const ratio=gray[i]/Math.max(1,background[i]);
    normalized[i]=clamp((ratio-.48)/.48*255,0,255);
    adaptive[i]=gray[i]<background[i]-Math.max(9,background[i]*.075)?0:255;
  }
  const blurred=meanImage(normalized,width,height,1), sharpened=new Uint8ClampedArray(gray.length);
  for(let i=0;i<gray.length;i++) sharpened[i]=clamp(normalized[i]+.25*(normalized[i]-blurred[i]),0,255);
  return {gray,normalized:sharpened,adaptive};
}

export function estimateReceiptSkew(gray,width,height) {
  const step=Math.max(1,Math.ceil(Math.max(width,height)/650)), points=[];
  for(let y=Math.round(height*.12);y<height*.65;y+=step) for(let x=Math.round(width*.12);x<width*.92;x+=step) if(gray[y*width+x]<100) points.push([x/step,y/step]);
  if(points.length<150 || points.length>width/step*height/step*.35) return 0;
  const score=angle=>{
    const tangent=Math.tan(angle*Math.PI/180), offset=Math.ceil(width/step*.2), bins=new Uint32Array(Math.ceil(height/step)+offset*2);
    for(const [x,y] of points){const row=Math.round(y-tangent*x)+offset;if(row>=0&&row<bins.length)bins[row]++;}
    return bins.reduce((sum,value)=>sum+value*value,0);
  };
  const baseline=score(0);let best={angle:0,score:baseline};
  for(let angle=-7;angle<=7;angle+=.5){const value=score(angle);if(value>best.score)best={angle,score:value};}
  return best.score>baseline*1.04 && Math.abs(best.angle)<7 ? -best.angle : 0;
}

export function detectTextRows(binary,width,height) {
  const seen=new Uint8Array(binary.length),queue=new Int32Array(binary.length),glyphs=[];
  for(let start=0;start<binary.length;start++){
    if(seen[start]||binary[start]>100)continue;
    let head=0,tail=1,x0=width,x1=0,y0=height,y1=0;queue[0]=start;seen[start]=1;
    while(head<tail){const p=queue[head++],x=p%width,y=Math.floor(p/width);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for(const n of [p-width,p+width,...(x?[p-1]:[]),...(x<width-1?[p+1]:[])])if(n>=0&&n<binary.length&&!seen[n]&&binary[n]<100){seen[n]=1;queue[tail++]=n;}
    }
    const w=x1-x0+1,h=y1-y0+1;
    if(tail>=12&&h>=8&&h<height*.035&&w>=2&&w<width*.3&&x0>width*.025&&x1<width*.975)glyphs.push({x:(x0+x1)/2,y:y1,x0,x1,y0,y1,h});
  }
  if(glyphs.length<30)return [];
  const typical=median(glyphs.map(g=>g.h)),rows=[];
  const fit=points=>{
    const n=points.length,mx=points.reduce((s,p)=>s+p.x,0)/n,my=points.reduce((s,p)=>s+p.y,0)/n;
    const spread=points.reduce((s,p)=>s+(p.x-mx)**2,0);
    const slope=points.length>=3&&spread>typical**2?clamp(points.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0)/spread,-.15,.15):0;
    return {slope,intercept:my-slope*mx};
  };
  for(const glyph of glyphs.filter(g=>g.h>typical*.65).sort((a,b)=>a.x-b.x||a.y-b.y)){
    const candidates=rows.map(row=>({row,error:Math.abs(glyph.y-row.slope*glyph.x-row.intercept)})).filter(({error,row})=>error<typical*.55&&glyph.x-row.lastX<width*.65).sort((a,b)=>a.error-b.error);
    const row=candidates[0]?.row;
    if(row){row.points.push(glyph);Object.assign(row,fit(row.points));row.lastX=glyph.x;}
    else rows.push({points:[glyph],slope:0,intercept:glyph.y,lastX:glyph.x});
  }
  return rows.filter(row=>row.points.length>=2 && Math.max(...row.points.map(p=>p.x1))-Math.min(...row.points.map(p=>p.x0))>typical*.8)
    .map(row=>({...row,height:Math.min(Math.max(...row.points.map(p=>p.h)),median(row.points.map(p=>p.h))*1.15),y:row.slope*width/2+row.intercept}))
    .sort((a,b)=>a.y-b.y);
}

function straightenTextRows(image,binary,rows=detectTextRows(binary,image.width,image.height)) {
  if(rows.length<5||rows.length>70)return null;
  const strips=[];
  for(let index=0;index<rows.length;index++){
    const row=rows[index];
    const pad=Math.max(3,row.height*.12),x0=Math.max(0,Math.min(...row.points.map(p=>p.x0))-pad),x1=Math.min(image.width-1,Math.max(...row.points.map(p=>p.x1))+pad);
    const top=x=>row.slope*x+row.intercept-row.height-pad;
    const bottom=x=>row.slope*x+row.intercept+pad;
    if(bottom(x0)<=top(x0)||bottom(x1)<=top(x1))continue;
    const corners=[[x0,top(x0)],[x1,top(x1)],[x1,bottom(x1)],[x0,bottom(x0)]];
    const strip=warpReceipt(image,{corners});strips.push({strip,x:Math.round(x0),row});
  }
  const gap=Math.max(10,Math.round(median(rows.map(row=>row.height))*.5));
  const height=strips.reduce((sum,{strip})=>sum+strip.height+gap,0)+gap,width=image.width;
  if(width*height>4000000)return null;
  const data=new Uint8ClampedArray(width*height*4).fill(255);let offset=gap;
  for(const {strip,x} of strips){for(let y=0;y<strip.height;y++)data.set(strip.data.subarray(y*strip.width*4,(y*strip.width+Math.min(strip.width,width-x))*4),((offset+y)*width+x)*4);offset+=strip.height+gap;}
  return {data,width,height,rows:rows.map(({slope,intercept,height})=>({slope,intercept,height}))};
}

export function processReceiptPixels(image, { layout = 'receipt' } = {}) {
  let region=null,cropped=image;const detection={};
  try {
    region=layout === 'receipt' ? detectReceiptRegion(image,detection)||detectReceiptEdges(image) : detectReceiptRegion(image,detection,{minAspect:.4,minHeight:.3});
    if(region)cropped=warpReceipt(image,region);
  } catch { region=null;cropped=image; }
  const variants=thermalVariants(cropped);
  const angle=estimateReceiptSkew(variants.adaptive,cropped.width,cropped.height);
  if (layout !== 'receipt') return {region,cropped,variants,angle,detection};
  const binaryRgba=new Uint8ClampedArray(cropped.width*cropped.height*4);
  for(let i=0;i<variants.adaptive.length;i++){binaryRgba[i*4]=binaryRgba[i*4+1]=binaryRgba[i*4+2]=variants.adaptive[i];binaryRgba[i*4+3]=255;}
  const rows=detectTextRows(variants.adaptive,cropped.width,cropped.height);
  const aligned=straightenTextRows({data:binaryRgba,width:cropped.width,height:cropped.height},variants.adaptive,rows);
  for(let i=0;i<variants.normalized.length;i++)binaryRgba[i*4]=binaryRgba[i*4+1]=binaryRgba[i*4+2]=variants.normalized[i];
  const alignedContrast=straightenTextRows({data:binaryRgba,width:cropped.width,height:cropped.height},variants.adaptive,rows);
  return {region,cropped,variants,angle,detection,aligned,alignedContrast};
}
