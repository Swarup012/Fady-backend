const express = require("express");
const cors = require("cors");
const config = require("./config/env.config");
const authRoutes = require("./routes/auth.routes");
const boardRoutes = require("./routes/board.routes");
const postRoutes = require("./routes/post.routes");
const publicRoutes = require("./routes/public.routes");
const roadMapRoutes = require("./routes/roadmap.routes.js");
const userRoutes = require("./routes/user.routes");
const organizationRoutes = require("./routes/organization.routes");
const { authenticate } = require("./middleware/auth.middleware");
const { injectOrganization } = require("./middleware/organization.middleware");

const app = express();

// CORS Configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed origins list
    if (config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow all subdomains of localhost:5173 for development
    // Matches: *.localhost:5173 (e.g., startups.localhost:5173, acme.localhost:5173)
    const localhostPattern = /^http:\/\/[\w-]+\.localhost:5173$/;
    if (localhostPattern.test(origin)) {
      return callback(null, true);
    }
    
    // Allow all subdomains of your production domain
    // Matches: *.yourdomain.com (e.g., startups.fady.com, acme.fady.com)
    const productionPattern = /^https:\/\/[\w-]+\.fady\.com$/;
    if (productionPattern.test(origin)) {
      return callback(null, true);
    }
    
    // If none match, reject
    console.warn('⚠️ CORS blocked origin:', origin);
    callback(new Error("Not allowed by CORS"));
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
app.use("/api", roadMapRoutes); // ← Roadmap routes handle their own auth (public routes first)

// API Routes (require authentication)
app.use("/api/auth", authRoutes);

// ✅ AUTHENTICATED ROUTES WITH ORGANIZATION CONTEXT
// Organization middleware is added to validate subdomain access
app.use("/api/boards", authenticate, injectOrganization, boardRoutes);
app.use("/api/users", authenticate, injectOrganization, userRoutes);
app.use("/api/organizations", organizationRoutes); // Organization routes handle their own auth (some routes are public)
app.use("/api", authenticate, injectOrganization, postRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// Error Handler
const { errorHandler } = require("./middleware/error.middleware");
app.use(errorHandler);

module.exports = app;
