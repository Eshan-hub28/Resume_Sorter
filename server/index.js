import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

// pdf-parse ESM workaround
import pdf from "pdf-parse/lib/pdf-parse.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ------ MongoDB Connection ------
const MONGODB_URI = process.env.MONGODB_URI;

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

// ------ Mongoose Schema & Model ------
const candidateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    fileName: { type: String },
    resumeText: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { collection: "candidate_table" }
);

const Candidate = mongoose.model("Candidate", candidateSchema);

// ------ Multer (PDF Upload) ------
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ------ API Routes ------

// Upload one or more PDF resumes
app.post("/api/upload", upload.array("resumes", 20), async (req, res) => {
  try {
    const savedCandidates = [];

    for (const file of req.files) {
      const filePath = path.join(uploadsDir, file.filename);
      const dataBuffer = fs.readFileSync(filePath);

      // Extract text from PDF
      const pdfData = await pdf(dataBuffer);
      const resumeText = pdfData.text;

      // Try to extract the candidate name from filename (remove extension + timestamp prefix)
      let candidateName = file.originalname
        .replace(/\.pdf$/i, "")
        .replace(/[_-]/g, " ")
        .trim();

      // Save to MongoDB
      const candidate = new Candidate({
        name: candidateName,
        fileName: file.originalname,
        resumeText,
      });
      await candidate.save();
      savedCandidates.push(candidate);

      // Clean up the uploaded file
      fs.unlinkSync(filePath);
    }

    res.json({
      success: true,
      message: `${savedCandidates.length} resume(s) uploaded and saved.`,
      candidates: savedCandidates,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Extract text from a single PDF without saving to DB
app.post("/api/extract", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) throw new Error("No file uploaded");
    const filePath = path.join(uploadsDir, req.file.filename);
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdf(dataBuffer);
    fs.unlinkSync(filePath);
    
    res.json({ success: true, text: pdfData.text, fileName: req.file.originalname });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all candidates
app.get("/api/candidates", async (req, res) => {
  try {
    const candidates = await Candidate.find().sort({ uploadedAt: -1 });
    res.json({ success: true, candidates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete a candidate
app.delete("/api/candidates/:id", async (req, res) => {
  try {
    await Candidate.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Candidate deleted." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", db: mongoose.connection.readyState === 1 ? "connected" : "disconnected" });
});

// ------ Start Server ------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
