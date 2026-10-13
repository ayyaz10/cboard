# CBoard nutrition OCR service

This separate HTTP service is the advanced provider for nutrition-label scans. The React/PWA bundle stays lightweight: CBoard posts one reviewed/cropped image to this service, receives PaddleOCR-VL document output, normalizes the detected table through CBoard's existing nutrition parser, then asks the user to review values before applying them.

## Local development

Use Python 3.12. The model is loaded once at startup and its weights are downloaded from the official model host on first launch. Uploaded images are size-checked, written to a temporary file for inference, and deleted in a `finally` block. OCR output and photos are never persisted by this service.

From the repository root in PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r nutrition-ocr-service\requirements.txt
$env:CBOARD_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
$env:PADDLEOCR_DEVICE = "cpu"
Push-Location nutrition-ocr-service
uvicorn app:app --host 127.0.0.1 --port 8765
Pop-Location
```

In a second terminal, configure the frontend URL and start Vite:

```powershell
$env:VITE_NUTRITION_OCR_URL = "http://localhost:8765/api/nutrition-ocr"
npm run dev
```

Run the hard image check against the original Milka regression fixture after the service reports healthy:

```powershell
node scripts/check-milka-paddle-ocr.mjs
```

Health check: `GET http://localhost:8765/health`. Image endpoint: `POST /api/nutrition-ocr` with multipart field `image` (JPEG, PNG or WEBP, at most 15 MB and 60 megapixels).

For a local container, build and run the included CPU image:

```powershell
docker build -t cboard-nutrition-ocr ./nutrition-ocr-service
docker run --rm -p 8765:8765 -e CBOARD_ORIGINS="http://localhost:5173" cboard-nutrition-ocr
```

## Deployment

CBoard's current web app is a static Vite/GitHub Pages PWA with Supabase Edge Functions; it has no persistent Python API host. Deploy this service separately on an appropriately sized host, set `PADDLEOCR_DEVICE`, `CBOARD_ORIGINS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `NUTRITION_OCR_REQUIRE_AUTH=true`, then build CBoard with `VITE_NUTRITION_OCR_URL=https://your-private-service/api/nutrition-ocr`. The browser sends the logged-in Supabase access token; the service validates it against Supabase Auth without sending the image there. The URL must be served over HTTPS when the CBoard site uses HTTPS. Keep the service private to the CBoard origin as well.

The included Dockerfile is a CPU development image. PaddleOCR-VL 1.6 is a 0.9B model; on the developer workstation used for the Milka proof, CPU inference took several minutes per image. Use an NVIDIA GPU production host for interactive scans and install the PyTorch build compatible with that host's CUDA/driver. Do not expose an unauthenticated public OCR endpoint. The client has a 15-minute request timeout and offers a basic local Tesseract retry if the advanced service is unavailable.

## Diagnostics and regression

Add `?nutritionOcrDebug` in Vite development to see the provider/model, detected table regions and scores, the structured Paddle document result, normalized raw table rows, parsed values, validation findings and final nutrition candidates. Diagnostics are transient in browser memory.

The parser regression `src/features/nutrition/nutritionOcrDocument.test.js` uses sanitized structured output from the actual `src/features/nutrition/fixtures/milka.png` run. `scripts/check-milka-paddle-ocr.mjs` calls the live service with that original image and prints expected versus actual values field by field. For an authenticated service, set `NUTRITION_OCR_ACCESS_TOKEN` in the test shell to a current CBoard access token. The present CPU proof detected the complete table and both bases; it recognized all per-100 g values and read serving fat as 9.2 g (the label says 9.3 g), so the live check reports that mismatch rather than counting the scan as fully correct.
