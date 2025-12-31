// src/services/stripe.service.js
const { stripe, STRIPE_CONFIG } = require('../config/stripe.config');
const { supabaseAdmin } = require('../config/supabase.config');

const stripeService = {
  /**
   * =====================================================
   * CREATE OR RETRIEVE STRIPE CUSTOMER
   * =====================================================
   * WHY: Each organization needs a Stripe customer record
   * WHEN: Before creating checkout session or subscription
   */
  async getOrCreateCustomer(organizationId, userEmail, organizationName) {
    try {
      // Check if customer already exists in our DB
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('stripe_customer_id, name')
        .eq('id', organizationId)
        .single();

      if (orgError) throw orgError;

      // If customer exists in Stripe, return it
      if (org.stripe_customer_id) {
        try {
          const customer = await stripe.customers.retrieve(org.stripe_customer_id);
          if (!customer.deleted) {
            console.log(`✅ Using existing Stripe customer: ${org.stripe_customer_id}`);
            return customer;
          }
        } catch (error) {
          console.warn(`⚠️  Stripe customer ${org.stripe_customer_id} not found, creating new one`);
        }
      }

      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: userEmail,
        name: organizationName || org.name,
        metadata: {
          organization_id: organizationId,
          created_by: 'fady_backend',
        },
      });

      // Store customer ID in our database
      const { error: updateError } = await supabaseAdmin
        .from('organizations')
        .update({ 
          stripe_customer_id: customer.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', organizationId);

      if (updateError) {
        console.error('Failed to store customer ID:', updateError);
        throw updateError;
      }

      console.log(`✅ Created new Stripe customer: ${customer.id}`);
      return customer;
    } catch (error) {
      console.error('Error in getOrCreateCustomer:', error);
      throw error;
    }
  },

  /**
   * =====================================================
   * CREATE CHECKOUT SESSION
   * =====================================================
   * WHY: Stripe Checkout handles payment UI securely
   * SECURITY: Payment data never touches our servers
   */
  async createCheckoutSession(organizationId, userId, priceId, successUrl, cancelUrl) {
    try {
      // Get user and organization data
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('email, name')
        .eq('id', userId)
        .single();

      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('name, subscription_status')
        .eq('id', organizationId)
        .single();

      if (!user || !org) {
        throw new Error('User or organization not found');
      }

      // Check if already subscribed
      if (org.subscription_status === 'active') {
        throw new Error('Organization already has an active subscription');
      }

      // Get or create Stripe customer
      const customer = await this.getOrCreateCustomer(organizationId, user.email, org.name);

      // Generate idempotency key to prevent duplicate sessions
      const idempotencyKey = `checkout_${organizationId}_${Date.now()}`;

      // Create Checkout Session
      const session = await stripe.checkout.sessions.create(
        {
          customer: customer.id,
          mode: 'subscription',
          line_items: [
            {
              price: priceId || STRIPE_CONFIG.prices.monthly,
              quantity: 1,
            },
          ],
          
          // Trial configuration
          subscription_data: STRIPE_CONFIG.trial.enabled ? {
            trial_period_days: STRIPE_CONFIG.trial.days,
            metadata: {
              organization_id: organizationId,
              user_id: userId,
            },
          } : {
            metadata: {
              organization_id: organizationId,
              user_id: userId,
            },
          },

          // CRITICAL: Attach metadata for webhook processing
          metadata: {
            organization_id: organizationId,
            user_id: userId,
          },

          // Success/Cancel URLs
          success_url: successUrl,
          cancel_url: cancelUrl,

          // Allow promotion codes
          allow_promotion_codes: true,

          // Billing address collection
          billing_address_collection: 'required',

          // Note: customer_email is not needed when customer ID is provided
        },
        {
          idempotencyKey, // Prevents duplicate sessions if request retries
        }
      );

      console.log(`✅ Checkout session created: ${session.id}`);
      return session;
    } catch (error) {
      console.error('Error creating checkout session:', error);
      throw error;
    }
  },

  /**
   * =====================================================
   * CREATE CUSTOMER PORTAL SESSION
   * =====================================================
   * WHY: Stripe manages cancellation/updates securely
   * SECURITY: Users can't manipulate subscription data
   */
  async createPortalSession(organizationId, returnUrl) {
    try {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('stripe_customer_id')
        .eq('id', organizationId)
        .single();

      if (!org || !org.stripe_customer_id) {
        throw new Error('No Stripe customer found for this organization');
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: org.stripe_customer_id,
        return_url: returnUrl,
      });

      console.log(`✅ Portal session created for customer: ${org.stripe_customer_id}`);
      return session;
    } catch (error) {
      console.error('Error creating portal session:', error);
      throw error;
    }
  },

  /**
   * =====================================================
   * GET SUBSCRIPTION DETAILS
   * =====================================================
   * WHY: Show current subscription info to users
   */
  async getSubscription(organizationId) {
    try {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('stripe_subscription_id, subscription_status, subscription_plan')
        .eq('id', organizationId)
        .single();

      if (!org || !org.stripe_subscription_id) {
        return null;
      }

      const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
      return subscription;
    } catch (error) {
      console.error('Error retrieving subscription:', error);
      return null;
    }
  },

  /**
   * =====================================================
   * CANCEL SUBSCRIPTION
   * =====================================================
   * WHY: Allow admins to cancel (but prefer Customer Portal)
   * SECURITY: Verify user has permission to cancel
   */
  async cancelSubscription(organizationId, immediately = false) {
    try {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('stripe_subscription_id')
        .eq('id', organizationId)
        .single();

      if (!org || !org.stripe_subscription_id) {
        throw new Error('No active subscription found');
      }

      if (immediately) {
        // Cancel immediately (rare use case)
        await stripe.subscriptions.cancel(org.stripe_subscription_id);
        console.log(`✅ Subscription canceled immediately: ${org.stripe_subscription_id}`);
      } else {
        // Cancel at period end (recommended)
        await stripe.subscriptions.update(org.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
        console.log(`✅ Subscription scheduled to cancel at period end: ${org.stripe_subscription_id}`);
      }

      return { success: true };
    } catch (error) {
      console.error('Error canceling subscription:', error);
      throw error;
    }
  },

  /**
   * =====================================================
   * GET INVOICES
   * =====================================================
   * WHY: Show payment history to users
   */
  async getInvoices(organizationId, limit = 10) {
    try {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('stripe_customer_id')
        .eq('id', organizationId)
        .single();

      if (!org || !org.stripe_customer_id) {
        return [];
      }

      const invoices = await stripe.invoices.list({
        customer: org.stripe_customer_id,
        limit,
      });

      return invoices.data;
    } catch (error) {
      console.error('Error retrieving invoices:', error);
      return [];
    }
  },
};

module.exports = stripeService;
