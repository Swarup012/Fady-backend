const express = require("express");
const cors = require("cors");
const fileUpload = require("express-fileupload");
const config = require("./config/env.config");
const authRoutes = require("./routes/auth.routes");
const boardRoutes = require("./routes/board.routes");
const postRoutes = require("./routes/post.routes");
const publicRoutes = require("./routes/public.routes");
const roadMapRoutes = require("./routes/roadmap.routes.js");
const changelogRoutes = require("./routes/changelog.routes");
const uploadRoutes = require("./routes/upload.routes");
const userRoutes = require("./routes/user.routes");
const organizationRoutes = require("./routes/organization.routes");
const invitationRoutes = require("./routes/invitation.routes");
const notificationRoutes = require("./routes/notification.routes");
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

// ⚠️ CRITICAL: Stripe webhook MUST come BEFORE express.json()
// Stripe needs raw body for signature verification
// Register ONLY webhook route with raw body parsing
const { handleStripeWebhook } = require("./webhooks/stripe.webhook");
app.post("/api/stripe/webhook", express.raw({ type: 'application/json' }), handleStripeWebhook);

// NOW we can parse JSON for all other routes (including other Stripe routes)
app.use(express.json());

// 🔍 REQUEST LOGGING (temporary for debugging) - MOVED HERE after json parsing
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path.includes('/upvote')) {
    console.log(`🔍 ==== UPVOTE REQUEST ====`);
    console.log(`🔍 Method: ${req.method}`);
    console.log(`🔍 Path: ${req.path}`);
    console.log(`🔍 Headers:`, req.headers);
  }
  next();
});

// Don't use express.urlencoded for routes that use multer
app.use((req, res, next) => {
  // Skip urlencoded parsing for avatar upload route (uses multer)
  if (req.path === '/api/auth/upload-avatar') {
    return next();
  }
  express.urlencoded({ extended: true })(req, res, next);
});
// Don't use express-fileupload for routes that use multer
app.use((req, res, next) => {
  // Skip express-fileupload for avatar upload route (uses multer)
  if (req.path === '/api/auth/upload-avatar') {
    return next();
  }
  fileUpload({
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max file size
    abortOnLimit: true,
  })(req, res, next);
});

// Cookie parser for cross-subdomain authentication
const cookieParser = require('cookie-parser');
app.use(cookieParser());

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

// ✅ PUBLIC ROUTES (NO AUTHENTICATION, but with organization context)
app.use("/api/public", injectOrganization, publicRoutes); // ← Organization middleware for subdomain context
app.use("/api", roadMapRoutes); // ← Roadmap routes handle their own auth (public routes first)

// API Routes (require authentication)
app.use("/api/auth", authRoutes);

// ✅ INVITATION ROUTES (public verify, protected accept)
app.use("/api/invitations", invitationRoutes);

// ✅ NOTIFICATION ROUTES (preferences, unsubscribe, history)
app.use("/api/notifications", notificationRoutes);

// ✅ STRIPE ROUTES (webhook already registered above with raw body)
const stripeRoutes = require("./routes/stripe.routes");
app.use("/api/stripe", stripeRoutes);

// ✅ TRACKED USERS ROUTES (usage monitoring)
const trackedUsersRoutes = require("./routes/tracked-users.routes");
app.use("/api/tracked-users", authenticate, injectOrganization, trackedUsersRoutes);

// ✅ ADMIN ROUTES (manual reset, status checks)
const adminRoutes = require("./routes/admin.routes");
app.use("/api/admin", authenticate, injectOrganization, adminRoutes);

// ✅ AUTHENTICATED ROUTES WITH ORGANIZATION CONTEXT
// Organization middleware is added to validate subdomain access
app.use("/api/boards", authenticate, injectOrganization, boardRoutes);
app.use("/api/users", authenticate, injectOrganization, userRoutes);
app.use("/api/organizations", organizationRoutes); // Organization routes handle their own auth (some routes are public)
app.use("/api/upload", authenticate, injectOrganization, uploadRoutes);
app.use("/api", authenticate, injectOrganization, changelogRoutes);
app.use("/api", authenticate, injectOrganization, postRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// Error Handler
const { errorHandler } = require("./middleware/error.middleware");
app.use(errorHandler);

module.exports = app;
