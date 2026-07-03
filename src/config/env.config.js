require('dotenv').config();

const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_KEY
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  // Resend email configuration
  resendApiKey: process.env.RESEND_API_KEY,
  resendFromEmail: process.env.RESEND_FROM_EMAIL || 'Feedy <onboarding@resend.dev>',
  // Cookie configuration for cross-subdomain auth
  cookieDomain: process.env.COOKIE_DOMAIN || 'localhost', // Will be 'faddy.site' in production
  cookieSecure: process.env.NODE_ENV === 'production', // HTTPS only in production
  cookieMaxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  // In development, browsers silently reject cookies with domain='.localhost'
  // So we only set the domain attribute in production
  isProduction: process.env.NODE_ENV === 'production'
};

// Validate required environment variables
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY'
];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
});

module.exports = config;
