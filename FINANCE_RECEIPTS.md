# Finance receipt scanning

## Architecture and storage

Receipt image → browser Tesseract.js 7 worker → independent text parser → editable transaction form → existing private Supabase Finance workspace.

OCR runs on the device. The worker, WASM cores and English language model are served from CBoard, with no third-party OCR requests or API keys. One worker is reused within an open transaction form; cancel/close disposes it. If cancellation happens during worker initialization, the worker terminates as soon as initialization finishes. OCR assets are loaded on demand and eligible for the existing PWA cache, rather than being downloaded during app installation.

Images are validated as JPEG/PNG/WEBP, limited to 15 MB and 60 megapixels decoded. Processing uses at most 2.5 megapixels; OCR candidates are bounded to 4 megapixels / 3,200 pixels and upscaled by at most 2x. Browser image orientation is respected; manual scan rotation is available. Thermal variants are compared rather than trusting a single threshold.

`transaction.receipt` is optional structured JSON with receipt totals, currency and time, plus an `items` array. Each item has a stable UUID, transaction ID, original item text, display/normalized names, quantity, unit, integer minor-unit prices and timestamps. Existing transactions keep their shape. This fits the existing `finance_workspaces.state` JSONB column and ownership/RLS checks: no SQL schema change or migration is necessary. Updates replace the receipt item array and preserve existing IDs; transaction duplication creates new item IDs.

Images and full OCR text are temporary, available only while reviewing. There is no general Finance attachment storage; the existing photo bucket belongs specifically to Weight Progress. This feature does not repurpose it. Only allowlisted structured receipt fields persist; likely full card numbers are filtered/redacted.

## Review and parsing

Use **Scan receipt** in Finance, or expand **Receipt scan & items** inside a transaction form. Upload/select an image or use the camera input on supporting devices, then scan. Nothing saves until the transaction form is submitted.

Review merchant, transaction date/total, receipt time/currency/subtotal/tax/discounts and individual item fields. Add/delete items, inspect the original image and temporary OCR text, and correct mistakes. Existing transactions retain their merchant/date/amount when a receipt is attached. Saved item details expand in Transactions and remain editable through Edit.

The UK-first generic parser supports:

- Simple prices, comma/period decimals and currency symbols.
- `2 x 1.45`, `3 @ 1.50`, uppercase X and ×, including two-line layouts.
- kg/g/L/ml quantities and prices per weight, including g-to-kg conversion.
- UK slash/dash dates, two-digit years, ISO dates and 24-hour times.
- Subtotal, tax/VAT, discounts and likely final-total labels, including totals on the next line.
- Common payment, address, loyalty, card and VAT-table noise filtering; known retailer header hints with a generic fallback.

Unclear quantities/prices remain empty. Item sums, missing fields, repeated lines, quantity/price mismatches and likely duplicate transactions show warnings; OCR imperfections do not force rejection. Values are never silently adjusted to reconcile totals. Foreign-currency amounts must be reviewed/converted to Finance's currency by the user.

## Files

Added: `receiptOcr.js`, `receiptParser.js`, `receiptData.js`, `ReceiptEditor.jsx`, `receiptParser.test.js` under `src/features/finance/`; `scripts/receipt-ocr-assets.js`; `scripts/check-finance-receipts.cjs`; this note.

Changed: `FinancePage.jsx`, `finance.css`, `vite.config.js`, `scripts/pwa-build.js`, `package.json`, `package-lock.json`.

## Verification

- `node --test src/features/finance/*.test.js src/pwa/*.test.js` — 47 tests pass, including 20 receipt parser, layout, geometry and image-processing tests.
- `npm run build` — production build succeeds; existing large-chunk/mixed-import warnings remain. This JavaScript project has no separate typecheck command.
- `scripts/check-finance-receipts.cjs` — real browser OCR of both the synthetic receipt and the supplied original Aldi photo; parse/prefill, editable fields, add/remove, mobile width, save/reload, stable IDs, normal transactions, attaching to an existing transaction, corrupt input, cancellation/retry, worker reuse and same-origin OCR asset loading. Auth/persistence are test doubles, so no live account is modified.

To rerun the browser check, start Vite on port 5177 and set `PLAYWRIGHT_PATH` to an installed Playwright package (Chrome required), then run `node scripts/check-finance-receipts.cjs`. `RECEIPT_TEST_URL` can override the URL.

## Limitations and future scope

English printed receipts only initially; no PDF/HEIC support. Camera availability varies by browser/device. OCR can use noticeable CPU during scanning, and first use needs an asset download. Blurry, faded, skewed, multi-column or unfamiliar receipt layouts may need substantial correction. Merchant recognition and item extraction are heuristics, not retailer-certified parsers. Tested with the supplied original Aldi photo and a synthetic receipt, not a broad receipt corpus or physical mobile cameras. Saving still requires the app's existing online Finance connection.

Grocery matching, inventory changes, bank syncing and permanent receipt-image storage are intentionally not implemented. Stable item records and normalized names are available for later Grocery integration.


## Accuracy improvement verified against the supplied Aldi photo

The previous pipeline processed the full photograph with one PSM 6 OCR pass and discarded word coordinates. Background patterns, reverse-side printing and locally tilted text confused segmentation. The permissive parser then accepted corrupted total/VAT rows as products. Running the shipped version against the original photo reproduced missing-total and false-product failures (exact OCR text varies by runtime).

The revised pipeline adds dependency-free image processing in a separate Web Worker:

1. Find a coherent paper region, with a long-edge detector when the background joins the paper component. Apply a projective transform only when a plausible quadrilateral is detected; retain the original as fallback.
2. Prepare grayscale, local illumination-normalized contrast, light sharpening and locally adaptive binary variants. Preserve decimal points; avoid a single global threshold.
3. Estimate global skew and detect local text rows from character components. Straighten those rows separately for curved paper, retaining their geometry for development diagnostics.
4. Compare a bounded set of candidates using Tesseract LSTM English: PSM 6 (block), PSM 4 (column) and PSM 11 (sparse). At most four candidate OCR passes are used, with an early exit when totals, item sums and independent receipt fields agree. The supplied photo selects the second, adaptive row-aligned candidate.
5. Preserve OCR word/line boxes and confidence, reconstruct spatial rows, and score structured results using product evidence, total/date/merchant, sum reconciliation and printed item count when readable. Prices are never changed merely to balance a receipt.

The Aldi adapter separates SKU codes and tax markers, recognises letter-spaced totals, rejects payment/VAT/footer rows, and attaches preceding quantity/unit-price lines only with arithmetic agreement. Names retain rawText, rawName and normalizedName separately. Price-token repairs are restricted to decimal-shaped monetary context. Warnings identify uncertain individual item fields and unreadable/count-mismatched item metadata.

Verified result from the exact original photo, using the real browser pipeline (no mocked OCR):

- ALDI STORES; 29 September 2026; 15:16; GBP; total 9.85.
- All eight visible product names, with line prices 1.59, 0.65, 0.69, 0.85, 3.58, 1.99, 0.25, 0.25.
- MILLED/WHOLE CHIA: quantity 2, unit price 1.79, line total 3.58. Nine units overall.
- No VAT, total, payment or footer entries in the item list.
- Review edits, add/remove, mobile-width rendering, saving/reload, stable IDs, attaching to existing transactions, cancellation/retry and corrupt-image recovery pass.

Some SKU digits and the printed item-count character are still misread. The item-count uncertainty is disclosed instead of inventing a value. Conflicting candidate prices are flagged even when the selected value is correct. This improvement supports keeping Tesseract for now, with mandatory user review; it is not evidence of universal receipt accuracy. No alternate/cloud engine was added.

CPU work is higher than the former single pass, but preprocessing runs off the UI thread, one OCR worker is reused, candidates are bounded and scanning stops early when supported. During development on this desktop, individual OCR candidates took roughly 2 to 3 seconds; phone speed and first-download time vary.

Development diagnostics: append `receiptDebug=1` to a Vite development URL to inspect the crop, processed candidates, PSM, scores, boxes, confidence and parsed data. These controls are excluded from production. Run `scripts/compare-receipt-ocr.cjs <local-image-path> --baseline` with PLAYWRIGHT_PATH configured for an exact-photo comparison against commit 35304ca. Private diagnostic images/text are written only to the OS temporary directory. For the full Aldi browser regression, set RECEIPT_TEST_IMAGE to the supplied photo before running `scripts/check-finance-receipts.cjs`. The private original image is not committed or uploaded.

Additional modules: receiptImageProcessing.js, receiptPreprocess.worker.js, receiptLayout.js, receiptAccuracy.test.js and fixtures/aldiReceipt.js. No new dependency, database migration, Grocery integration or permanent image storage was introduced.
