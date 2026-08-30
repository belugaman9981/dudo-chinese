/* ============================================================
   新华字典 Photo Pinyin — frontend logic
   Pleco-inspired UI: camera capture, OCR, annotated page,
   tone-colored pinyin, dictionary-style word list.
   ============================================================ */

(function () {
  "use strict";

  // ---------- DOM references ----------
  const $ = (id) => document.getElementById(id);

  const captureScreen = $("capture-screen");
  const processingScreen = $("processing-screen");
  const resultScreen = $("result-screen");
  const searchScreen = $("search-screen");

  const video = $("camera");
  const cameraCanvas = $("camera-canvas");
  const captureBtn = $("capture-btn");
  const fileInput = $("file-input");
  const cameraStatus = $("camera-status");

  const langSelect = $("lang-select");
  const processingStatus = $("processing-status");

  const resultContainer = $("result-container");
  const wordList = $("word-list");
  const wordsCount = $("words-count");
  const backBtn = $("back-btn");
  const togglePinyinBtn = $("toggle-pinyin-btn");
  const toggleDefsBtn = $("toggle-defs-btn");

  // Segmented control
  const tabPageBtn = $("tab-page-btn");
  const tabWordsBtn = $("tab-words-btn");
  const pageView = $("page-view");
  const wordsView = $("words-view");

  // Bottom tab bar
  const tabButtons = document.querySelectorAll(".tab-btn");
  const resultsTabBtn = $("results-tab-btn");
  const searchTabBtn = $("search-tab-btn");

  // Pinyin search
  const pinyinSearchInput = $("pinyin-search-input");
  const searchResults = $("search-results");
  const searchHint = $("search-hint");

  // ---------- State ----------
  let stream = null;
  let currentImage = null;
  let currentImageDataUrl = null;
  let currentItems = [];
  let showPinyin = true;
  let showDefs = false;
  let annotationCanvas = null;
  let selectedItem = null;
  let uiLang = "en";

  // ---------- UI translations ----------
  // Full interface strings (buttons, labels, hints, messages) for each
  // supported language. Falls back to English for missing keys/languages.
  const I18N = {
    en: {
      appTitle: "Xinhua Dictionary", langLabel: "Language",
      overlayHint: "Align text within the frame",
      captureBtn: "Capture", uploadBtn: "Upload Photo",
      processingTitle: "Recognizing…", processingStatus: "Reading text",
      searchPlaceholder: "Type pinyin, e.g. nihao or ni3hao3",
      searchHint: "Don't know how to write it? Type the pinyin (tones optional), e.g. \"shouji\" to find 手机, 手迹, 手记…",
      segPage: "Page", segWords: "Words",
      backBtn: "← New Photo", hidePinyinBtn: "Hide Pinyin", showPinyinBtn: "Show Pinyin",
      showDefsBtn: "Show Definitions", hideDefsBtn: "Hide Definitions",
      tabCamera: "Camera", tabSearch: "Pinyin Search", tabResults: "Results", tabSettings: "Settings",
      cameraNotSupported: "This browser doesn't support the camera. Please use the upload button instead.",
      cameraReady: "Camera ready — tap capture to scan.",
      cameraError: "Couldn't access the camera: {msg}. You can still upload a photo.",
      noCameraFrame: "No camera frame available.",
      uploadingImage: "Uploading photo…",
      recognizingText: "Recognizing text (OCR)…",
      serverError: "Server error",
      noCharsDetected: "No Chinese characters detected.",
      processingFailed: "Processing failed: {msg}",
      noTextHere: "No text there — tap a highlighted text block.",
      noWordsDetected: "No words detected.",
      wordsCount: "{n} words",
      noDefFound: "No definition found.",
      noSearchMatch: "No matching words — try without tones, e.g. \"shouji\".",
      noResultsYet: "No results yet — take a photo or upload one first.",
      settingsSoon: "Settings coming soon.",
    },
    zh: {
      appTitle: "新华字典", langLabel: "语言",
      overlayHint: "将文字对准取景框",
      captureBtn: "拍照", uploadBtn: "上传图片",
      processingTitle: "识别中…", processingStatus: "正在读取文字",
      searchPlaceholder: "输入拼音，如 nihao 或 ni3hao3",
      searchHint: "不知道怎么写？输入拼音（可以不带声调），例如输入 \"shouji\" 查找 手机、手迹、手记…",
      segPage: "页面", segWords: "词汇",
      backBtn: "← 新照片", hidePinyinBtn: "隐藏拼音", showPinyinBtn: "显示拼音",
      showDefsBtn: "显示释义", hideDefsBtn: "隐藏释义",
      tabCamera: "相机", tabSearch: "拼音查找", tabResults: "结果", tabSettings: "设置",
      cameraNotSupported: "此浏览器不支持相机。请使用上传图片功能。",
      cameraReady: "相机已就绪 — 拍照识别。",
      cameraError: "无法访问相机：{msg}。您仍然可以上传图片。",
      noCameraFrame: "没有可用的相机画面。",
      uploadingImage: "正在上传图片…",
      recognizingText: "正在识别文字 (OCR)…",
      serverError: "服务器错误",
      noCharsDetected: "未检测到中文字符。",
      processingFailed: "处理失败：{msg}",
      noTextHere: "此处没有文字 — 请点击高亮的文字区域。",
      noWordsDetected: "未检测到词汇。",
      wordsCount: "{n} 个词",
      noDefFound: "未找到释义。",
      noSearchMatch: "没有找到匹配的词 — 试试不带声调，如 \"shouji\"。",
      noResultsYet: "还没有结果 — 请先拍照或上传图片。",
      settingsSoon: "设置功能即将推出。",
    },
    es: {
      appTitle: "Diccionario Xinhua", langLabel: "Idioma",
      overlayHint: "Alinea el texto dentro del marco",
      captureBtn: "Capturar", uploadBtn: "Subir foto",
      processingTitle: "Reconociendo…", processingStatus: "Leyendo texto",
      searchPlaceholder: "Escribe el pinyin, p. ej. nihao o ni3hao3",
      searchHint: "¿No sabes escribirlo? Escribe el pinyin (tonos opcionales), p. ej. \"shouji\" para encontrar 手机, 手迹, 手记…",
      segPage: "Página", segWords: "Palabras",
      backBtn: "← Nueva foto", hidePinyinBtn: "Ocultar pinyin", showPinyinBtn: "Mostrar pinyin",
      showDefsBtn: "Mostrar definiciones", hideDefsBtn: "Ocultar definiciones",
      tabCamera: "Cámara", tabSearch: "Buscar pinyin", tabResults: "Resultados", tabSettings: "Ajustes",
      cameraNotSupported: "Este navegador no admite la cámara. Usa el botón de subir foto.",
      cameraReady: "Cámara lista — toca capturar para escanear.",
      cameraError: "No se pudo acceder a la cámara: {msg}. Aún puedes subir una foto.",
      noCameraFrame: "No hay imagen de cámara disponible.",
      uploadingImage: "Subiendo foto…",
      recognizingText: "Reconociendo texto (OCR)…",
      serverError: "Error del servidor",
      noCharsDetected: "No se detectaron caracteres chinos.",
      processingFailed: "Error al procesar: {msg}",
      noTextHere: "No hay texto aquí — toca un bloque resaltado.",
      noWordsDetected: "No se detectaron palabras.",
      wordsCount: "{n} palabras",
      noDefFound: "No se encontró definición.",
      noSearchMatch: "No se encontraron palabras — prueba sin tonos, p. ej. \"shouji\".",
      noResultsYet: "Aún no hay resultados — toma o sube una foto primero.",
      settingsSoon: "Los ajustes estarán disponibles pronto.",
    },
  };

  // Languages without a full UI translation fall back to English strings.
  function uiStrings(lang) {
    return I18N[lang] || I18N.en;
  }

  function t(key, vars) {
    let str = uiStrings(uiLang)[key] || I18N.en[key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(`{${k}}`, v);
      }
    }
    return str;
  }

  function applyTranslations() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
    });
    document.title = t("appTitle") + " · Photo Pinyin";
    // Re-apply dynamic toggle-button labels that depend on state.
    togglePinyinBtn.textContent = showPinyin ? t("hidePinyinBtn") : t("showPinyinBtn");
    toggleDefsBtn.textContent = showDefs ? t("hideDefsBtn") : t("showDefsBtn");
  }

  // ---------- Screen switching ----------
  function showScreen(screen) {
    [captureScreen, processingScreen, resultScreen, searchScreen].forEach((s) =>
      s.classList.remove("active")
    );
    screen.classList.add("active");

    // Update bottom tab bar
    if (screen === captureScreen) setActiveTab("camera");
    else if (screen === resultScreen) setActiveTab("results");
    else if (screen === searchScreen) setActiveTab("search");
  }

  function setActiveTab(tabName) {
    tabButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
  }

  // ---------- Segmented control ----------
  function showPageView() {
    pageView.classList.add("active");
    wordsView.classList.remove("active");
    tabPageBtn.classList.add("active");
    tabWordsBtn.classList.remove("active");
  }

  function showWordsView() {
    wordsView.classList.add("active");
    pageView.classList.remove("active");
    tabWordsBtn.classList.add("active");
    tabPageBtn.classList.remove("active");
  }

  // ---------- Toast ----------
  let toastEl = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  // ---------- Language loading ----------
  async function loadLanguages() {
    try {
      const res = await fetch("/api/languages");
      const data = await res.json();
      const langs = data.languages || {};
      langSelect.innerHTML = "";
      for (const [code, name] of Object.entries(langs)) {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = `${name} (${code})`;
        langSelect.appendChild(opt);
      }
      langSelect.value = "en";
    } catch (e) {
      console.error("Failed to load languages", e);
    }
  }

  // ---------- Camera ----------
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraStatus.textContent = t("cameraNotSupported");
      cameraStatus.classList.add("error");
      return;
    }
    try {
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      captureBtn.disabled = false;
      cameraStatus.textContent = t("cameraReady");
      cameraStatus.classList.remove("error");
    } catch (err) {
      console.error("Camera error:", err);
      cameraStatus.textContent = t("cameraError", { msg: err.message || err.name });
      cameraStatus.classList.add("error");
      captureBtn.disabled = true;
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.srcObject = null;
    captureBtn.disabled = true;
  }

  function captureFrame() {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      toast(t("noCameraFrame"));
      return null;
    }
    cameraCanvas.width = w;
    cameraCanvas.height = h;
    const ctx = cameraCanvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    return cameraCanvas.toDataURL("image/jpeg", 0.92);
  }

  // ---------- Processing ----------
  async function processImage(dataUrl) {
    showScreen(processingScreen);
    processingStatus.textContent = t("uploadingImage");

    const blob = dataUrlToBlob(dataUrl);
    const formData = new FormData();
    formData.append("file", blob, "photo.jpg");
    formData.append("lang", langSelect.value);

    try {
      processingStatus.textContent = t("recognizingText");
      const res = await fetch("/api/ocr", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t("serverError"));
      }
      if (!data.items || data.items.length === 0) {
        toast(data.message || t("noCharsDetected"));
        showScreen(captureScreen);
        return;
      }
      currentItems = data.items;
      renderResult(dataUrl);
    } catch (err) {
      console.error(err);
      toast(t("processingFailed", { msg: err.message }));
      showScreen(captureScreen);
    }
  }

  function dataUrlToBlob(dataUrl) {
    const [meta, b64] = dataUrl.split(",");
    const mime = meta.match(/data:(.*?);/)[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // ---------- Rendering the annotated page ----------
  function renderResult(dataUrl) {
    currentImageDataUrl = dataUrl;
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      showScreen(resultScreen);
      showPageView();
      drawAnnotation();
      buildWordList();
    };
    img.src = dataUrl;
  }

  function drawAnnotation() {
    if (!currentImage) return;

    if (annotationCanvas) annotationCanvas.remove();

    const canvas = document.createElement("canvas");
    canvas.id = "annotation-canvas";
    resultContainer.innerHTML = "";
    resultContainer.appendChild(canvas);
    annotationCanvas = canvas;

    const ctx = canvas.getContext("2d");
    canvas.width = currentImage.naturalWidth;
    canvas.height = currentImage.naturalHeight;
    ctx.drawImage(currentImage, 0, 0);

    if (showPinyin) {
      drawPinyinOverlays(ctx);
    }

    canvas.addEventListener("click", onCanvasClick);
    canvas.addEventListener("touchstart", onCanvasTouch, { passive: false });
  }

  function drawPinyinOverlays(ctx) {
    for (const item of currentItems) {
      const box = item.box;
      const xs = box.map((p) => p[0]);
      const ys = box.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const x1 = Math.max(...xs);
      const y1 = Math.max(...ys);
      const w = x1 - x0;
      const h = y1 - y0;

      const bg = item.background_color || "#ffffff";
      const fg = item.text_color || "#000000";

      // Subtle highlight behind the text block
      ctx.fillStyle = bg + "55";
      ctx.fillRect(x0, y0, w, h);

      // Draw pinyin above the text block
      const pinyinText = item.words.map((wd) => wd.pinyin).join(" ");
      if (pinyinText) {
        const fontSize = Math.max(12, Math.round(h * 0.45));
        ctx.font = `600 ${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = fg;
        ctx.lineWidth = Math.max(2, fontSize / 6);
        ctx.strokeStyle = bg;
        ctx.strokeText(pinyinText, x0 + w / 2, y0 - 4);
        ctx.fillText(pinyinText, x0 + w / 2, y0 - 4);
      }
    }
  }

  // ---------- Word selection ----------
  function onCanvasClick(e) {
    const rect = annotationCanvas.getBoundingClientRect();
    const scaleX = annotationCanvas.width / rect.width;
    const scaleY = annotationCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    selectWordAt(x, y);
  }

  function onCanvasTouch(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = annotationCanvas.getBoundingClientRect();
    const scaleX = annotationCanvas.width / rect.width;
    const scaleY = annotationCanvas.height / rect.height;
    const x = (touch.clientX - rect.left) * scaleX;
    const y = (touch.clientY - rect.top) * scaleY;
    selectWordAt(x, y);
  }

  function selectWordAt(x, y) {
    for (const item of currentItems) {
      const xs = item.box.map((p) => p[0]);
      const ys = item.box.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
        selectedItem = item;
        highlightItem(item);
        // Switch to words view to show the details
        showWordsView();
        buildWordList(item);
        return;
      }
    }
    toast(t("noTextHere"));
  }

  function highlightItem(item) {
    if (!annotationCanvas) return;
    const ctx = annotationCanvas.getContext("2d");
    ctx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
    ctx.drawImage(currentImage, 0, 0);
    if (showPinyin) drawPinyinOverlays(ctx);

    const xs = item.box.map((p) => p[0]);
    const ys = item.box.map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const x1 = Math.max(...xs), y1 = Math.max(...ys);
    ctx.strokeStyle = "#007aff";
    ctx.lineWidth = 4;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  // ---------- Tone-colored pinyin ----------
  // Parse a pinyin string like "nǐ hǎo" into syllables with tone classes.
  function parsePinyinSyllables(pinyinStr) {
    if (!pinyinStr) return [];
    return pinyinStr.split(/\s+/).filter(Boolean).map((syl) => {
      // Determine tone from the accented vowel.
      let tone = 5;
      if (/[āēīōūǖ]/.test(syl)) tone = 1;
      else if (/[áéíóúǘ]/.test(syl)) tone = 2;
      else if (/[ǎěǐǒǔǚ]/.test(syl)) tone = 3;
      else if (/[àèìòùǜ]/.test(syl)) tone = 4;
      return { text: syl, tone };
    });
  }

  // ---------- Word list rendering ----------
  function buildWordList(onlyItem) {
    // If onlyItem is given, show only that item's words; otherwise show all.
    const items = onlyItem ? [onlyItem] : currentItems;
    const seen = new Map();
    for (const item of items) {
      for (const wd of item.words || []) {
        if (!seen.has(wd.word)) seen.set(wd.word, wd);
      }
    }

    wordList.innerHTML = "";
    if (seen.size === 0) {
      wordList.innerHTML = `<p class="no-def">${t("noWordsDetected")}</p>`;
      wordsCount.textContent = "";
      return;
    }

      wordsCount.textContent = t("wordsCount", { n: seen.size });
    for (const wd of seen.values()) {
      wordList.appendChild(createWordCard(wd));
    }
  }

  function createWordCard(wd) {
    const div = document.createElement("div");
    div.className = "word-item";

    const head = document.createElement("div");
    head.className = "word-head";

    const char = document.createElement("span");
    char.className = "word-char";
    char.textContent = wd.word;

    const py = document.createElement("span");
    py.className = "word-pinyin";
    // Tone-colored syllables
    const syllables = parsePinyinSyllables(wd.pinyin);
    if (syllables.length) {
      syllables.forEach((s) => {
        const span = document.createElement("span");
        span.className = `py-syllable py-tone-${s.tone}`;
        span.textContent = s.text;
        py.appendChild(span);
      });
    } else {
      py.textContent = wd.pinyin || "";
    }

    head.appendChild(char);
    head.appendChild(py);
    div.appendChild(head);

    const defs = document.createElement("div");
    defs.className = "word-defs";
    if (showDefs && wd.definitions && wd.definitions.length) {
      const ul = document.createElement("ul");
      wd.definitions.forEach((d) => {
        const li = document.createElement("li");
        li.textContent = d;
        ul.appendChild(li);
      });
      defs.appendChild(ul);
    } else if (showDefs) {
      defs.innerHTML = `<span class="no-def">${t("noDefFound")}</span>`;
    }
    div.appendChild(defs);

    return div;
  }

  // ---------- Pinyin search (find a word when you don't know how to write it) ----------
  let searchDebounceTimer = null;
  let searchAbortController = null;

  function createSearchResultCard(entry) {
    const div = document.createElement("div");
    div.className = "word-item";

    const head = document.createElement("div");
    head.className = "word-head";

    const char = document.createElement("span");
    char.className = "word-char";
    char.textContent = entry.simplified;
    if (entry.traditional && entry.traditional !== entry.simplified) {
      char.textContent += ` (${entry.traditional})`;
    }

    const py = document.createElement("span");
    py.className = "word-pinyin";
    const syllables = parsePinyinSyllables(entry.pinyin);
    if (syllables.length) {
      syllables.forEach((s) => {
        const span = document.createElement("span");
        span.className = `py-syllable py-tone-${s.tone}`;
        span.textContent = s.text;
        py.appendChild(span);
      });
    } else {
      py.textContent = entry.pinyin || "";
    }

    head.appendChild(char);
    head.appendChild(py);
    div.appendChild(head);

    const defs = document.createElement("div");
    defs.className = "word-defs";
    if (entry.definitions && entry.definitions.length) {
      const ul = document.createElement("ul");
      entry.definitions.forEach((d) => {
        const li = document.createElement("li");
        li.textContent = d;
        ul.appendChild(li);
      });
      defs.appendChild(ul);
    } else {
      defs.innerHTML = `<span class="no-def">${t("noDefFound")}</span>`;
    }
    div.appendChild(defs);

    return div;
  }

  async function runPinyinSearch(query) {
    if (searchAbortController) searchAbortController.abort();
    if (!query.trim()) {
      searchResults.innerHTML = "";
      searchHint.style.display = "";
      return;
    }
    searchHint.style.display = "none";
    searchAbortController = new AbortController();
    try {
      const params = new URLSearchParams({
        q: query,
        lang: langSelect.value,
        limit: "30",
      });
      const res = await fetch(`/api/pinyin_search?${params.toString()}`, {
        signal: searchAbortController.signal,
      });
      const data = await res.json();
      renderSearchResults(data.results || []);
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Pinyin search failed", err);
      }
    }
  }

  function renderSearchResults(results) {
    searchResults.innerHTML = "";
    if (results.length === 0) {
      searchResults.innerHTML =
        `<p class="no-def">${t("noSearchMatch")}</p>`;
      return;
    }
    results.forEach((entry) => {
      searchResults.appendChild(createSearchResultCard(entry));
    });
  }

  pinyinSearchInput.addEventListener("input", () => {
    const query = pinyinSearchInput.value;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => runPinyinSearch(query), 200);
  });

  // ---------- Event wiring ----------
  captureBtn.addEventListener("click", () => {
    const dataUrl = captureFrame();
    if (dataUrl) processImage(dataUrl);
  });

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => processImage(reader.result);
    reader.readAsDataURL(file);
    fileInput.value = "";
  });

  backBtn.addEventListener("click", () => {
    showScreen(captureScreen);
    startCamera();
  });

  togglePinyinBtn.addEventListener("click", () => {
    showPinyin = !showPinyin;
    togglePinyinBtn.textContent = showPinyin ? t("hidePinyinBtn") : t("showPinyinBtn");
    if (currentImage) drawAnnotation();
  });

  toggleDefsBtn.addEventListener("click", () => {
    showDefs = !showDefs;
    toggleDefsBtn.textContent = showDefs ? t("hideDefsBtn") : t("showDefsBtn");
    buildWordList();
  });

  // Segmented control
  tabPageBtn.addEventListener("click", showPageView);
  tabWordsBtn.addEventListener("click", () => {
    buildWordList();
    showWordsView();
  });

  // Bottom tab bar
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab === "camera") {
        showScreen(captureScreen);
        startCamera();
      } else if (tab === "results") {
        if (currentImage) {
          showScreen(resultScreen);
          showPageView();
        } else {
          toast(t("noResultsYet"));
        }
      } else if (tab === "search") {
        showScreen(searchScreen);
        pinyinSearchInput.focus();
        if (pinyinSearchInput.value.trim()) {
          runPinyinSearch(pinyinSearchInput.value);
        }
      } else if (tab === "settings") {
        toast(t("settingsSoon"));
      }
    });
  });

  langSelect.addEventListener("change", () => {
    uiLang = langSelect.value;
    applyTranslations();
    if (currentImageDataUrl) {
      processImage(currentImageDataUrl);
    }
    if (pinyinSearchInput.value.trim() && searchScreen.classList.contains("active")) {
      runPinyinSearch(pinyinSearchInput.value);
    }
  });

  // ---------- Init ----------
  loadLanguages().then(() => {
    uiLang = langSelect.value;
    applyTranslations();
  });
  startCamera();

  window.addEventListener("beforeunload", stopCamera);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCamera();
  });
})();
