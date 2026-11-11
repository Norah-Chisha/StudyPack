const netStatus = document.getElementById("netStatus");

function updateNetStatus() {
  const online = navigator.onLine;
  netStatus.textContent = online ? "Online" : "Offline";
  netStatus.classList.toggle("offline", !online);
}

window.addEventListener("online", updateNetStatus);
window.addEventListener("offline", updateNetStatus);
updateNetStatus();

setInterval(updateNetStatus, 2000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then(() => console.log("Service worker registered"))
      .catch((err) => console.log("Service worker failed:", err));
  });
}

// ---------- PDF reading ----------
pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";

const fileInput = document.getElementById("fileInput");
const createView = document.getElementById("createView");
const notesBox = document.getElementById("notesBox");
const extractStatus = document.getElementById("extractStatus");
const notesPreview = document.getElementById("notesPreview");

let currentPages = []; // later phases will use this: [{ page: 1, text: "..." }, ...]
let pdfJoinedText = "";
let currentChunks = [];

document.getElementById("uploadBtn").addEventListener("click", () => fileInput.click());

document.getElementById("pasteBtn").addEventListener("click", () => {
  createView.hidden = false;
  notesBox.focus();
});

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

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  createView.hidden = false;
  notesPreview.textContent = "";
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
    notesPreview.textContent = allText.slice(0, 600);
  } catch (err) {
    console.log(err);
    extractStatus.textContent = "Could not read this PDF. It may be password-protected or damaged.";
  }
  fileInput.value = "";
});

// ---------- Topic splitting ----------
const topicList = document.getElementById("topicList");

// Cut very long text into pieces no longer than maxChars, at a space if possible
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

// Group pages into chunks of about maxChars, remembering the page numbers
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

// Use real page numbers if the box still holds the PDF text; otherwise treat it as pasted text
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

document.getElementById("splitBtn").addEventListener("click", () => {
  const chunks = makeChunks(getPagesForSplitting(), 3000);
  topicList.textContent = "";

  if (chunks.length === 0) {
    extractStatus.textContent = "Nothing to split. Upload a PDF or paste notes first.";
    return;
  }

  chunks.forEach((c, i) => {
    const li = document.createElement("li");
    let label = "";
    if (c.pages.length > 0) {
      label = " (pages " + c.pages[0] + (c.pages.length > 1 ? "-" + c.pages[c.pages.length - 1] : "") + ")";
    }
    li.textContent = "Topic " + (i + 1) + label + ": " + c.text.length + " characters";
    topicList.appendChild(li);
  });

  currentChunks = chunks;
  extractStatus.textContent = chunks.length + " topics ready.";
});

// ---------- Phase 5E: generate a pack ----------
const generateBtn = document.getElementById("generateBtn");
const genStatus = document.getElementById("genStatus");
const packResult = document.getElementById("packResult");

const BATCH_SIZE = 2;   // topics per AI request
const MAX_TOPICS = 12;  // protects your free quota while testing
let currentPack = null;

function asText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeText(s) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// The source check: does the quoted passage really appear in the student's notes?
function verifyExcerpt(excerpt, sourceText) {
  if (excerpt.length < 10) return false;
  return normalizeText(sourceText).includes(normalizeText(excerpt));
}

// Accept either {"topics":[...]} or a bare array
function parseTopics(text) {
  if (typeof text !== "string") return null;
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let data;
  try { data = JSON.parse(cleaned); } catch (e) { return null; }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.topics)) return data.topics;
  return null;
}

// Check and tidy one topic from the AI. Returns null if it is unusable.
function cleanTopic(raw, chunk) {
  if (!raw || typeof raw !== "object") return null;
  const title = asText(raw.title, 120);
  const explanation = asText(raw.explanation, 3000);
  if (!title || !explanation) return null;

  // Coverage: our own minimum rules on top of the AI's rating
  let coverage = ["full", "partial", "thin"].includes(raw.coverage) ? raw.coverage : "partial";
  if (chunk.text.length < 400) coverage = "thin";
  else if (chunk.text.length < 1200 && coverage === "full") coverage = "partial";

  const list = (v) => (Array.isArray(v) ? v : []);

  const gaps = list(raw.gaps).map((g) => asText(g, 200)).filter(Boolean).slice(0, 8);

  const glossary = list(raw.glossary)
    .map((g) => ({ term: asText(g && g.term, 80), meaning: asText(g && g.meaning, 300) }))
    .filter((g) => g.term && g.meaning)
    .slice(0, 10);

  let flashcards = list(raw.flashcards)
    .map((f) => ({ front: asText(f && f.front, 200), back: asText(f && f.back, 300) }))
    .filter((f) => f.front && f.back)
    .slice(0, 10);

  let quiz = list(raw.quiz)
    .map((q) => ({
      q: asText(q && q.q, 300),
      options: list(q && q.options).map((o) => asText(o, 200)).slice(0, 6),
      answer: q && Number.isInteger(q.answer) ? q.answer : -1,
      why: asText(q && q.why, 300),
    }))
    .filter((q) => q.q && q.options.length >= 2 && q.options.every(Boolean) &&
                   q.answer >= 0 && q.answer < q.options.length)
    .slice(0, 6);

  // Thin topics get fewer items, enforced by code
  if (coverage === "thin") {
    flashcards = flashcards.slice(0, 3);
    quiz = quiz.slice(0, 2);
  }

  const excerpt = asText(raw.source && raw.source.excerpt, 400);

  return {
    title: title,
    coverage: coverage,
    gaps: gaps,
    explanation: explanation,
    example: asText(raw.example, 1500),
    mnemonic: asText(raw.mnemonic, 200),
    glossary: glossary,
    flashcards: flashcards,
    quiz: quiz,
    background: asText(raw.background, 800),
    source: { pages: chunk.pages, excerpt: excerpt, verified: verifyExcerpt(excerpt, chunk.text) },
  };
}

// Send one batch of topics to your Netlify function
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

function showPackSummary(pack, failedCount) {
  packResult.textContent = "";

  const heading = document.createElement("h3");
  heading.textContent = pack.title + " (" + pack.topics.length + " topics)";
  packResult.appendChild(heading);

  const ul = document.createElement("ul");
  ul.className = "pack-list";
  pack.topics.forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t.title +
      "\nNotes coverage: " + t.coverage +
      " | Source: " + (t.source.verified ? "verified" : "NOT verified") +
      " | " + t.quiz.length + " questions, " + t.flashcards.length + " flashcards" +
      (t.gaps.length ? "\nGaps: " + t.gaps.join("; ") : "");
    li.style.whiteSpace = "pre-line";
    ul.appendChild(li);
  });
  packResult.appendChild(ul);

  if (failedCount > 0) {
    const note = document.createElement("p");
    note.className = "status-line";
    note.textContent = failedCount + " topic(s) could not be generated. You can try again.";
    packResult.appendChild(note);
  }
}

generateBtn.addEventListener("click", async () => {
  if (!navigator.onLine) {
    genStatus.textContent = "You are offline. Connect once to generate a pack, then study offline.";
    return;
  }

  document.getElementById("splitBtn").click(); // fills currentChunks
  const chunks = currentChunks.slice(0, MAX_TOPICS);
  if (chunks.length === 0) {
    genStatus.textContent = "Add some notes first.";
    return;
  }

  const options = {
    course: document.getElementById("courseInput").value.trim(),
    level: document.getElementById("levelSelect").value,
    allowBackground: document.getElementById("bgCheck").checked,
  };

  generateBtn.disabled = true;
  packResult.textContent = "";
  const topics = [];
  let failed = 0;
  let lastError = "";

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    genStatus.textContent = "Generating topics " + (i + 1) + " to " + (i + batch.length) +
                            " of " + chunks.length + "...";

    let items = null;
    for (let attempt = 1; attempt <= 2 && !items; attempt++) {
      try {
        items = await generateBatch(batch, options);
      } catch (err) {
        lastError = err.message;
      }
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
    genStatus.textContent = "Could not generate a pack. " + lastError;
    return;
  }

  topics.forEach((t, i) => { t.id = "t" + (i + 1); });

  currentPack = {
    format: "studypack",
    version: 1,
    title: options.course || "Untitled pack",
    course: options.course,
    level: options.level,
    createdAt: new Date().toISOString().slice(0, 10),
    includesBackground: options.allowBackground,
    topics: topics,
  };

  genStatus.textContent = "Done. " + topics.length + " topics ready.";
  showPackSummary(currentPack, failed);
  console.log("currentPack", currentPack);
});