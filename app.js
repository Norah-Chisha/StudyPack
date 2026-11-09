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