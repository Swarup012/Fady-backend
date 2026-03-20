// src/config/plans.config.js
// =====================================================
// UNIFIED PLAN CONFIGURATION
// Used by both Stripe (legacy) and Paddle
// =====================================================

const PLAN_CONFIG = {
  plans: {
    free: {
      name: 'Free',
      price: 0,
      features: {
        organizations: 1,
        boards: 3,
        posts_per_board: 5,
        posts_per_month: 50,
        team_members: 3, // Free: 3 total members (all roles combined)
        admin_members: -1, // No specific admin limit for Free (covered by team_members)
        tracked_users: 20,
        roadmap_items: 3, // Free: 3 roadmap items
        custom_branding: false,
        custom_domain: 0, // Free: No custom domain
        priority_support: false,
        advanced_analytics: false,
        overage_allowed: false,
      },
    },
    starter: {
      name: 'Starter',
      price: 1900, // $19.00/month (in cents)
      yearlyPrice: 18000, // $180.00/year (in cents)
      effectiveMonthlyYearly: 1500, // $15.00/month when billed yearly
      currency: 'usd',
      interval: 'month',
      features: {
        organizations: 1,
        boards: -1, // Unlimited
        posts_per_board: -1, // Unlimited
        posts_per_month: -1, // Unlimited
        team_members: -1, // Starter: Unlimited team members and viewers
        admin_members: 5, // Starter: Max 5 admins
        tracked_users: 125,
        roadmap_items: -1, // Unlimited roadmap items
        custom_branding: true,
        custom_domain: 0, // Starter: No custom domain
        priority_support: false,
        advanced_analytics: true,
        overage_allowed: true,
      },
      overage: {
        grace_buffer: 25,
        effective_limit: 150,
        price_per_block: 6.0,
        block_size: 50,
        billing_frequency: 'monthly',
      },
    },
    pro: {
      name: 'Pro',
      price: 4900, // $49.00/month (in cents)
      yearlyPrice: 54000, // $540.00/year (in cents)
      effectiveMonthlyYearly: 4500, // $45.00/month when billed yearly
      currency: 'usd',
      interval: 'month',
      features: {
        organizations: 1,
        boards: -1, // Unlimited
        posts_per_board: -1, // Unlimited
        posts_per_month: -1, // Unlimited
        team_members: -1, // PRO: Unlimited team members and viewers
        admin_members: 10, // PRO: Max 10 admins
        tracked_users: 125,
        roadmap_items: -1, // Unlimited roadmap items
        custom_branding: true,
        custom_domain: 1, // PRO: 1 custom domain (subdomain only)
        priority_support: true, // PRO: Priority support
        advanced_analytics: true,
        overage_allowed: true,
      },
      overage: {
        grace_buffer: 25,
        effective_limit: 150,
        price_per_block: 6.0,
        block_size: 50,
        billing_frequency: 'monthly',
      },
    },
  },

  // Trial configuration
  trial: {
    enabled: true,
    days: 14,
    skip_allowed: true,
    overage_during_trial: false,
  },
};

/**
 * Get pricing information for frontend
 */
const getPricingConfig = () => {
  return {
    plans: PLAN_CONFIG.plans,
    trial: PLAN_CONFIG.trial,
    currency: 'USD',
  };
};

module.exports = {
  PLAN_CONFIG,
  getPricingConfig,
};
