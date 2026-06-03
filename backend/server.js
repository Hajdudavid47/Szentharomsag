import express from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();

// === ÚTVONALAK ===
const ROOT = path.join(__dirname, "..", "public");
const PDF_DIR = path.join(ROOT, "pdfs");
const DATA_DIR = path.join(__dirname, "data");
const ARTICLES_FILE = path.join(DATA_DIR, "articles.json");
const ANNOUNCEMENTS_FILE = path.join(DATA_DIR, "announcements.json");

// === MIDDLEWARE ===
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(ROOT));

// === MULTER (PDF Mentés) ===
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            await fs.mkdir(PDF_DIR, { recursive: true });
            cb(null, PDF_DIR);
        } catch (err) { cb(err); }
    },
    filename: (req, file, cb) => {
        const safeName = file.originalname.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        cb(null, Date.now() + '-' + safeName);
    }
});
const upload = multer({ storage });

// === ADATBÁZIS SEGÉDEK ===
async function readDB(file) {
    try {
        const data = await fs.readFile(file, 'utf8');
        return JSON.parse(data);
    } catch { return []; }
}
async function writeDB(file, data) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

// ========================
// === CIKK API ===
// ========================

app.get("/articles", async (req, res) => {
    res.json(await readDB(ARTICLES_FILE));
});

app.post("/articles", upload.single("pdf"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "PDF fájl kötelező!" });
        const { title, author, abstract } = req.body;
        const newArticle = {
            id: Date.now().toString(),
            title: title || "Cím nélkül",
            author: author || "Ismeretlen",
            abstract: abstract || "",
            pdf: req.file.filename,
            date: new Date().toISOString().split('T')[0]
        };
        const articles = await readDB(ARTICLES_FILE);
        articles.unshift(newArticle);
        await writeDB(ARTICLES_FILE, articles);
        res.status(201).json({ message: "Sikeres feltöltés!", article: newArticle });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Szerver hiba: " + err.message });
    }
});

app.delete("/articles/:id", async (req, res) => {
    try {
        const articles = await readDB(ARTICLES_FILE);
        const article = articles.find(a => a.id === req.params.id);
        if (article && article.pdf) {
            await fs.unlink(path.join(PDF_DIR, article.pdf)).catch(() => {});
        }
        const newArticles = articles.filter(a => a.id !== req.params.id);
        await writeDB(ARTICLES_FILE, newArticles);
        res.json({ message: "Törölve" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ========================
// === ANNOUNCEMENT API ===
// ========================

// GET all announcements (public – frontend reads this)
app.get("/api/announcements", async (req, res) => {
    const all = await readDB(ANNOUNCEMENTS_FILE);
    // Return only active ones to public (sorted newest first)
    const active = all.filter(a => a.active).sort((a, b) => b.createdAt - a.createdAt);
    res.json(active);
});

// GET all announcements (admin – includes inactive)
app.get("/api/announcements/all", async (req, res) => {
    const all = await readDB(ANNOUNCEMENTS_FILE);
    all.sort((a, b) => b.createdAt - a.createdAt);
    res.json(all);
});

// POST create new announcement
app.post("/api/announcements", async (req, res) => {
    try {
        const { text, active } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ message: "Szöveg kötelező!" });
        const newAnn = {
            id: Date.now().toString(),
            text: text.trim(),
            active: active !== false, // default true
            createdAt: Date.now()
        };
        const all = await readDB(ANNOUNCEMENTS_FILE);
        all.unshift(newAnn);
        await writeDB(ANNOUNCEMENTS_FILE, all);
        res.status(201).json(newAnn);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PATCH toggle active/inactive
app.patch("/api/announcements/:id", async (req, res) => {
    try {
        const all = await readDB(ANNOUNCEMENTS_FILE);
        const ann = all.find(a => a.id === req.params.id);
        if (!ann) return res.status(404).json({ message: "Nem található" });
        if (typeof req.body.active !== 'undefined') ann.active = req.body.active;
        if (req.body.text) ann.text = req.body.text.trim();
        await writeDB(ANNOUNCEMENTS_FILE, all);
        res.json(ann);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE announcement
app.delete("/api/announcements/:id", async (req, res) => {
    try {
        const all = await readDB(ANNOUNCEMENTS_FILE);
        const filtered = all.filter(a => a.id !== req.params.id);
        await writeDB(ANNOUNCEMENTS_FILE, filtered);
        res.json({ message: "Törölve" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ==============================
// === YOUTUBE API ===
// ==============================

let videoCache = { data: {}, lastFetch: 0 };
let liveCache = { data: null, lastFetch: 0 };

app.get("/api/videos", async (req, res) => {
    const pageToken = req.query.pageToken || '';
    const now = Date.now();
    if (videoCache.data[pageToken] && now - videoCache.lastFetch < 1800000) {
        return res.json(videoCache.data[pageToken]);
    }
    try {
        const apiKey = process.env.YT_API_KEY;
        const channelId = process.env.YT_CHANNEL_ID;
        if (!apiKey || !channelId) throw new Error("API kulcs hiányzik");
        const pageTokenParam = pageToken ? `&pageToken=${pageToken}` : '';
        const url = `https://www.googleapis.com/youtube/v3/search?key=${apiKey}&channelId=${channelId}&part=snippet,id&type=video&order=date&maxResults=12${pageTokenParam}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) throw new Error("YouTube hiba");
        videoCache.data[pageToken] = data;
        videoCache.lastFetch = now;
        res.json(data);
    } catch (err) {
        console.error("YouTube hiba:", err.message);
        res.status(500).json({ error: "YouTube hiba" });
    }
});

app.get("/api/livestream", async (req, res) => {
    const now = Date.now();
    if (liveCache.data && now - liveCache.lastFetch < 60000) {
        return res.json(liveCache.data);
    }
    try {
        const apiKey = process.env.YT_API_KEY;
        const channelId = process.env.YT_CHANNEL_ID;
        if (!apiKey || !channelId) return res.json({ isLive: false });
        const url = `https://www.googleapis.com/youtube/v3/search?key=${apiKey}&channelId=${channelId}&part=snippet&eventType=live&type=video&maxResults=1`;
        const response = await fetch(url);
        const data = await response.json();
        let resultData = { isLive: false };
        if (data.items && data.items.length > 0) {
            const vid = data.items[0];
            resultData = {
                isLive: true,
                videoId: vid.id.videoId,
                title: vid.snippet.title,
                thumbnail: vid.snippet.thumbnails.high.url
            };
        }
        liveCache = { data: resultData, lastFetch: now };
        res.json(resultData);
    } catch (err) {
        res.status(500).json({ isLive: false });
    }
});

// ========================
// === ALAP ÚTVONALAK ===
// ========================

app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));

app.get("/:page", (req, res, next) => {
    const allowedPages = ["pred", "cikk", "dev", "index-en", "cikk-en", "pred-en"];
    if (allowedPages.includes(req.params.page)) {
        res.sendFile(path.join(ROOT, `${req.params.page}.html`));
    } else {
        next();
    }
});

app.get("/nav", (req, res) => res.json({}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`✅ Server running on http://127.0.0.1:${PORT}`);
});
