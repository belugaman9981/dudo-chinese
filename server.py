"""
新华字典 Photo Pinyin Server
============================
FastAPI backend that:
  1. Receives a photo of a page with Chinese characters
  2. Runs OCR to extract characters with bounding boxes
  3. Adds pinyin annotations
  4. Provides word definitions in multiple languages
  5. Computes contrast colors for the pinyin overlay
 
Run with:
    python server.py
Then open http://localhost:8000 (or http://<your-ip>:8000 on your iPad).
"""

import io
import os
import re
import json
import bisect
import logging
import threading
from pathlib import Path

import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pypinyin import pinyin, Style

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("pinyin-server")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DICT_FILE = BASE_DIR / "cedict_ts.u8"

# ---------------------------------------------------------------------------
# OCR engine (lazy-loaded in a background thread so the server starts fast)
# ---------------------------------------------------------------------------
_ocr = None
_ocr_lock = threading.Lock()


def get_ocr():
    """Lazily initialise the RapidOCR engine (thread-safe)."""
    global _ocr
    if _ocr is None:
        with _ocr_lock:
            if _ocr is None:
                log.info("Initialising RapidOCR engine...")
                from rapidocr_onnxruntime import RapidOCR
                _ocr = RapidOCR()
                log.info("RapidOCR ready.")
    return _ocr


# ---------------------------------------------------------------------------
# Dictionary (CC-CEDICT)
# ---------------------------------------------------------------------------
class Cedict:
    """Loads CC-CEDICT and provides lookups by simplified/traditional char."""

    def __init__(self, path: Path):
        self.path = path
        self._entries = []          # list of dicts
        self._by_simplified = {}    # simplified -> list of entries
        self._by_traditional = {}
        self._by_char = {}          # single char -> list of entries
        self._pinyin_sorted = []    # sorted list of (normalized_pinyin, entry) for prefix search
        self._load()

    def _load(self):
        if not self.path.exists():
            log.warning("Dictionary file %s not found; definitions disabled.", self.path)
            return
        log.info("Loading dictionary %s ...", self.path.name)
        count = 0
        with open(self.path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line or line.startswith("#"):
                    continue
                entry = self._parse_line(line)
                if entry is None:
                    continue
                self._entries.append(entry)
                simp = entry["simplified"]
                trad = entry["traditional"]
                self._by_simplified.setdefault(simp, []).append(entry)
                self._by_traditional.setdefault(trad, []).append(entry)
                # index single characters
                for ch in simp:
                    self._by_char.setdefault(ch, []).append(entry)
                count += 1
        log.info("Loaded %d dictionary entries.", count)
        self._build_pinyin_index()

    def _build_pinyin_index(self):
        """Build a sorted index of normalized (tone-less, no-space) pinyin
        so users can search by typing pinyin without knowing the character,
        similar to Pleco's pinyin lookup.
        """
        pairs = []
        for entry in self._entries:
            norm = normalize_pinyin_query(entry["pinyin"])
            if norm:
                pairs.append((norm, entry))
        pairs.sort(key=lambda p: p[0])
        self._pinyin_sorted = pairs
        log.info("Built pinyin search index with %d entries.", len(pairs))

    def search_by_pinyin(self, query: str, max_results: int = 30):
        """Find dictionary entries whose pinyin starts with `query`
        (normalized: lowercase, no tone numbers/marks, no spaces).

        Results are ranked with a "most common first" heuristic: shorter
        words (fewer characters) and shorter pinyin (fewer syllables) rank
        higher, since single/double-character common words are looked up
        far more often than obscure multi-character terms.
        """
        norm_query = normalize_pinyin_query(query)
        if not norm_query or not self._pinyin_sorted:
            return []
        keys = [p[0] for p in self._pinyin_sorted]
        lo = bisect.bisect_left(keys, norm_query)
        hi = bisect.bisect_left(keys, norm_query[:-1] + chr(ord(norm_query[-1]) + 1))
        candidates = [self._pinyin_sorted[i][1] for i in range(lo, hi)]

        # De-duplicate by (simplified, pinyin) signature.
        seen = set()
        unique = []
        for e in candidates:
            sig = (e["simplified"], e["pinyin"])
            if sig not in seen:
                seen.add(sig)
                unique.append(e)

        def rank_key(e):
            syllable_count = len(e["pinyin"].split())
            word_len = len(e["simplified"])
            exact = 0 if normalize_pinyin_query(e["pinyin"]) == norm_query else 1
            return (exact, word_len, syllable_count, e["simplified"])

        unique.sort(key=rank_key)
        return unique[:max_results]

    @staticmethod
    def _parse_line(line: str):
        # Format:  traditional simplified [pin1 yin1] /def1/def2/
        m = re.match(r"^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+/(.*)/$", line)
        if not m:
            return None
        traditional, simplified, pinyin_str, defs = m.groups()
        definitions = [d for d in defs.split("/") if d]
        return {
            "traditional": traditional,
            "simplified": simplified,
            "pinyin": pinyin_str,
            "definitions": definitions,
        }

    def lookup(self, text: str, max_results: int = 5):
        """Look up a word (exact match on simplified or traditional)."""
        results = []
        for key in (text,):
            for table in (self._by_simplified, self._by_traditional):
                for entry in table.get(key, []):
                    results.append(entry)
        # de-duplicate by (simplified, pinyin)
        seen = set()
        unique = []
        for e in results:
            sig = (e["simplified"], e["pinyin"])
            if sig not in seen:
                seen.add(sig)
                unique.append(e)
        return unique[:max_results]

    def lookup_char(self, ch: str, max_results: int = 3):
        """Look up a single character."""
        return self._by_char.get(ch, [])[:max_results]


# ---------------------------------------------------------------------------
# Language / translation support
# ---------------------------------------------------------------------------
# Built-in translations of common dictionary glosses. For languages not in
# this table we fall back to English (or a lightweight online translation).
LANG_NAMES = {
    "en": "English",
    "zh": "中文",
    "es": "Español",
    "fr": "Français",
    "de": "Deutsch",
    "ja": "日本語",
    "ko": "한국어",
    "ru": "Русский",
    "pt": "Português",
    "it": "Italiano",
}

# A tiny glossary used to translate the most common definition words so the
# app feels localised even offline. This is intentionally small; full
# translation is handled by the optional online translator.
_GLOSS = {
    "en": {
        "to": "to", "a": "a", "the": "the", "and": "and", "of": "of",
        "be": "be", "is": "is", "are": "are", "in": "in", "on": "on",
        "person": "person", "thing": "thing", "place": "place",
    },
    "zh": {
        "to": "去", "a": "一个", "the": "这个", "and": "和", "of": "的",
        "be": "是", "is": "是", "are": "是", "in": "在", "on": "在",
        "person": "人", "thing": "事物", "place": "地方",
    },
    "es": {
        "to": "a", "a": "un", "the": "el", "and": "y", "of": "de",
        "be": "ser", "is": "es", "are": "son", "in": "en", "on": "en",
        "person": "persona", "thing": "cosa", "place": "lugar",
    },
    "fr": {
        "to": "à", "a": "un", "the": "le", "and": "et", "of": "de",
        "be": "être", "is": "est", "are": "sont", "in": "dans", "on": "sur",
        "person": "personne", "thing": "chose", "place": "lieu",
    },
    "de": {
        "to": "zu", "a": "ein", "the": "der", "and": "und", "of": "von",
        "be": "sein", "is": "ist", "are": "sind", "in": "in", "on": "auf",
        "person": "Person", "thing": "Ding", "place": "Ort",
    },
    "ja": {
        "to": "へ", "a": "一つの", "the": "その", "and": "と", "of": "の",
        "be": "である", "is": "です", "are": "です", "in": "に", "on": "に",
        "person": "人", "thing": "物", "place": "場所",
    },
    "ko": {
        "to": "로", "a": "하나의", "the": "그", "and": "그리고", "of": "의",
        "be": "이다", "is": "이다", "are": "이다", "in": "에", "on": "에",
        "person": "사람", "thing": "것", "place": "장소",
    },
    "ru": {
        "to": "к", "a": "один", "the": "этот", "and": "и", "of": "из",
        "be": "быть", "is": "есть", "are": "есть", "in": "в", "on": "на",
        "person": "человек", "thing": "вещь", "place": "место",
    },
    "pt": {
        "to": "para", "a": "um", "the": "o", "and": "e", "of": "de",
        "be": "ser", "is": "é", "are": "são", "in": "em", "on": "em",
        "person": "pessoa", "thing": "coisa", "place": "lugar",
    },
    "it": {
        "to": "a", "a": "un", "the": "il", "and": "e", "of": "di",
        "be": "essere", "is": "è", "are": "sono", "in": "in", "on": "su",
        "person": "persona", "thing": "cosa", "place": "luogo",
    },
}


def translate_definition(def_text: str, lang: str) -> str:
    """Best-effort translation of an English definition to `lang`.

    Uses the built-in glossary when every word in the definition is
    covered (fast, works offline). If any word is missing from the
    glossary, a partial substitution would produce a mixed-language mess,
    so instead we try the online translator (MyMemory, free, no key) for a
    coherent full-sentence result, falling back to plain English if that
    also fails (e.g. offline).
    """
    if lang == "en" or lang not in _GLOSS:
        return def_text

    gloss = _GLOSS[lang]
    words = def_text.split()
    translated = []
    fully_covered = True
    for w in words:
        key = w.strip(".,;:()!?").lower()
        if key in gloss:
            translated.append(gloss[key])
        else:
            translated.append(w)
            fully_covered = False

    if fully_covered:
        return " ".join(translated)

    online = _online_translate(def_text, lang)
    return online if online else def_text


def _online_translate(text: str, lang: str) -> str:
    """Translate `text` to `lang` using the free MyMemory API.

    Returns the translated string, or "" if the request fails / is offline.
    """
    import urllib.parse
    import urllib.request
    try:
        url = (
            "https://api.mymemory.translated.net/get"
            "?q=" + urllib.parse.quote(text) +
            "&langpair=en|" + urllib.parse.quote(lang)
        )
        with urllib.request.urlopen(url, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        translated = data.get("responseData", {}).get("translatedText", "")
        if translated and translated.lower() != text.lower():
            return translated
    except Exception:
        pass
    return ""


# ---------------------------------------------------------------------------
# Contrast color calculation
# ---------------------------------------------------------------------------
def relative_luminance(rgb):
    """Compute WCAG relative luminance for an (r,g,b) tuple (0-255)."""
    def channel(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast_ratio(c1, c2):
    """WCAG contrast ratio between two RGB tuples."""
    l1, l2 = relative_luminance(c1), relative_luminance(c2)
    if l1 < l2:
        l1, l2 = l2, l1
    return (l1 + 0.05) / (l2 + 0.05)


def best_contrast_color(bg_rgb, candidates=None):
    """Pick the candidate colour with the highest contrast against bg_rgb.

    Defaults to black and white, choosing whichever contrasts more.
    """
    if candidates is None:
        candidates = [(0, 0, 0), (255, 255, 255)]
    best = None
    best_ratio = -1
    for cand in candidates:
        ratio = contrast_ratio(bg_rgb, cand)
        if ratio > best_ratio:
            best_ratio = ratio
            best = cand
    return best, best_ratio


def hex_to_rgb(hex_str):
    """Convert '#rrggbb' or 'rrggbb' to an (r,g,b) tuple."""
    h = hex_str.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def average_color_in_region(img: Image.Image, box) -> tuple:
    """Compute the average *background* RGB colour inside an OCR bounding box.

    `box` is a list of 4 [x, y] corner points (top-left, top-right,
    bottom-right, bottom-left).

    The box tightly wraps the printed glyphs, so a naive average mixes ink
    color into the "background" estimate. Since ink is usually much darker
    or much lighter than the page itself, pixels near the extremes of the
    region's own luminance range are dropped before averaging, leaving a
    more representative background colour for the contrast calculation.
    """
    xs = [int(p[0]) for p in box]
    ys = [int(p[1]) for p in box]
    x0, x1 = max(0, min(xs)), min(img.width, max(xs))
    y0, y1 = max(0, min(ys)), min(img.height, max(ys))
    if x1 <= x0 or y1 <= y0:
        return (255, 255, 255)
    region = img.crop((x0, y0, x1, y1)).convert("RGB")
    arr = np.asarray(region, dtype=np.float64).reshape(-1, 3)
    if arr.shape[0] >= 8:
        luminance = arr.mean(axis=1)
        lo, hi = np.percentile(luminance, [15, 85])
        mask = (luminance >= lo) & (luminance <= hi)
        if mask.any():
            arr = arr[mask]
    mean = arr.mean(axis=0)
    return tuple(int(mean[i]) for i in range(3))


# ---------------------------------------------------------------------------
# Pinyin helpers
# ---------------------------------------------------------------------------
# Map of (vowel, tone) -> accented vowel for tone-marked pinyin.
_TONE_MARKS = {
    ("a", 1): "ā", ("a", 2): "á", ("a", 3): "ǎ", ("a", 4): "à",
    ("e", 1): "ē", ("e", 2): "é", ("e", 3): "ě", ("e", 4): "è",
    ("i", 1): "ī", ("i", 2): "í", ("i", 3): "ǐ", ("i", 4): "ì",
    ("o", 1): "ō", ("o", 2): "ó", ("o", 3): "ǒ", ("o", 4): "ò",
    ("u", 1): "ū", ("u", 2): "ú", ("u", 3): "ǔ", ("u", 4): "ù",
    ("ü", 1): "ǖ", ("ü", 2): "ǘ", ("ü", 3): "ǚ", ("ü", 4): "ǜ",
    ("v", 1): "ǖ", ("v", 2): "ǘ", ("v", 3): "ǚ", ("v", 4): "ǜ",
}

# Vowel priority for placing the tone mark (a > e > o > i/u > ü).
_VOWEL_ORDER = ["a", "e", "o", "i", "u", "ü", "v"]


def numbered_to_tone(py: str) -> str:
    """Convert 'ni3 hao3' to 'nǐ hǎo' (numbered pinyin to tone marks)."""
    syllables = py.split()
    out = []
    for syl in syllables:
        # Find the trailing tone number (1-5; 5 = neutral).
        tone = 0
        body = syl
        if syl and syl[-1].isdigit():
            tone = int(syl[-1])
            body = syl[:-1]
        if tone == 5 or tone == 0:
            out.append(body)
            continue
        # Find the vowel to accent.
        # 'iu'/'ui' special case: accent on the second vowel.
        lower = body.lower()
        if "iu" in lower or "ui" in lower:
            # accent on the last vowel
            idx = len(body) - 1
        else:
            idx = -1
            for v in _VOWEL_ORDER:
                pos = lower.find(v)
                if pos != -1:
                    idx = pos
                    break
        if idx == -1:
            out.append(body)
            continue
        ch = body[idx]
        accented = _TONE_MARKS.get((ch.lower(), tone))
        if accented is None:
            out.append(body)
            continue
        # Preserve original case of the accented char.
        if ch.isupper():
            accented = accented.upper()
        out.append(body[:idx] + accented + body[idx + 1:])
    return " ".join(out)


def get_pinyin_for_text(text: str):
    """Return a list of pinyin syllables (with tone marks) for `text`."""
    return [syl[0] for syl in pinyin(text, style=Style.TONE, errors="ignore")]


# Strip tone numbers (CC-CEDICT format e.g. "ni3 hao3") for pinyin search.
_TONE_NUM_RE = re.compile(r"[1-5]")


def normalize_pinyin_query(text: str) -> str:
    """Normalize a pinyin string for prefix search: lowercase, strip tone
    numbers/marks, remove spaces/punctuation. 'Ni3 Hao3' / 'nǐ hǎo' / 'ni
    hao' / 'nihao' all normalize to 'nihao'.
    """
    if not text:
        return ""
    text = text.lower()
    # Remove tone-mark accents by decomposing and stripping combining marks.
    import unicodedata
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("ü", "v").replace("u:", "v")
    text = _TONE_NUM_RE.sub("", text)
    text = re.sub(r"[^a-z]", "", text)
    return text


# jieba does frequency-aware segmentation, which handles ambiguous strings
# (e.g. distinguishing "有意见" as 有/意见 rather than 有意/见) much better
# than naive greedy longest-dictionary-match. It's an optional dependency:
# if it isn't installed, we fall back to the greedy matcher below.
try:
    import jieba
    jieba.setLogLevel(logging.WARNING)
    _HAS_JIEBA = True
except ImportError:
    _HAS_JIEBA = False
    log.warning("jieba not installed; falling back to greedy dictionary "
                "matching for word segmentation (pip install jieba for "
                "better results).")


def _pinyin_for_word(word: str) -> str:
    """Best pinyin available for `word`: dictionary entry if present,
    otherwise per-character pinyin from pypinyin."""
    entries = _dict.lookup(word) if _dict else []
    if entries:
        return numbered_to_tone(entries[0]["pinyin"])
    syls = get_pinyin_for_text(word)
    return " ".join(syls) if syls else ""


def _greedy_split_into_words(text: str):
    """Fallback segmentation: longest dictionary match, greedily, falling
    back to single characters. Returns a list of (word, pinyin) tuples."""
    words = []
    i = 0
    n = len(text)
    while i < n:
        matched = False
        # Try longest match up to 6 characters
        for length in range(min(6, n - i), 0, -1):
            candidate = text[i:i + length]
            entries = _dict.lookup(candidate) if _dict else []
            if entries:
                words.append((candidate, numbered_to_tone(entries[0]["pinyin"])))
                i += length
                matched = True
                break
        if not matched:
            ch = text[i]
            words.append((ch, _pinyin_for_word(ch)))
            i += 1
    return words


def split_into_words(text: str):
    """Split OCR text into words, with pinyin for each.

    Uses jieba for frequency-aware segmentation when available, otherwise
    falls back to greedy longest-dictionary-match.

    Returns a list of (word, pinyin) tuples.
    """
    if not text:
        return []
    if not _HAS_JIEBA:
        return _greedy_split_into_words(text)
    return [(w, _pinyin_for_word(w)) for w in jieba.cut(text) if w.strip()]


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="新华字典 Photo Pinyin", version="1.0.0")

# Load dictionary at startup (fast, ~1s)
_dict = Cedict(DICT_FILE)


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/languages")
def languages():
    return {"languages": LANG_NAMES}


@app.get("/api/pinyin_search")
def pinyin_search(q: str = "", lang: str = "en", limit: int = 30):
    """Search the dictionary by pinyin (with or without tones), e.g. typing
    'shouji' or 'shou3ji1' finds 手机, 手迹, 手记, etc. Results are ordered
    with common short words first, similar to Pleco's pinyin lookup.
    """
    if not q or not _dict:
        return {"results": []}
    entries = _dict.search_by_pinyin(q, max_results=limit)
    results = []
    for e in entries:
        defs = [translate_definition(d, lang) for d in e["definitions"][:4]]
        results.append({
            "simplified": e["simplified"],
            "traditional": e["traditional"],
            "pinyin": numbered_to_tone(e["pinyin"]),
            "definitions": defs,
        })
    return {"results": results}


@app.get("/api/dict_lookup")
def dict_lookup(q: str = "", lang: str = "en", limit: int = 30):
    """Look up a Chinese character or word directly in the dictionary.

    - A single character returns entries that contain that character
      (via the character index), so typing 手 shows 手, 手机, 手表, etc.
    - A multi-character word returns exact matches first, then entries
      that start with the query, then entries containing it.
    """
    if not q or not _dict:
        return {"results": []}
    q = q.strip()
    if not q:
        return {"results": []}

    results = []
    seen = set()

    def add(entries):
        for e in entries:
            sig = (e["simplified"], e["pinyin"])
            if sig not in seen:
                seen.add(sig)
                results.append(e)

    if len(q) == 1:
        add(_dict.lookup_char(q, max_results=limit))
    else:
        # Exact match first
        add(_dict.lookup(q, max_results=limit))
        # Then prefix matches
        for e in _dict._entries:
            if e["simplified"].startswith(q) or e["traditional"].startswith(q):
                add([e])
            if len(results) >= limit:
                break
        # Then substring matches
        if len(results) < limit:
            for e in _dict._entries:
                if q in e["simplified"] or q in e["traditional"]:
                    add([e])
                if len(results) >= limit:
                    break

    out = []
    for e in results[:limit]:
        defs = [translate_definition(d, lang) for d in e["definitions"][:4]]
        out.append({
            "simplified": e["simplified"],
            "traditional": e["traditional"],
            "pinyin": numbered_to_tone(e["pinyin"]),
            "definitions": defs,
        })
    return {"results": out}


@app.post("/api/ocr")
async def ocr_endpoint(
    file: UploadFile = File(...),
    lang: str = Form("en"),
):
    """Process an uploaded photo: OCR -> pinyin -> definitions -> contrast colors."""
    data = await file.read()
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": f"Invalid image: {exc}"})

    # Run OCR
    ocr = get_ocr()
    try:
        result, _ = ocr(np.asarray(img))
    except Exception as exc:
        log.exception("OCR failed")
        return JSONResponse(status_code=500, content={"error": f"OCR failed: {exc}"})

    if not result:
        return {"items": [], "message": "No Chinese characters detected."}

    items = []
    for box, text, conf in result:
        # Average background colour in the box for contrast
        bg = average_color_in_region(img, box)
        fg, ratio = best_contrast_color(bg)

        # Split into words and get pinyin
        words = split_into_words(text)

        # Build per-word data with definitions
        word_data = []
        for word, py in words:
            entries = _dict.lookup(word) if _dict else []
            defs = []
            for e in entries:
                for d in e["definitions"]:
                    defs.append(translate_definition(d, lang))
            word_data.append({
                "word": word,
                "pinyin": py,
                "definitions": defs[:4],
            })

        items.append({
            "box": box,
            "text": text,
            "confidence": round(float(conf), 3),
            "background_color": rgb_to_hex(bg),
            "text_color": rgb_to_hex(fg),
            "contrast_ratio": round(ratio, 2),
            "words": word_data,
        })

    return {"items": items}


# Serve static files (JS/CSS)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    import sys
    import uvicorn
    # Bind to 0.0.0.0 so the iPad on the same network can reach the server.
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    use_https = "--https" in sys.argv
    if use_https:
        cert = os.environ.get("CERT", "cert.pem")
        key = os.environ.get("KEY", "key.pem")
        if not (os.path.exists(cert) and os.path.exists(key)):
            log.error("HTTPS requested but %s / %s not found. "
                      "Generate them with openssl first (see README).", cert, key)
            sys.exit(1)
        scheme = "https"
        ssl_kwargs = {"ssl_certfile": cert, "ssl_keyfile": key}
    else:
        scheme = "http"
        ssl_kwargs = {}
    log.info("Starting server on %s://%s:%d  (open this on your iPad)", scheme, host, port)
    uvicorn.run(app, host=host, port=port, **ssl_kwargs)


if __name__ == "__main__":
    main()
