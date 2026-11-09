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

    const allText = result.pages.map((p) => p.text).join("\n\n");
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