import { useEffect, useRef, useState } from 'react';

export function BarcodeImage({ onCode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const job = useRef(0);
  useEffect(() => () => { job.current++; }, []);
  async function decode(file) {
    if (!file) return;
    const id = ++job.current;
    setError(''); setBusy(true);
    let url;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Use a JPG, PNG or WebP image up to 5 MB.');
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      url = URL.createObjectURL(file);
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(url);
      const code = result.getText();
      if (!/^(?:\d{8}|\d{12,14})$/.test(code)) throw new Error('This is not a supported food barcode. Enter its 8, 12, 13 or 14 digit number instead.');
      if (id === job.current) onCode(code);
    } catch (err) {
      if (id === job.current) setError(err.name === 'NotFoundException' ? 'No barcode found. Try a clear, tightly cropped image or enter its number.' : err.message || 'Could not read this barcode. Try another image.');
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (id === job.current) setBusy(false);
    }
  }
  return <div onPaste={event => {
    const file = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'))?.getAsFile();
    if (file) { event.preventDefault(); decode(file); }
  }}>
    <label>Upload barcode image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { decode(event.target.files?.[0]); event.target.value = ''; }} /></label>
    <label>Paste barcode image<textarea rows={2} placeholder="Click here and paste a barcode image" aria-label="Paste barcode image" onChange={event => { event.target.value = ''; }} /></label>
    <p className="g-hint">Images are decoded on your device. Only the barcode number is sent to Open Food Facts.</p>
    {busy && <p role="status">Reading barcode image...</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
