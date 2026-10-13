# Third-party parts

| Part | Where | Licence | Notes |
|---|---|---|---|
| pdf.js (Mozilla) | `extension/pdf/vendor/pdf.mjs`, `pdf.worker.mjs`, `cmaps/`, `standard_fonts/` | Apache-2.0 | Licence text in the file headers. Copied from `~/paper-reader/vendor`. |
| english-words (dwyl) | `extension/pdf/vendor/lexicon.txt` | Unlicense (public domain) | Word list for ligature repair. |
| Paper Reader | `extension/pdf/` | Dr Semion Roitman's own project (`~/paper-reader`, commit 8ee8a1e) | Changes marked "Read Aloud 2". |
| Kokoro-82M | not included; used by `voice-server.py` from the Mac's mlx-audio install | Apache-2.0 | The natural voices. |
| mlx-audio | not included | MIT | Runs Kokoro on the Mac's GPU. |
| Apple Vision | macOS system framework | Apple | Text in pictures (`ocr/ocr.swift`). |
