# 新华字典 Photo Pinyin

Take a photo of a page of Chinese characters with your camera (or upload a photo),
and the app will:

- **OCR** the characters (using RapidOCR / PaddleOCR models)
- Add **pinyin** annotations on top of the page, using a **contrast color** that
  is automatically chosen to be readable against the page background
- Show **definitions** for each word, in your chosen language
- Work in the **browser on an iPad** (and any phone/desktop)

## Live demo (GitHub Pages)

A **browser-only demo** is hosted on GitHub Pages:

👉 **https://belugaman9981.github.io/dudo-chinese/**

The demo lets you use the camera and upload photos, but **OCR, pinyin, and
definitions require the full Python server** (GitHub Pages can't run Python).
To use all features, run the server locally as described below.

## How it works

```
[iPad camera / photo upload]
        │  (JPEG)
        ▼
  FastAPI server  ──►  RapidOCR (detect + recognize Chinese)
        │                  │
        │                  ▼
        │            pypinyin (tone marks)
        │                  │
        │                  ▼
        │            CC-CEDICT dictionary (definitions)
        │                  │
        │                  ▼
        │            contrast-color calculation (WCAG)
        ▼
  Annotated page rendered in the browser
```

## Setup (one time)

Requires **Python 3.9+**.

```bash
# 1. Create a virtual environment (recommended)
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt
```

RapidOCR needs its OCR model files. Depending on the installed RapidOCR
version, required model resources may be downloaded or initialized on first use.
The first OCR request can therefore take longer than later requests.

## Run the server

```bash
python server.py
```

By default it listens on `0.0.0.0:8000`, so any device on your local network
can reach it.

- On the computer running the server: open **http://localhost:8000**
- On your iPad (same Wi-Fi network): open **http://<your-computer-ip>:8000**

> Find your computer's IP with `ipconfig` (Windows) or `ifconfig` (macOS/Linux).

## Using it on an iPad

1. Make sure the iPad and the computer are on the **same Wi-Fi network**.
2. Open Safari on the iPad and go to `http://<your-computer-ip>:8000`.
3. Tap **Take Photo** and allow camera access when Safari asks.
4. Point the camera at a page of Chinese characters and tap the shutter.
5. Tap any highlighted text block on the page to see its pinyin and definitions.

> **Note on camera access:** Browsers only allow camera access on secure
> (HTTPS) origins **or** on `localhost`. On an iPad you are connecting over
> plain HTTP to a LAN IP, so Safari may block the camera. Two easy fixes:
>
> - **Use the Upload button** instead of the live camera (always works).
> - Or run the server behind HTTPS (see below) so the camera is allowed.

### Optional: enable the camera over HTTPS on your iPad

The simplest way is to use a self-signed certificate and open the page with a
one-time trust prompt:

```bash
# Generate a self-signed cert (openssl must be installed)
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem \
  -days 365 -nodes -subj "/CN=<your-computer-ip>"

# Run with HTTPS
HOST=0.0.0.0 PORT=8443 python server.py --https
```

Then on the iPad open `https://<your-computer-ip>:8443`, tap through the
certificate warning once, and the camera will be allowed.

## Configuration

| Environment variable | Default | Purpose |
|----------------------|---------|---------|
| `HOST`               | `0.0.0.0` | Interface to bind |
| `PORT`               | `8000`   | Port to listen on |
| `MAX_UPLOAD_BYTES`   | `20971520` | Maximum uploaded image size (20 MB) |
| `MAX_IMAGE_PIXELS`   | `40000000` | Maximum decoded image area |
| `MAX_OCR_DIMENSION`  | `2600` | Longest side used for OCR; boxes are scaled back to the original photo |

## Languages

Definitions are provided in English by default (from CC-CEDICT). The app
includes a small built-in glossary for common definition words. When a complete
non-English definition cannot be produced from that offline glossary, the server
may send the English definition text to the public MyMemory translation service.
The app caches translation results in memory during the current server session to
reduce repeat network calls. OCR images themselves are not sent to MyMemory.

If the computer is offline or the translation request fails, the original English
definition is shown instead.

## Project layout

```
server.py          # FastAPI backend (OCR, pinyin, definitions, contrast color)
cedict_ts.u8       # CC-CEDICT dictionary data
static/
  index.html       # Single-page frontend
  style.css        # iPad-friendly styling
  app.js           # Camera, upload, annotation rendering
requirements.txt   # Python dependency ranges
```

## License

- App code: see [LICENSE](./LICENSE).
- Dictionary data (CC-CEDICT) is licensed under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

## Image safety and performance

The server rejects non-image uploads, empty uploads, files larger than the configured
limit, and images with excessive decoded dimensions. Large but valid photos are
downscaled before OCR for better speed and memory use; OCR bounding boxes are mapped
back to the original-resolution image so highlights remain aligned in the browser.
EXIF orientation is also applied automatically.

Dictionary pinyin and Hanzi-prefix searches use prebuilt sorted indexes. Online
translation results are cached in memory to avoid repeatedly translating identical
definitions during a session.
