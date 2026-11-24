# GoldPath Slide Sendout

Phone web app (PWA) for logging glass slides sent out to pathologists and printing a
**Pathologist Sendout Log** sheet.

- Scan slide labels (DataMatrix/QR) with the phone camera or a Bluetooth barcode scanner
- Add controls, shipping details (sent by, method, tracking)
- Print / Save as PDF from Android's print dialog
- Export CSV, download/restore JSON backups

All send-out records are stored **only on the phone** (browser localStorage); nothing is
sent to a server. Each web address keeps its own records, so data entered on one copy of
the app does not appear on another.

Barcode decoding uses the browser's `BarcodeDetector` plus
[zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (vendored in `vendor/`).
