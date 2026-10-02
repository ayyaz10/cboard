# Finance receipt scanning

## Architecture and storage

Receipt image → browser Tesseract.js 7 worker → independent text parser → editable transaction form → existing private Supabase Finance workspace.

OCR runs on the device. The worker, WASM cores and English language model are served from CBoard, with no third-party OCR requests or API keys. One worker is reused within an open transaction form; cancel/close disposes it. If cancellation happens during worker initialization, the worker terminates as soon as initialization finishes. OCR assets are loaded on demand and eligible for the existing PWA cache, rather than being downloaded during app installation.

Images are validated as JPEG/PNG/WEBP, limited to 15 MB and 60 megapixels decoded, and resized to at most 2,400 pixels on the longest side / 4 megapixels before recognition. Browser image orientation is respected; manual scan rotation is available. No aggressive thresholding is applied to faint receipt text.

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

- `node --test src/features/finance/*.test.js src/pwa/*.test.js` — 38 tests pass, including 11 new receipt tests.
- `npm run build` — production build succeeds; existing large-chunk/mixed-import warnings remain. This JavaScript project has no separate typecheck command.
- `scripts/check-finance-receipts.cjs` — real browser OCR of a synthetic receipt; parse/prefill, editable fields, add/remove, mobile width, save/reload, stable IDs, normal transactions, attaching to an existing transaction, corrupt input, cancellation/retry, worker reuse and same-origin OCR asset loading. Auth/persistence are test doubles, so no live account is modified.

To rerun the browser check, start Vite on port 5177 and set `PLAYWRIGHT_PATH` to an installed Playwright package (Chrome required), then run `node scripts/check-finance-receipts.cjs`. `RECEIPT_TEST_URL` can override the URL.

## Limitations and future scope

English printed receipts only initially; no PDF/HEIC support. Camera availability varies by browser/device. OCR can use noticeable CPU during scanning, and first use needs an asset download. Blurry, faded, skewed, multi-column or unfamiliar receipt layouts may need substantial correction. Merchant recognition and item extraction are heuristics, not retailer-certified parsers. Tested with a synthetic image, not a corpus of real shop receipts or physical mobile cameras. Saving still requires the app's existing online Finance connection.

Grocery matching, inventory changes, bank syncing and permanent receipt-image storage are intentionally not implemented. Stable item records and normalized names are available for later Grocery integration.
