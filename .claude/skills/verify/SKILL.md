---
name: verify
description: Drive the CDASS Enroll app in a real browser and read the generated PDFs back, to confirm a change works end to end.
---

# Verifying CDASS Enroll

The surface is a browser page that downloads PDFs. A change is verified when
you have driven the page and inspected the PDF that came out of it, not when
`node tests/smoke.mjs` passes (that is CI, and it never renders the UI).

## Launch

```bash
npx vite --port 5180 --host 127.0.0.1   # run in background; 5180 is pinned, never 5173
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5180/   # expect 200
```

`python run.py` also works but opens a real browser window and blocks.

## Drive

No browser automation is vendored. Playwright is not a dependency; use it from
a scratch dir against the system Chrome, which avoids downloading a browser:

```bash
cd <scratchpad> && npm i playwright && node drive.mjs
```

```js
const browser = await chromium.launch({ channel: "chrome" }); // system Chrome
```

Notes that cost time to rediscover:

- Fields render from `src/schema.js`, so locate by label text:
  `page.locator("label.field", { hasText: "Standard rate" }).locator("input")`.
  Checkboxes are `label.check`.
- "Your details" (Member + employer) is behind the `⚙ Your details` header
  button; the same button reads `← Back to enrollment` once open.
- Generate emits a real download: `page.waitForEvent("download")` then
  `saveAs()`. Uncheck the W-4 box to get the packet alone and keep it quick.
- Everything persists to localStorage on change, so `page.evaluate()` to seed
  or clear it, and reload to test the upgrade path from an older payload.
- A 404 for `seed.local.json` on every load is expected and benign: the file is
  gitignored and `applySeedIfEmpty` swallows the miss.

## Check the output

Read values back out of the downloaded PDF rather than trusting the status line:

```python
from pypdf import PdfReader
f = PdfReader("out.pdf").get_fields()
print(f["CFC CDASS Standard Rate"].get("/V"))
```

pypdf splits field names on `.`, so a name containing a period (for example
`Address 2 (Apt., Ste., or other)`) shows up truncated; the mappings pass the
full pdf-lib name. To see a page as a human will:

```python
import fitz  # pip install pymupdf
fitz.open("out.pdf")[9].get_pixmap(dpi=120, clip=fitz.Rect(30, 400, 595, 630)).save("p10.png")
```

Page 10 (index 9) holds the three rate tables; the rate must appear in exactly
one of them, chosen by the Member's program.

## Worth driving for most changes

- Generate a packet and confirm the values land on the right page.
- Reload with a pre-change localStorage payload (old keys present, new keys
  absent) and confirm it still renders and defaults sensibly.
- Watch for off-origin requests. The privacy claim is the product:
  `page.on("request")` and assert every URL is `127.0.0.1:5180`, `blob:`, or
  `data:`.
