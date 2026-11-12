# StudyPack

**Connect once, study offline.** StudyPack turns a student's own lecture notes into an offline study pack (explanations, key terms, flashcards, quizzes and read-aloud) that works with no internet and can be shared with classmates as a single file.

Built for the **Wale Lab NextGen AI Hackathon, Track 1: AI for "Zero-Bandwidth" & Localized Learning.**

- **Live prototype:** https://studypack-zm.netlify.app
- **Developer:** Norah Chisha (solo entry), Zambia

## The problem
Many university students study from digital lecture notes but have expensive mobile data and unreliable connectivity or power. Online AI tutors assume a constant connection and give generic answers, not answers based on the student's own lecturer's material.

## Intended users
University students on basic or shared phones with limited or intermittent internet access. We start with Computer Science students at the Copperbelt University (Kitwe, Zambia).

## How it works
1. The student uploads a text-based PDF or pastes notes, and enters the course name and level.
2. The app splits the notes into topics on the device.
3. While online, topics are sent in small batches to Google Gemini through a Netlify serverless function (the API key never reaches the browser).
4. The app validates the AI output and checks that each quoted source passage appears word for word in the student's notes.
5. The pack is saved in the browser (IndexedDB). After that, no internet is needed.
6. The student can share the pack as a `.studypack` file (WhatsApp, Bluetooth, etc.). A classmate opens StudyPack, taps **Import Pack**, chooses the file, and studies offline.

## Features
- Upload a text-based PDF (read on the device with pdf.js) or paste notes; warning for scanned pages
- Topic splitting by numbered headings, or by size for PDFs
- AI-generated explanations, key terms, flashcards and quizzes with explanations
- Source passage for each topic with a **verified / not verified** flag
- Notes-coverage rating (full / partial / thin) and a list of gaps the notes mention but do not explain
- Optional AI background, off by default and clearly labelled as not from the notes
- Listen button (browser text-to-speech; offline where the device has offline voices)
- Packs stored on the device, delete option
- Export and import via `.studypack` files
- Online/offline indicator, About and limits screen
- Installable-style offline loading through a service worker

## Technology
- HTML, CSS and plain JavaScript (no framework)
- Service worker and Cache API (offline loading), IndexedDB (storage)
- [pdf.js](https://mozilla.github.io/pdf.js/) 3.11.174 (Apache-2.0), included in `lib/`
- Web Speech API (read aloud), Web Share API (sharing)
- Netlify (hosting and serverless function), Git and GitHub

## AI tools and services used (disclosure)
- **Google Gemini API** (model: **[gemini-3.5-flash-lite]**) generates the study content, via `netlify/functions/generate.mjs`.
- **Claude (Anthropic) and ChatGPT** was used as an AI assistant during development for guidance and code drafting. All code was reviewed, tested and adapted by the developer.
- Google AI Studio was used to create the API key.

## Pre-existing components and what was built during the hackathon
- Pre-existing, third-party: pdf.js (`lib/pdf.min.js`, `lib/pdf.worker.min.js`).
- Everything else (app, service worker, storage, topic splitting, generation pipeline, validation, source check, study screens, sharing, serverless function, prompt) was developed during the hackathon period.

## Datasets
No datasets were used and no model was trained. For testing, `demo/sample-notes.txt` contains original sample lecture notes on AI and machine learning, written with AI assistance. Do not test with personal documents.

## Running it
**Quickest: use the live site.** Open https://studypack-zm.netlify.app, tap **Paste text**, paste `demo/sample-notes.txt`, enter a course name, tap **Generate pack**. Then switch on airplane mode, reload, and study.

**If AI generation is unavailable** (free-tier limits), tap **Import Pack** and choose `demo/artificial-intelligence.studypack` from this repository to try the study and offline features.

### Local setup
Requirements: Node.js 18 or newer, Git, a free Gemini API key (https://aistudio.google.com), and a free Netlify account (only needed to deploy).

```bash
git clone https://github.com/Norah-Chisha/StudyPack.git
cd StudyPack
npm install -g netlify-cli
```
Create a file named `.env` in the project root:
```
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=your_chosen_flash_model_id
```
Run everything, including the function, locally:
```bash
netlify dev
```
Open the address it prints. (Opening `index.html` with a simple static server such as VS Code Live Server works for everything except **Generate pack**, because the function only runs under Netlify.)

### Deploying
1. Push the repository to GitHub.
2. In Netlify: **Add new project**, **Import from Git**, choose the repository. Leave the build command and publish directory blank.
3. Under **Environment variables**, add `GEMINI_API_KEY` (mark as secret) and `GEMINI_MODEL`.
4. Deploy. The function is available at `/api/generate`.

## Environment configuration
| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini API key, stored only as a Netlify environment variable. Never commit it. |
| `GEMINI_MODEL` | Gemini model id used for generation (a Flash-tier model) |

## Project structure
```
index.html                  Page structure and screens
style.css                   Styling
app.js                      App logic: storage, splitting, generation, study screens, sharing
sw.js                       Service worker (offline loading)
lib/                        pdf.js library files
netlify/functions/generate.mjs   Serverless function: builds the prompt, calls Gemini
demo/                       Sample notes and a ready-made demo pack
```

## Responsible AI
- The AI is told to use only the supplied notes and to ignore any instructions hidden inside them.
- Each topic quotes a passage from the notes; the code verifies the quote and shows the result.
- Coverage ratings, gap lists and limits on questions for thin topics avoid padding weak notes with invented content.
- AI output is validated and cleaned; all text is displayed as plain text; imported files are validated.
- Notes are stored only on the device. They are sent to an AI service when a pack is created, so users are asked not to include personal information. On the free tier, Google may use submitted content to improve its products.
- Not claimed: this prototype is **not** fully accurate and has **not** yet been tested with a group of students. Explanations can contain small errors and should be checked against the lecturer's material.

## Limitations
- Only text-based PDFs are supported (no OCR yet).
- Generation needs an internet connection; studying does not.
- Offline voices depend on the device.
- Shared packs must be imported through the app; the file cannot be opened directly.

## Next steps
Pilot with classmates (with consent), OCR for scanned notes, offline search inside packs, QR sharing of the app link, lecturer-reviewed packs, and, when accuracy can be verified, local-language support.

## Credits
pdf.js by Mozilla. Hackathon by Wale Lab / Wale University.