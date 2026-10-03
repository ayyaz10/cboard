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
          candidates.push({name:'original',psm:'6',image:canvas});
          if(processed) for(const [name,pixels,psm] of [['contrast',processed.variants.normalized,'6'],['adaptive',processed.variants.adaptive,'11']]) {
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
              await engine.setParameters({tessedit_pageseg_mode:candidate.psm});
              const data=(await engine.recognize(candidate.image,{}, {text:true,blocks:true})).data;
              const lines=reconstructOcrLines(data),parsed=profile.parse({text:data.text,lines});
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
