import { reconstructOcrLines } from './ocrLayout.js';

export function validateOcrImage(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WEBP image.');
  if (!file.size || file.size > 15 * 1024 * 1024) throw new Error('Choose a image smaller than 15 MB.');
}

export async function prepareOcrImage(file, rotation = 0, crop = null) {
  validateOcrImage(file);
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('This image could not be opened. It may be damaged or in an unsupported format.'); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 60000000) throw new Error('This image is too large to scan safely. Crop or resize it first.');
    const bounds = crop || {left:0,top:0,right:100,bottom:100};
    if (![bounds.left,bounds.top,bounds.right,bounds.bottom].every(Number.isFinite) || bounds.left < 0 || bounds.top < 0 || bounds.right > 100 || bounds.bottom > 100 || bounds.right <= bounds.left || bounds.bottom <= bounds.top) throw new Error('Enter a valid crop inside the image.');
    const sx=bitmap.width*bounds.left/100, sy=bitmap.height*bounds.top/100;
    const sw=bitmap.width*(bounds.right-bounds.left)/100, sh=bitmap.height*(bounds.bottom-bounds.top)/100;
    const scale = Math.min(1, 2400 / Math.max(sw, sh), Math.sqrt(2500000 / (sw * sh)));
    const width = Math.max(1,Math.round(sw * scale)), height = Math.max(1,Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = rotation % 180 ? height : width;
    canvas.height = rotation % 180 ? width : height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2); context.rotate(rotation * Math.PI / 180);
    context.drawImage(bitmap, sx, sy, sw, sh, -width / 2, -height / 2, width, height);
    // Keep colour/contrast intact: heavy thresholding destroys faint thermal ink.
    return canvas;
  } finally { bitmap.close(); }
}

function variantCanvas(pixels, width, height, angle = 0) {
  const source=document.createElement('canvas');source.width=width;source.height=height;
  let rgba=pixels;
  if(pixels.length===width*height){rgba=new Uint8ClampedArray(width*height*4);for(let i=0;i<pixels.length;i++){rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=pixels[i];rgba[i*4+3]=255;}}
  source.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);
  const radians=angle*Math.PI/180,cos=Math.abs(Math.cos(radians)),sin=Math.abs(Math.sin(radians));
  const rotatedWidth=width*cos+height*sin,rotatedHeight=height*cos+width*sin;
  const scale=Math.min(2,3200/Math.max(rotatedWidth,rotatedHeight),Math.sqrt(4000000/(rotatedWidth*rotatedHeight)));
  const canvas=document.createElement('canvas');canvas.width=Math.round(rotatedWidth*scale);canvas.height=Math.round(rotatedHeight*scale);
  const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);
  context.translate(canvas.width/2,canvas.height/2);context.rotate(radians);context.scale(scale,scale);context.drawImage(source,-width/2,-height/2);
  source.width=source.height=0;return canvas;
}

function recoverNutritionPunctuation(lines, image, parsed) {
  const context=image.getContext('2d');
  const processed=new Set();
  for(const column of parsed.columns)for(const field of Object.values(column.nutrients)) {
    const line=lines.find(item=>item.text===field.rawText);
    if(!line?.words?.length || !['g','kcal','kJ','mg','ml'].includes(field.unit))continue;
    const word=line.words.filter(item=>item.bbox.x0>(line.bbox.x0+line.bbox.x1)/2&&/^[<\dOIlS]/.test(item.text)&&field.x>=item.bbox.x0-1&&field.x<=item.bbox.x1+1).sort((a,b)=>Math.abs((a.bbox.x0+a.bbox.x1)/2-field.x)-Math.abs((b.bbox.x0+b.bbox.x1)/2-field.x))[0];
    if(!word)continue;
    if(processed.has(word))continue;processed.add(word);
    const {x0,y0,x1,y1}=word.bbox,w=Math.round(x1-x0),h=Math.round(y1-y0);
    if(w<8||h<8||w*h>25000||x0<0||y0<0||x1>image.width||y1>image.height)continue;
    const pixels=context.getImageData(Math.floor(x0),Math.floor(y0),w,h).data;
    const seen=new Uint8Array(w*h),components=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const start=y*w+x,pixel=start*4,luma=.299*pixels[pixel]+.587*pixels[pixel+1]+.114*pixels[pixel+2];
      if(seen[start]||luma>190)continue;
      const queue=[start];seen[start]=1;let minX=x,maxX=x,minY=y,maxY=y,area=0;
      for(let i=0;i<queue.length;i++) {
        const at=queue[i],cx=at%w,cy=Math.floor(at/w);area++;minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const ax=cx+dx,ay=cy+dy,next=ay*w+ax;if(ax<0||ax>=w||ay<0||ay>=h||seen[next])continue;const p=next*4;if(.299*pixels[p]+.587*pixels[p+1]+.114*pixels[p+2]<=190){seen[next]=1;queue.push(next);}}
      }
      components.push({area,x:(minX+maxX)/2,y:(minY+maxY)/2,bottom:maxY+1,width:maxX-minX+1,height:maxY-minY+1});
    }
    const glyphs=components.filter(item=>item.area>h*.8).sort((a,b)=>a.x-b.x);
    const dot=components.find(item=>item.area>=2&&item.area<=h*1.3&&item.width<=h*.22&&item.height<=h*.18&&item.y>=h*.6&&glyphs.some((left,index)=>left.x<item.x&&glyphs[index+1]?.x>item.x));
    word.pixelCheck={dot:dot?.x??null,glyphs:glyphs.map(item=>item.x),height:h};
    let text=word.text;
    const trailingG=text.endsWith('9')&&glyphs.length>1&&glyphs.at(-1).bottom-glyphs.slice(0,-1).reduce((max,item)=>Math.max(max,item.bottom),0)>=Math.max(2,h*.09);
    if(trailingG)text=`${text.slice(0,-1)}g`;
    const hasDecimal=/[.,]/.test(text);
    if(dot&&!hasDecimal) {
      const before=glyphs.filter(item=>item.x<dot.x).length;
      const digits=[...text.matchAll(/[\dOIlS]/gi)];
      if(before>0&&before<digits.length) {
        let at=0,insert=0;
        for(const match of digits){if(at++===before){insert=match.index;break;}}
        text=`${text.slice(0,insert)}.${text.slice(insert)}`;
      }
    }
    if(text!==word.text) {
      line.ocrText??=line.text;
      word.originalText=word.text;word.text=text;word.pixelEvidence={decimal:!!dot&&(!hasDecimal||/[.,]/.test(text)),unit:trailingG};
      word.confidence=Math.max(word.confidence??0,82);
      line.text=line.words.map(item=>item.text).join(' ');
    }
  }
  return lines;
}

async function preprocess(canvas, register, layout) {
  const worker=new Worker(new URL('./preprocess.worker.js',import.meta.url),{type:'module'});
  return new Promise((resolve,reject)=>{
    const finish=(result,error)=>{clearTimeout(timer);worker.terminate();register(null);error?reject(error):resolve(result);};
    const timer=setTimeout(()=>finish(null,new Error('Preprocessing timed out')),20000);
    register(()=>finish(null,new Error('Scan cancelled.')));
    worker.onmessage=event=>event.data.error?finish(null,new Error(event.data.error)):finish(event.data);
    worker.onerror=()=>finish(null,new Error('Preprocessing unavailable'));
    const image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
    worker.postMessage({data:image.data,width:image.width,height:image.height,layout},[image.data.buffer]);
  });
}

export function createImageOcrSession(profile, onProgress = () => {}) {
  let pending, worker, abort, stopPreprocess, disposed = false, active = false, pass = 0;
  async function getWorker() {
    if (!pending) pending = (async () => {
      const { createWorker } = await import('tesseract.js');
      if (disposed) throw new Error('Scan cancelled.');
      const base = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.origin).href;
      const created = await createWorker('eng', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base.slice(0, -1),
        logger: message => { if (!disposed) onProgress({...message,pass}); }, errorHandler: () => {},
      });
      if (disposed) { await created.terminate(); throw new Error('Scan cancelled.'); }
      worker = created;
      await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
      return worker;
    })();
    return pending;
  }
  return {
    async scan(file, rotation, {debug = false, crop = null} = {}) {
      if (active || disposed) throw new Error('Please finish the current scan first.');
      active = true;
      let canvas;
      const canvases=[];
      try {
        canvas = await prepareOcrImage(file, rotation, crop);
        if (disposed) throw new Error('Scan cancelled.');
        onProgress({status:'Preparing image',progress:0});
        let processed;
        try { processed=await preprocess(canvas,stop=>{stopPreprocess=stop;},profile.layout); } catch { if(disposed)throw new Error('Scan cancelled.'); }
        const candidates=[];
        if(profile.layout === 'nutrition') {
          const original=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
          const enlarged=variantCanvas(original.data,canvas.width,canvas.height);canvases.push(enlarged);
          // Sparse mode handles website labels and values separated by a wide
          // gap; preserve the full image so basis headings remain available.
          candidates.push({name:'original-upscaled',psm:'11',image:enlarged});
          if(processed) for(const [name,pixels,psm] of [['grayscale',processed.variants.gray,'6'],['light-sharpen',processed.variants.gentle,'11']]) {
            const image=variantCanvas(pixels,processed.cropped.width,processed.cropped.height,processed.angle);canvases.push(image);candidates.push({name,psm,image});
          }
        } else if(processed){
          const {cropped,variants,angle}=processed;
          if(processed.alignedContrast){const image=variantCanvas(processed.alignedContrast.data,processed.alignedContrast.width,processed.alignedContrast.height);canvases.push(image);candidates.push({name:'line-aligned-contrast',psm:'6',image});}
          if(processed.aligned){const image=variantCanvas(processed.aligned.data,processed.aligned.width,processed.aligned.height);canvases.push(image);candidates.push({name:'line-aligned',psm:'4',image});}
          for(const [name,pixels,psm] of (processed.aligned?[['grayscale',variants.gray,'11']]:[['contrast',variants.normalized,'6'],['adaptive',variants.adaptive,'4'],['grayscale',variants.gray,'11']])) {
            const image=variantCanvas(pixels,cropped.width,cropped.height,angle);canvases.push(image);candidates.push({name,psm,image});
          }
          // Detection is deliberately provisional; retain an uncropped escape route.
          if(processed.region)candidates.push({name:'original-fallback',psm:'6',image:canvas});
        } else candidates.push({name:'original-fallback',psm:'6',image:canvas});
        const cancelled = new Promise((_, reject) => { abort = () => reject(new Error('Scan cancelled.')); });
        const recognition = (async () => {
          const engine = await getWorker();
          if (disposed) throw new Error('Scan cancelled.');
          const results=[];
          for(const candidate of candidates){
            if(disposed)throw new Error('Scan cancelled.');
            pass++;onProgress({status:'recognizing text',progress:0,pass});
            const started=performance.now();
            try{
              await engine.setParameters({tessedit_pageseg_mode:candidate.psm,tessedit_char_whitelist:''});
              const data=(await engine.recognize(candidate.image,{}, {text:true,blocks:true})).data;
              let lines=reconstructOcrLines(data,{preserveNumericPunctuation:profile.layout==='nutrition'});
              let parsed=profile.parse({text:lines.map(line=>line.text).join('\n'),lines});
              if(profile.layout==='nutrition'&&candidate.name==='original-upscaled'){
                lines=recoverNutritionPunctuation(lines,candidate.image,parsed);
                parsed=profile.parse({text:lines.map(line=>line.text).join('\n'),lines});
              }
              const quality=profile.score(parsed,data.confidence);
              results.push({text:data.text,lines,parsed,confidence:data.confidence,...quality,name:candidate.name,psm:candidate.psm,elapsedMs:Math.round(performance.now()-started),image:debug?candidate.image.toDataURL('image/png'):undefined});
              if(profile.shouldStop?.(results))break;
            }catch(error){if(disposed)throw error;}
          }
          if(!results.length)throw new Error('OCR failed.');
          results.sort((a,b)=>b.score-a.score);
          const best=results[0];
          profile.finalize?.(best,results);
          let cropPreview;
          if(debug&&processed){const preview=variantCanvas(processed.cropped.data,processed.cropped.width,processed.cropped.height);cropPreview=preview.toDataURL('image/png');preview.width=preview.height=0;}
          return {...best,debug:debug?{selected:best.name,cropped:cropPreview,region:processed?.region,angle:processed?.angle,rowDeskew:processed?.aligned?.rows,detection:processed?.detection,original:canvas.toDataURL('image/png'),candidates:results}:undefined};
        })();
        return await Promise.race([recognition, cancelled]);
      } finally { active = false; abort = null; pass=0; for(const image of [canvas,...canvases])if(image){image.width=0;image.height=0;} }
    },
    dispose() {
      disposed = true;
      stopPreprocess?.();
      abort?.();
      if (worker) { void worker.terminate(); worker = null; }
      // Initialization cannot be interrupted by Tesseract's public API; getWorker
      // terminates immediately on completion if this session has been disposed.
      pending?.catch(() => {});
    },
  };
}
