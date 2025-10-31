const express = require("express");
const cors = require("cors");
const config = require("./config/env.config");
const authRoutes = require("./routes/auth.routes");
const boardRoutes = require("./routes/board.routes");
const postRoutes = require("./routes/post.routes");
const publicRoutes = require("./routes/public.routes"); // ← ADD THIS
const roadMapRoutes = require("./routes/roadmap.routes.js");

const app = express();

// CORS Configuration
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (config.allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging (development)
if (config.nodeEnv === "development") {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`, {
      body: req.body,
      query: req.query,
    });
    next();
  });
}

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// ✅ PUBLIC ROUTES (NO AUTHENTICATION)
app.use("/api/public", publicRoutes); // ← ADD THIS BEFORE AUTH ROUTES

// API Routes (require authentication)
app.use("/api/auth", authRoutes);
app.use("/api/boards", boardRoutes);
app.use("/api", postRoutes);
app.use("/api", roadMapRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// Error Handler
const { errorHandler } = require("./middleware/error.middleware");
app.use(errorHandler);

module.exports = app;
