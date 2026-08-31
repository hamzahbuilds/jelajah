# Jelajah v0.11 "Read Anything" — Spec (approved 31 Aug 2026)

Goal: handle documents no dedicated parser knows — other airlines' tickets,
arbitrary payment receipts, scanned PDFs and receipt photos from future
users — by extracting typed keywords from any text and, when there is no
embedded text, OCR-ing the document in the browser. Free tiers only, no keys.

## 1. Universal keyword extractor — `shared/keywords.ts` (pure, unit-tested)

`extractKeywords(text): KeywordSet` returns typed candidates, each with the
raw match and a short surrounding context snippet:

- **dates**: EN ("Dec 20, 2026", "20 December 2026", "20/12/2026"),
  BM month names (Jan..Dis), JP/CN (2026年12月20日), ISO — normalised to
  YYYY-MM-DD; labelled roles from context (check-in/check-out/due/payment/
  departure keywords in EN+BM+JP+CN). Two-column "Check-in Check-out / date
  date" voucher layouts handled (earlier date = check-in).
- **amounts**: currency symbol/code + value (RM, MYR, ¥, JPY, 円, USD, $, SGD,
  RMB, 元, EUR, THB, IDR, KRW…); scored by SAME-LINE context ("total", "grand
  total", "jumlah", "合計", "amount due") so the best guess is the top-scored
  amount, not the biggest number ("小計"/subtotal scores lower than "合計").
- **refs**: booking/confirmation numbers — labelled codes on ONE line (a bare
  word like "OFFICIAL RECEIPT" must not bridge lines and eat the real match),
  plus 6-char PNRs near booking words; Title-case dictionary words rejected.
- **flights**: flight numbers (60+ airline designators incl. AK/D7/XJ/OD/MH),
  route pairs (KUL→NRT with IATA stop-word filter).
- **names**: Title-Case lines and Malaysian ALL-CAPS BIN/BINTI/A/L patterns
  (inline, wrapping across lines/commas); company suffixes (SDN BHD, LTD…)
  filtered out; labelled "Guest name:/Passenger:/Nama:" captures.
- **vendor**: travel/payment brand list + sender email domains.
- **paymentMethod**: card networks/last-4, FPX, TnG, banks, CJK terms
  (クレジットカード, 信用卡 — no \b word boundaries around CJK).

## 2. Generic parser upgrade

`shared/parsers/generic.ts` uses the extractor: best guesses fill ParsedDoc
(category heuristics — flight numbers ⇒ flight, check-in-role dates ⇒
accommodation; total = top-scored amount; dates by role; booking no; people)
and the full `keywords` set rides along in parsed_json for the review UI.
Dedicated parsers still win when they match and are unchanged.

## 3. Browser OCR — Tesseract.js (`src/ocr.ts`)

- Documents dropzone accepts JPG/PNG; images stored in KV and previewed with
  <img> on review.
- A PDF whose embedded text is under ~40 chars/page is treated as scanned
  (`looksScanned`), rendered page-by-page to bitmaps via pdf.js, then OCR'd.
- OCR prompt modal: language chips — English + Malay preselected (packs SHIP
  IN THE APP under public/tess/lang, work with no CDN), Japanese and Chinese
  one tap (download once from jsDelivr tessdata_fast, browser-cached; choice
  remembered in localStorage). Progress bar; "Upload as-is" fallback.
- Worker (worker.min.js) + wasm core (tesseract-core-simd-lstm.wasm.js) are
  served by the app itself from public/tess/. `window.JELAJAH_TESS_LANGPATH`
  override exists for testing.
- OCR text goes through the same parser registry → review screen.

## 4. Review: "Detected keywords" panel

Shown whenever parsed.keywords exists: chips grouped 📅 dates · 💰 amounts ·
🔖 references · ✈️ flights · 👤 names · 🏪 vendor · 💳 payment. Tap to fill:
amount → amount+currency; date → the field on a small target switch (Date /
Check-out / Payment date / + Due date); ref → booking no; vendor → vendor;
flight → appended to description; name → toggles the matched participant
(via ExpenseForm's externalPatch mechanism). EN+BM copy.

## 5. Verification

- Unit: extractor vs real fixture texts + synthetic BM/JP/CN receipts +
  OCR-layout regression; generic-parser guesses.
- e2e: renders a fake receipt PNG in the browser, OCRs it hermetically with
  the LOCAL eng+msa packs, verifies chips and chip-fills, confirms to ledger.
- Sandbox caveat: jpn/chi_sim pack quality is confirmed on the live site.

## Out of scope
Per-vendor learning profiles; server-side OCR; handwriting.
