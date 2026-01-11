// src/config/stripe.config.js
const Stripe = require('stripe');

// =====================================================
// STRIPE CONFIGURATION
// NEVER hardcode keys - always use environment variables
// =====================================================

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
}

if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.warn('⚠️  STRIPE_WEBHOOK_SECRET not set - webhook signature verification will fail');
}

// Initialize Stripe with secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia', // Use latest stable API version
  typescript: false,
  maxNetworkRetries: 3, // Retry failed requests
  timeout: 30000, // 30 second timeout
});

// =====================================================
// STRIPE PRICING CONFIGURATION
// In production, these should come from Stripe Dashboard
// =====================================================

const STRIPE_CONFIG = {
  // Pricing IDs (create these in Stripe Dashboard)
  prices: {
    // New Starter plan price IDs
    starter_monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY || process.env.STRIPE_PRICE_MONTHLY || 'price_xxx', // $19/month
    starter_yearly: process.env.STRIPE_PRICE_STARTER_YEARLY || process.env.STRIPE_PRICE_YEARLY || 'price_yyy',   // $180/year
    overage_metered: process.env.STRIPE_PRICE_OVERAGE || 'price_zzz',         // $6 per 50 users (metered)
    
    // Legacy price IDs (for backward compatibility)
    monthly: process.env.STRIPE_PRICE_MONTHLY || 'price_xxx',
    yearly: process.env.STRIPE_PRICE_YEARLY || 'price_yyy',
  },

  // Plan configurations
  plans: {
    free: {
      name: 'Free',
      price: 0,
      features: {
        boards: 3,
        posts_per_board: 5, // 5 posts per board
        posts_per_month: 50, // Total for backward compatibility
        team_members: 3, // 3 team members total (including owner)
        tracked_users: 20, // 20 tracked users (voters/commenters) - HARD LIMIT
        roadmap_items: 1, // 1 roadmap
        custom_branding: false,
        priority_support: false,
        advanced_analytics: false,
        overage_allowed: false,
      },
    },
    starter: {
      name: 'Starter',
      price: 1900, // $19.00/month (in cents)
      yearlyPrice: 18000, // $180.00/year (in cents) - saves $48/year
      effectiveMonthlyYearly: 1500, // $15.00/month when billed yearly
      currency: 'usd',
      interval: 'month',
      features: {
        boards: -1, // Unlimited
        posts_per_board: -1, // Unlimited
        posts_per_month: -1, // Unlimited
        team_members: 5, // 5 team members
        tracked_users: 125, // 125 tracked users included
        roadmap_items: 1, // 1 roadmap
        custom_branding: true,
        priority_support: false, // Optional: can add for annual plans
        advanced_analytics: true,
        overage_allowed: true,
      },
      // Overage billing configuration
      overage: {
        grace_buffer: 25, // 20% buffer (don't charge until 150 users)
        effective_limit: 150, // 125 base + 25 grace
        price_per_block: 6.00, // $6 per block
        block_size: 50, // 50 users per block
        billing_frequency: 'monthly', // Charge overage monthly for both monthly and annual
      },
    },
    // Keep 'pro' as alias for backward compatibility during migration
    pro: {
      name: 'Starter', // Maps to Starter
      price: 1900,
      yearlyPrice: 18000,
      effectiveMonthlyYearly: 1500,
      currency: 'usd',
      interval: 'month',
      features: {
        boards: -1,
        posts_per_board: -1,
        posts_per_month: -1,
        team_members: 5, // 5 team members
        tracked_users: 125,
        roadmap_items: 1, // 1 roadmap
        custom_branding: true,
        priority_support: false,
        advanced_analytics: true,
        overage_allowed: true,
      },
      overage: {
        grace_buffer: 25,
        effective_limit: 150,
        price_per_block: 6.00,
        block_size: 50,
        billing_frequency: 'monthly',
      },
    },
  },

  // Trial configuration
  trial: {
    enabled: true,
    days: 14, // 14-day trial
    skip_allowed: true, // Allow users to skip trial and pay immediately
    overage_during_trial: false, // No overage charges during trial
  },

  // Webhook events we handle
  webhookEvents: [
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_succeeded',
    'invoice.payment_failed',
    'customer.subscription.trial_will_end',
    'invoice.upcoming',
  ],

  // Customer Portal configuration
  customerPortal: {
    features: [
      'subscription_cancel',
      'subscription_update',
      'payment_method_update',
      'invoice_history',
    ],
  },
};

// =====================================================
// STRIPE HELPER FUNCTIONS
// =====================================================

/**
 * Validate Stripe configuration on startup
 */
const validateStripeConfig = async () => {
  try {
    // Test API connection
    const balance = await stripe.balance.retrieve();
    console.log('✅ Stripe connected successfully');
    console.log(`💰 Account balance: ${balance.available[0].amount / 100} ${balance.available[0].currency.toUpperCase()}`);
    
    // Warn if using test mode in production
    if (process.env.NODE_ENV === 'production' && process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
      console.warn('⚠️  WARNING: Using Stripe TEST mode in production environment!');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Stripe configuration error:', error.message);
    throw new Error('Failed to initialize Stripe. Check your STRIPE_SECRET_KEY.');
  }
};

/**
 * Get pricing information for frontend
 * NEVER expose secret keys to frontend
 */
const getPricingConfig = () => {
  return {
    plans: STRIPE_CONFIG.plans,
    trial: STRIPE_CONFIG.trial,
    currency: 'USD',
    // DO NOT include: secret keys, webhook secrets, internal IDs
  };
};

module.exports = {
  stripe,
  STRIPE_CONFIG,
  validateStripeConfig,
  getPricingConfig,
};
