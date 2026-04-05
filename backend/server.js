import express from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

// Környezeti változók betöltése (.env)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// A .env fájl a gyökérben van (egy szinttel feljebb)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();

// === ÚTVONALAK ===
const ROOT = path.join(__dirname, "..", "public");
const PDF_DIR = path.join(ROOT, "pdfs");
const DATA_DIR = path.join(__dirname, "data");
const ARTICLES_FILE = path.join(DATA_DIR, "articles.json");

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
        // Ékezetmentesítés a biztonságos fájlnévért
        const safeName = file.originalname.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        cb(null, Date.now() + '-' + safeName);
    }
});
const upload = multer({ storage });

// === ADATBÁZIS SEGÉDEK ===
async function readDB() {
    try {
        const data = await fs.readFile(ARTICLES_FILE, 'utf8');
        return JSON.parse(data);
    } catch { return []; }
}
async function writeDB(data) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(ARTICLES_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ========================
// === CIKK API (ÚJ) ===
// ========================

// 1. Cikkek lekérése
app.get("/articles", async (req, res) => {
    res.json(await readDB());
});

// 2. Új Cikk Feltöltése (PDF + Adatok)
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

        const articles = await readDB();
        articles.unshift(newArticle);
        await writeDB(articles);

        res.status(201).json({ message: "Sikeres feltöltés!", article: newArticle });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Szerver hiba: " + err.message });
    }
});

// 3. Cikk Törlése
app.delete("/articles/:id", async (req, res) => {
    try {
        const articles = await readDB();
        const article = articles.find(a => a.id === req.params.id);
        
        if (article && article.pdf) {
            await fs.unlink(path.join(PDF_DIR, article.pdf)).catch(() => {});
        }

        const newArticles = articles.filter(a => a.id !== req.params.id);
        await writeDB(newArticles);
        
        res.json({ message: "Törölve" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ==============================
// === YOUTUBE API (RÉGI) ===
// ==============================

let videoCache = { data: {}, lastFetch: 0 };
let liveCache = { data: null, lastFetch: 0 };

// Videók lekérése
app.get("/api/videos", async (req, res) => {
    const pageToken = req.query.pageToken || '';
    const now = Date.now();
    
    // Egyszerű cache (30 perc)
    if (videoCache.data[pageToken] && now - videoCache.lastFetch < 1800000) {
        return res.json(videoCache.data[pageToken]);
    }

    try {
        const apiKey = process.env.YT_API_KEY;
        const channelId = process.env.YT_CHANNEL_ID;
        
        // Ellenőrzés, hogy betöltődtek-e a változók
        if (!apiKey || !channelId) {
            console.error("HIBA: Nincs YT_API_KEY vagy YT_CHANNEL_ID a .env fájlban!");
            throw new Error("API kulcs hiányzik");
        }

        const pageTokenParam = pageToken ? `&pageToken=${pageToken}` : '';
        const url = `https://www.googleapis.com/youtube/v3/search?key=${apiKey}&channelId=${channelId}&part=snippet,id&type=video&order=date&maxResults=12${pageTokenParam}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if(!response.ok) {
             console.error("YouTube API Válasz Hiba:", data);
             throw new Error("YouTube hiba");
        }

        videoCache.data[pageToken] = data;
        videoCache.lastFetch = now;
        res.json(data);
    } catch (err) {
        console.error("YouTube hiba:", err.message);
        res.status(500).json({ error: "YouTube hiba" });
    }
});

// Élő adás ellenőrzése
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

// HTML oldalak kiszolgálása (biztonsági ellenőrzéssel)
app.get("/:page", (req, res, next) => {
    const allowedPages = ["pred", "cikk", "dev", "index-en", "cikk-en", "pred-en"];
    if (allowedPages.includes(req.params.page)) {
        res.sendFile(path.join(ROOT, `${req.params.page}.html`));
    } else {
        next();
    }
});

// Navigáció (placeholder, hogy ne legyen hiba)
app.get("/nav", (req, res) => res.json({}));

// SZERVER INDÍTÁSA
const PORT = process.env.PORT || 3000;
// Fontos: 127.0.0.1, mert Nginx proxy mögött vagyunk
app.listen(PORT, "127.0.0.1", () => {
  console.log(`✅ Server running on http://127.0.0.1:${PORT}`);
});