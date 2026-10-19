/** Common interface for OCR engines: input recognition, capabilities, availability and disposal. */
export function createOcrProvider({name,capabilities={},available=()=>true,recognizeImage,dispose=()=>{}}){
  if(typeof recognizeImage!=='function')throw new TypeError('OCR providers must implement recognizeImage(input, options).');
  return {
    name,
    getCapabilities:()=>({...capabilities}),
    isAvailable:()=>Boolean(available()),
    recognizeImage:(input,options={})=>recognizeImage(input,options),
    dispose,
  };
}
