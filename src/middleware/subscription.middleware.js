// src/middleware/subscription.middleware.js

/**
 * =====================================================
 * SUBSCRIPTION MIDDLEWARE
 * =====================================================
 * Gate features based on subscription status
 * =====================================================
 */

const { supabaseAdmin } = require('../config/supabase.config');
const { PLAN_CONFIG } = require('../config/plans.config');

/**
 * Check if organization has active subscription
 * Usage: Add to routes that require paid plan
 */
const requireActiveSubscription = async (req, res, next) => {
  try {
    const organizationId = req.user?.current_organization_id || req.organization?.id;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'No organization context found',
      });
    }

    // Get subscription status from database
    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .select('subscription_status, subscription_plan')
      .eq('id', organizationId)
      .single();

    if (error || !org) {
      return res.status(500).json({
        success: false,
        error: 'Failed to check subscription status',
      });
    }

    // Check if subscription is active or in trial
    const isActive = ['active', 'trialing'].includes(org.subscription_status);

    if (!isActive) {
      return res.status(403).json({
        success: false,
        error: 'This feature requires an active subscription',
        code: 'SUBSCRIPTION_REQUIRED',
        currentStatus: org.subscription_status,
        currentPlan: org.subscription_plan,
      });
    }

    // Attach subscription info to request
    req.subscription = {
      status: org.subscription_status,
      plan: org.subscription_plan,
      isActive,
    };

    next();
  } catch (error) {
    console.error('Error in requireActiveSubscription middleware:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to verify subscription',
    });
  }
};

/**
 * Check if organization has specific plan
 * Usage: requirePlan('pro') or requirePlan(['pro', 'enterprise'])
 */
const requirePlan = (requiredPlans) => {
  const plans = Array.isArray(requiredPlans) ? requiredPlans : [requiredPlans];

  return async (req, res, next) => {
    try {
      const organizationId = req.user?.current_organization_id || req.organization?.id;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          error: 'No organization context found',
        });
      }

      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('subscription_plan, subscription_status')
        .eq('id', organizationId)
        .single();

      if (!org) {
        return res.status(500).json({
          success: false,
          error: 'Organization not found',
        });
      }

      // Check if user has required plan
      if (!plans.includes(org.subscription_plan)) {
        return res.status(403).json({
          success: false,
          error: `This feature requires ${plans.join(' or ')} plan`,
          code: 'PLAN_UPGRADE_REQUIRED',
          currentPlan: org.subscription_plan,
          requiredPlans: plans,
        });
      }

      // Check if subscription is active
      const isActive = ['active', 'trialing'].includes(org.subscription_status);
      if (!isActive) {
        return res.status(403).json({
          success: false,
          error: 'Subscription is not active',
          code: 'SUBSCRIPTION_INACTIVE',
          currentStatus: org.subscription_status,
        });
      }

      req.subscription = {
        status: org.subscription_status,
        plan: org.subscription_plan,
        isActive,
      };

      next();
    } catch (error) {
      console.error('Error in requirePlan middleware:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to verify plan',
      });
    }
  };
};

/**
 * Check feature-specific limits
 * Usage: checkFeatureLimit('boards', currentCount)
 */
const checkFeatureLimit = (featureName) => {
  return async (req, res, next) => {
    try {
      const organizationId = req.user?.current_organization_id || req.organization?.id;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          error: 'No organization context found',
        });
      }

      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('subscription_plan')
        .eq('id', organizationId)
        .single();

      if (!org) {
        return res.status(500).json({
          success: false,
          error: 'Organization not found',
        });
      }

      // Get feature limit for current plan
      const planConfig = PLAN_CONFIG.plans[org.subscription_plan];
      const limit = planConfig?.features?.[featureName];

      // -1 means unlimited
      if (limit === -1) {
        req.featureLimit = { unlimited: true };
        return next();
      }

      req.featureLimit = {
        unlimited: false,
        limit,
        currentPlan: org.subscription_plan,
      };

      next();
    } catch (error) {
      console.error('Error in checkFeatureLimit middleware:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to check feature limit',
      });
    }
  };
};

/**
 * Soft gate - adds subscription info but doesn't block
 * Usage: For analytics, showing upgrade prompts
 */
const injectSubscriptionInfo = async (req, res, next) => {
  try {
    const organizationId = req.user?.current_organization_id || req.organization?.id;

    if (!organizationId) {
      req.subscription = { status: 'free', plan: 'free', isActive: false };
      return next();
    }

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('subscription_status, subscription_plan, trial_ends_at, current_period_end')
      .eq('id', organizationId)
      .single();

    if (!org) {
      req.subscription = { status: 'free', plan: 'free', isActive: false };
      return next();
    }

    req.subscription = {
      status: org.subscription_status,
      plan: org.subscription_plan,
      isActive: ['active', 'trialing'].includes(org.subscription_status),
      trialEndsAt: org.trial_ends_at,
      periodEnd: org.current_period_end,
    };

    next();
  } catch (error) {
    console.error('Error in injectSubscriptionInfo middleware:', error);
    req.subscription = { status: 'free', plan: 'free', isActive: false };
    next();
  }
};

module.exports = {
  requireActiveSubscription,
  requirePlan,
  checkFeatureLimit,
  injectSubscriptionInfo,
};
