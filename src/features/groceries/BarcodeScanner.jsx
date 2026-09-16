import { useEffect, useRef, useState } from "react";
export function BarcodeScanner({ onCode, onClose }) {
  const video = useRef(null);
  const [error, setError] = useState("");
  const callback = useRef(onCode);
  callback.current = onCode;
  useEffect(() => {
    let cancelled = false, controls, stream, found = false;
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera scanning needs HTTPS and a supported browser. Enter the barcode below instead.");
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        controls = await new BrowserMultiFormatReader().decodeFromStream(stream, video.current, (result, _error, scanner) => {
          const code = result?.getText();
          if (!cancelled && !found && /^(?:\d{8}|\d{12,14})$/.test(code || "")) {
            found = true; scanner.stop(); stream?.getTracks().forEach((track) => track.stop()); callback.current(code);
          }
        });
        if (cancelled) controls.stop();
      } catch (err) {
        stream?.getTracks().forEach((track) => track.stop());
        if (!cancelled) setError(err.name === "NotAllowedError" ? "Camera permission was denied. Allow access or type the barcode below." : err.message || "Camera unavailable. Type the barcode below.");
      }
    }
    start();
    return () => { cancelled = true; controls?.stop(); stream?.getTracks().forEach((track) => track.stop()); };
  }, []);
  return <div>
    <video ref={video} muted playsInline className="g-scan-video" />
    <p role="status">{error || "Hold the barcode steady inside the camera view."}</p>
    <button type="button" onClick={onClose}>Stop camera</button>
  </div>;
}
