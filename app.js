// ===== StudyPack =====
const $ = (id) => document.getElementById(id);

// ---------- Online / offline pill ----------
const netStatus = $("netStatus");
function updateNetStatus() {
  const online = navigator.onLine;
  netStatus.textContent = online ? "Online" : "Offline";
  netStatus.classList.toggle("offline", !online);
}
window.addEventListener("online", updateNetStatus);
window.addEventListener("offline", updateNetStatus);
setInterval(updateNetStatus, 2000);
updateNetStatus();

// ---------- Service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.log("SW failed:", err));
  });
}

// ---------- Helpers ----------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function asText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function normalizeText(s) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// ---------- Views ----------
const VIEWS = ["homeView", "createView", "packView", "topicView", "aboutView"];
function showView(id) {
  VIEWS.forEach((v) => { $(v).hidden = v !== id; });
  window.scrollTo(0, 0);
  if (id !== "topicView") stopSpeaking();
}

// ---------- Storage (IndexedDB) ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("studypack", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("packs", { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbRun(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("packs", mode);
    const request = fn(tx.objectStore("packs"));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}
const savePack = (pack) => dbRun("readwrite", (s) => s.put(pack));
const getAllPacks = () => dbRun("readonly", (s) => s.getAll());
const getPack = (id) => dbRun("readonly", (s) => s.get(id));
const deletePack = (id) => dbRun("readwrite", (s) => s.delete(id));

// ---------- Cleaning and checking pack data ----------
function listOf(v) { return Array.isArray(v) ? v : []; }

function tidyTopic(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = asText(raw.title, 120);
  const explanation = asText(raw.explanation, 3000);
  if (!title || !explanation) return null;

  const src = raw.source && typeof raw.source === "object" ? raw.source : {};
  return {
    title: title,
    coverage: ["full", "partial", "thin"].includes(raw.coverage) ? raw.coverage : "partial",
    gaps: listOf(raw.gaps).map((g) => asText(g, 200)).filter(Boolean).slice(0, 8),
    explanation: explanation,
    example: asText(raw.example, 1500),
    mnemonic: asText(raw.mnemonic, 200),
    glossary: listOf(raw.glossary)
      .map((g) => ({ term: asText(g && g.term, 80), meaning: asText(g && g.meaning, 300) }))
      .filter((g) => g.term && g.meaning).slice(0, 10),
    flashcards: listOf(raw.flashcards)
      .map((f) => ({ front: asText(f && f.front, 200), back: asText(f && f.back, 300) }))
      .filter((f) => f.front && f.back).slice(0, 10),
    quiz: listOf(raw.quiz)
      .map((q) => ({
        q: asText(q && q.q, 300),
        options: listOf(q && q.options).map((o) => asText(o, 200)).slice(0, 6),
        answer: q && Number.isInteger(q.answer) ? q.answer : -1,
        why: asText(q && q.why, 300),
      }))
      .filter((q) => q.q && q.options.length >= 2 && q.options.every(Boolean) &&
                     q.answer >= 0 && q.answer < q.options.length)
      .slice(0, 6),
    background: asText(raw.background, 800),
    source: {
      pages: listOf(src.pages).filter(Number.isInteger).slice(0, 50),
      excerpt: asText(src.excerpt, 400),
      verified: src.verified === true,
    },
  };
}

// The source check: is the quoted passage really in the student's notes?
function verifyExcerpt(excerpt, sourceText) {
  if (excerpt.length < 10) return false;
  return normalizeText(sourceText).includes(normalizeText(excerpt));
}

function cleanTopic(raw, chunk) {
  const t = tidyTopic(raw);
  if (!t) return null;
  // Our own minimum rules on top of the AI's rating
  if (chunk.text.length < 250) t.coverage = "thin";
  else if (chunk.text.length < 500 && t.coverage === "full") t.coverage = "partial";
  if (t.coverage === "thin") {
    t.flashcards = t.flashcards.slice(0, 3);
    t.quiz = t.quiz.slice(0, 2);
  }
  t.source.pages = chunk.pages;
  t.source.verified = verifyExcerpt(t.source.excerpt, chunk.text);
  return t;
}

function sanitizePack(raw) {
  if (!raw || raw.format !== "studypack" || !Array.isArray(raw.topics)) {
    throw new Error("This is not a StudyPack file");
  }
  const topics = raw.topics.slice(0, 60).map(tidyTopic).filter(Boolean);
  if (topics.length === 0) throw new Error("The pack has no valid topics");
  topics.forEach((t, i) => { t.id = "t" + (i + 1); });
  return {
    format: "studypack",
    version: 1,
    title: asText(raw.title, 120) || "Imported pack",
    course: asText(raw.course, 100),
    level: asText(raw.level, 30),
    createdAt: asText(raw.createdAt, 20),
    includesBackground: raw.includesBackground === true,
    topics: topics,
  };
}

// ---------- Home: pack list ----------
async function renderPackList() {
  const list = $("packList");
  list.textContent = "";
  let packs = [];
  try { packs = await getAllPacks(); } catch (e) { console.log(e); }
  if (!packs || packs.length === 0) {
    list.appendChild(el("li", "empty", "No packs yet. Create or import one."));
    return;
  }
  packs.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  packs.forEach((p) => {
    const li = el("li", "pack-item");
    li.appendChild(el("div", "pack-title", p.title));
    const kb = Math.max(1, Math.round(JSON.stringify(p).length / 1024));
    li.appendChild(el("div", "pack-meta",
      p.topics.length + " topics · " + kb + " KB · " + (p.level || "") + " · Saved on this phone"));
    li.addEventListener("click", () => openPack(p.id));
    list.appendChild(li);
  });
}

// ---------- Pack screen ----------
let activePack = null;

async function openPack(id) {
  const pack = await getPack(id);
  if (!pack) return;
  activePack = pack;
  $("packTitle").textContent = pack.title;
  const bits = [pack.topics.length + " topics"];
  if (pack.level) bits.push(pack.level);
  bits.push(pack.includesBackground ? "Includes AI background (not from notes)" : "Notes only");
  $("packMeta").textContent = bits.join(" · ");

  const ul = $("packTopics");
  ul.textContent = "";
  pack.topics.forEach((t, i) => {
    const li = el("li", "pack-item");
    li.appendChild(el("div", "pack-title", (i + 1) + ". " + t.title));
    li.appendChild(el("div", "pack-meta",
      "Notes coverage: " + t.coverage + " · " + (t.source.verified ? "source verified" : "source NOT verified")));
    li.addEventListener("click", () => openTopic(i));
    ul.appendChild(li);
  });
  showView("packView");
}

// ---------- Topic screen ----------
function speak(text) {
  if (!("speechSynthesis" in window)) {
    alert("Listening is not supported on this device.");
    return;
  }
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

function setTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  ["explain", "quiz", "cards", "source"].forEach((n) => { $("panel-" + n).hidden = n !== name; });
}
document.querySelectorAll(".tab").forEach((b) => {
  b.addEventListener("click", () => { stopSpeaking(); setTab(b.dataset.tab); });
});

function renderExplain(t) {
  const box = $("panel-explain");
  box.textContent = "";

  const row = el("div", "actions");
  const listen = el("button", "btn ghost small", "Listen");
  listen.addEventListener("click", () => speak(t.title + ". " + t.explanation));
  const stop = el("button", "btn ghost small", "Stop");
  stop.addEventListener("click", stopSpeaking);
  row.appendChild(listen);
  row.appendChild(stop);
  box.appendChild(row);

  box.appendChild(el("p", "body-text", t.explanation));
  if (t.example) {
    box.appendChild(el("h4", null, "Example"));
    box.appendChild(el("p", "body-text", t.example));
  }
  if (t.mnemonic) {
    box.appendChild(el("h4", null, "Memory aid"));
    box.appendChild(el("p", "body-text", t.mnemonic));
  }
  if (t.glossary.length) {
    box.appendChild(el("h4", null, "Key terms"));
    t.glossary.forEach((g) => {
      const p = el("p", "body-text");
      p.appendChild(el("strong", null, g.term + ": "));
      p.appendChild(document.createTextNode(g.meaning));
      box.appendChild(p);
    });
  }
  if (t.gaps.length) {
    box.appendChild(el("h4", null, "What your notes mention but do not explain"));
    const ul = el("ul", "body-text");
    t.gaps.forEach((g) => ul.appendChild(el("li", null, g)));
    box.appendChild(ul);
  }
  if (t.background) {
    const bg = el("div", "bg-box");
    bg.appendChild(el("strong", null, "Extra background (not from your notes)"));
    bg.appendChild(el("p", "body-text", t.background));
    bg.appendChild(el("p", "status-line", "Check this with your lecturer or textbook."));
    box.appendChild(bg);
  }
}

function renderQuiz(t) {
  const box = $("panel-quiz");
  box.textContent = "";
  if (t.quiz.length === 0) {
    box.appendChild(el("p", "body-text", "No quiz questions for this topic."));
    return;
  }
  let score = 0;
  let answered = 0;
  const scoreLine = el("p", "status-line", "Tap an answer. " + t.quiz.length + " questions.");

  t.quiz.forEach((q, qi) => {
    const qbox = el("div", "qbox");
    qbox.appendChild(el("p", "qtext", (qi + 1) + ". " + q.q));
    const why = el("p", "why", q.why);
    why.hidden = true;
    const buttons = [];
    let done = false;

    q.options.forEach((opt, oi) => {
      const b = el("button", "opt", opt);
      b.addEventListener("click", () => {
        if (done) return;
        done = true;
        answered += 1;
        if (oi === q.answer) {
          b.classList.add("right");
          score += 1;
        } else {
          b.classList.add("wrong");
          buttons[q.answer].classList.add("right");
        }
        why.hidden = !q.why;
        scoreLine.textContent = "Score: " + score + " of " + answered + " answered (" + t.quiz.length + " questions)";
      });
      buttons.push(b);
      qbox.appendChild(b);
    });
    qbox.appendChild(why);
    box.appendChild(qbox);
  });
  box.appendChild(scoreLine);
}

function renderCards(t) {
  const box = $("panel-cards");
  box.textContent = "";
  const n = t.flashcards.length;
  if (n === 0) {
    box.appendChild(el("p", "body-text", "No flashcards for this topic."));
    return;
  }
  let i = 0;
  let showBack = false;
  const card = el("button", "flashcard", "");
  const counter = el("p", "status-line", "");

  function draw() {
    card.textContent = showBack ? t.flashcards[i].back : t.flashcards[i].front;
    card.classList.toggle("back", showBack);
    counter.textContent = "Card " + (i + 1) + " of " + n + (showBack ? " (answer)" : " (tap to flip)");
  }
  card.addEventListener("click", () => { showBack = !showBack; draw(); });

  const prev = el("button", "btn ghost small", "Previous");
  prev.addEventListener("click", () => { i = (i - 1 + n) % n; showBack = false; draw(); });
  const next = el("button", "btn primary small", "Next");
  next.addEventListener("click", () => { i = (i + 1) % n; showBack = false; draw(); });
  const row = el("div", "actions");
  row.appendChild(prev);
  row.appendChild(next);

  box.appendChild(card);
  box.appendChild(counter);
  box.appendChild(row);
  draw();
}

function renderSource(t) {
  const box = $("panel-source");
  box.textContent = "";
  box.appendChild(el("p", "body-text",
    "This topic was generated from your own notes. Always check it against your lecturer's material."));
  box.appendChild(el("p", "status-line",
    t.source.pages.length ? "Pages: " + t.source.pages.join(", ") : "Pages: not available"));
  box.appendChild(el("h4", null, "Passage from your notes"));
  box.appendChild(el("blockquote", "quote", t.source.excerpt || "No passage was provided."));
  box.appendChild(el("p", "status-line", t.source.verified
    ? "This passage was found word for word in the original notes when the pack was created."
    : "This passage could NOT be matched to the original notes. Treat this topic with extra care."));
}

function openTopic(i) {
  const t = activePack.topics[i];
  $("topicTitle").textContent = t.title;
  const badges = $("topicBadges");
  badges.textContent = "";
  badges.appendChild(el("span", "badge cov-" + t.coverage, "Notes coverage: " + t.coverage));
  badges.appendChild(el("span", "badge " + (t.source.verified ? "ok" : "warn"),
    t.source.verified ? "Source verified" : "Source not verified"));
  renderExplain(t);
  renderQuiz(t);
  renderCards(t);
  renderSource(t);
  setTab("explain");
  showView("topicView");
}

// ---------- Share (export) and import ----------
async function exportPack() {
  if (!activePack) return;
  const copy = Object.assign({}, activePack);
  delete copy.id;
  delete copy.savedAt;
  const json = JSON.stringify(copy);
  const name = (activePack.title || "pack").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40) + ".studypack";
  const file = new File([json], name, { type: "application/json" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: activePack.title });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  // Fallback: download the file
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("importInput").addEventListener("change", async () => {
  const file = $("importInput").files[0];
  if (!file) return;
  try {
    if (file.size > 3 * 1024 * 1024) throw new Error("The file is too large");
    const pack = sanitizePack(JSON.parse(await file.text()));
    pack.id = "p" + Date.now();
    pack.savedAt = Date.now();
    await savePack(pack);
    await renderPackList();
    await openPack(pack.id);
  } catch (e) {
    alert("Could not import this file: " + e.message);
  }
  $("importInput").value = "";
});

// ---------- Read a PDF ----------
pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";

const notesBox = $("notesBox");
const extractStatus = $("extractStatus");
let currentPages = [];
let pdfJoinedText = "";
let currentChunks = [];

async function extractPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];
  const lowText = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    extractStatus.textContent = "Reading page " + n + " of " + pdf.numPages + "...";
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim();
    pages.push({ page: n, text: text });
    if (text.length < 50) lowText.push(n);
  }
  return { pages: pages, lowText: lowText };
}

$("fileInput").addEventListener("change", async () => {
  const file = $("fileInput").files[0];
  if (!file) return;
  showView("createView");
  extractStatus.textContent = "Opening " + file.name + "...";
  try {
    const result = await extractPdf(file);
    currentPages = result.pages;
    const allText = result.pages.map((p) => p.text).filter((t) => t.length > 0).join("\n\n");
    pdfJoinedText = allText;
    notesBox.value = allText;
    let message = "Read " + result.pages.length + " pages, " + allText.length + " characters.";
    if (result.lowText.length > 0) {
      message += " Pages with almost no readable text (probably scans or images): " +
                 result.lowText.join(", ") + ". Paste their text above if you need them.";
    }
    extractStatus.textContent = message;
  } catch (err) {
    console.log(err);
    extractStatus.textContent = "Could not read this PDF: " + err.message;
  }
  $("fileInput").value = "";
});

// ---------- Split notes into topics ----------
const CHUNK_CHARS = 1800;

function splitLong(text, maxChars) {
  const parts = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(" ", maxChars);
    if (cut < maxChars / 2) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function makeChunks(pages, maxChars) {
  const pieces = [];
  pages.forEach((p) => {
    splitLong(p.text, maxChars).forEach((t) => pieces.push({ page: p.page, text: t }));
  });
  const chunks = [];
  let cur = { pages: [], text: "" };
  pieces.forEach((p) => {
    if (cur.text.length > 0 && cur.text.length + p.text.length > maxChars) {
      chunks.push(cur);
      cur = { pages: [], text: "" };
    }
    if (p.page && !cur.pages.includes(p.page)) cur.pages.push(p.page);
    cur.text += (cur.text ? "\n\n" : "") + p.text;
  });
  if (cur.text) chunks.push(cur);
  return chunks;
}

function getPagesForSplitting() {
  const text = notesBox.value.trim();
  if (text.length === 0) return [];
  if (currentPages.length > 0 && text === pdfJoinedText.trim()) {
    return currentPages.filter((p) => p.text.length > 0);
  }
  return text.split(/\n\s*\n/)
    .map((t) => ({ page: null, text: t.trim() }))
    .filter((p) => p.text.length > 0);
}

// Pasted notes with numbered headings ("1. Title"): one topic per section
function splitByHeadings(text) {
  const headingPattern = /^\d{1,2}[.)]\s+\S/;
  const paragraphs = text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
  const sections = [];
  let cur = null;
  paragraphs.forEach((p) => {
    const isHeading = p.length < 100 && headingPattern.test(p);
    if (isHeading || !cur) {
      cur = { pages: [], text: p };
      sections.push(cur);
    } else {
      cur.text += "\n\n" + p;
    }
  });
  if (sections.length > 0 && !headingPattern.test(sections[0].text) && sections[0].text.length < 150) {
    sections.shift();
  }
  return sections;
}

function getChunks() {
  const text = notesBox.value.trim();
  const isPdfText = currentPages.length > 0 && text === pdfJoinedText.trim();
  if (!isPdfText) {
    const sections = splitByHeadings(text);
    if (sections.length >= 3) {
      const out = [];
      sections.forEach((s) => {
        splitLong(s.text, CHUNK_CHARS).forEach((t) => out.push({ pages: [], text: t }));
      });
      return out;
    }
  }
  return makeChunks(getPagesForSplitting(), CHUNK_CHARS);
}

$("splitBtn").addEventListener("click", () => {
  const chunks = getChunks();
  const topicList = $("topicList");
  topicList.textContent = "";
  if (chunks.length === 0) {
    extractStatus.textContent = "Nothing to split. Upload a PDF or paste notes first.";
    currentChunks = [];
    return;
  }
  chunks.forEach((c, i) => {
    let label = "";
    if (c.pages.length > 0) {
      label = " (pages " + c.pages[0] + (c.pages.length > 1 ? "-" + c.pages[c.pages.length - 1] : "") + ")";
    }
    topicList.appendChild(el("li", null, "Topic " + (i + 1) + label + ": " + c.text.length + " characters"));
  });
  currentChunks = chunks;
  extractStatus.textContent = chunks.length + " topics ready.";
});

// ---------- Generate a pack ----------
const BATCH_SIZE = 2;
const MAX_TOPICS = 14;

function parseTopics(text) {
  if (typeof text !== "string") return null;
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let data;
  try { data = JSON.parse(cleaned); } catch (e) { return null; }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.topics)) return data.topics;
  return null;
}

async function generateBatch(batch, options) {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topics: batch.map((c) => ({ pages: c.pages, text: c.text })),
      level: options.level,
      course: options.course,
      allowBackground: options.allowBackground,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.reason || data.detail || data.error || "Server error " + response.status);
  const items = parseTopics(data.text);
  if (!items) throw new Error("The AI reply was not valid JSON");
  return items;
}

$("generateBtn").addEventListener("click", async () => {
  const genStatus = $("genStatus");
  const generateBtn = $("generateBtn");

  if (!navigator.onLine) {
    genStatus.textContent = "You are offline. Connect once to create a pack, then study offline.";
    return;
  }
  $("splitBtn").click();
  const chunks = currentChunks.slice(0, MAX_TOPICS);
  if (chunks.length === 0) {
    genStatus.textContent = "Add some notes first.";
    return;
  }

  const options = {
    course: $("courseInput").value.trim(),
    level: $("levelSelect").value,
    allowBackground: $("bgCheck").checked,
  };

  generateBtn.disabled = true;
  const topics = [];
  let failed = 0;
  let lastError = "";

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    genStatus.textContent = "Creating topics " + (i + 1) + " to " + (i + batch.length) + " of " + chunks.length + "...";
    let items = null;
    for (let attempt = 1; attempt <= 2 && !items; attempt++) {
      try { items = await generateBatch(batch, options); } catch (err) { lastError = err.message; }
    }
    if (!items) { failed += batch.length; continue; }
    batch.forEach((chunk, j) => {
      const raw = items.find((it) => it && it.index === j + 1) || items[j];
      const topic = cleanTopic(raw, chunk);
      if (topic) topics.push(topic); else failed += 1;
    });
  }

  generateBtn.disabled = false;

  if (topics.length === 0) {
    genStatus.textContent = "Could not create a pack. " + lastError;
    return;
  }
  topics.forEach((t, i) => { t.id = "t" + (i + 1); });

  const pack = {
    id: "p" + Date.now(),
    savedAt: Date.now(),
    format: "studypack",
    version: 1,
    title: options.course || "Untitled pack",
    course: options.course,
    level: options.level,
    createdAt: new Date().toISOString().slice(0, 10),
    includesBackground: options.allowBackground,
    topics: topics,
  };

  try {
    await savePack(pack);
  } catch (e) {
    genStatus.textContent = "The pack was created but could not be saved: " + e.message;
    return;
  }
  genStatus.textContent = "Done. " + topics.length + " topics saved." +
    (failed > 0 ? " " + failed + " topic(s) could not be created." : "");
  await renderPackList();
  await openPack(pack.id);
});

// ---------- Buttons and start-up ----------
$("uploadBtn").addEventListener("click", () => $("fileInput").click());
$("pasteBtn").addEventListener("click", () => { showView("createView"); notesBox.focus(); });
$("myPacksBtn").addEventListener("click", () => $("packList").scrollIntoView({ behavior: "smooth" }));
$("importBtn").addEventListener("click", () => $("importInput").click());
$("menuBtn").addEventListener("click", () => showView("aboutView"));
$("backFromCreate").addEventListener("click", () => showView("homeView"));
$("backFromPack").addEventListener("click", () => showView("homeView"));
$("backFromTopic").addEventListener("click", () => showView("packView"));
$("backFromAbout").addEventListener("click", () => showView("homeView"));
$("exportBtn").addEventListener("click", exportPack);
$("deleteBtn").addEventListener("click", async () => {
  if (!activePack) return;
  if (!confirm("Delete this pack from this device?")) return;
  await deletePack(activePack.id);
  activePack = null;
  await renderPackList();
  showView("homeView");
});

renderPackList();
showView("homeView");
