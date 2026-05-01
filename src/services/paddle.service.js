// src/services/paddle.service.js
// Paddle Billing API integration (NEW API, not Classic)

const axios = require('axios');
const { supabaseAdmin } = require('../config/supabase.config');

const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
// Determine environment from API key
const IS_SANDBOX = PADDLE_API_KEY && PADDLE_API_KEY.includes('_sdbx_');
const PADDLE_API_URL = IS_SANDBOX 
  ? 'https://sandbox-api.paddle.com'
  : 'https://api.paddle.com';

const paddleService = {
  /**
   * Create Paddle Billing Checkout (NEW API)
   * Returns checkout URL for frontend redirect
   */
  async createCheckoutLink(organizationId, userEmail, priceId, successUrl, cancelUrl, skipTrial = false) {
    try {
      console.log('🔵 Creating Paddle Billing checkout...', {
        priceId,
        userEmail,
        apiUrl: PADDLE_API_URL,
        isSandbox: IS_SANDBOX,
        skipTrial
      });

      // Build transaction request body
      const requestBody = {
        items: [
          {
            price_id: priceId,
            quantity: 1
          }
        ],
        customer_email: userEmail,
        custom_data: {
          organization_id: organizationId
        }
      };

      // If skipTrial is true, set trial_period to null to skip the trial
      if (skipTrial) {
        console.log('⚡ Skipping trial - setting trial_period to null');
        requestBody.trial_period = null;
      }

      // Create transaction using Paddle Billing API
      // Note: We don't set custom checkout URL to avoid domain approval requirement
      const response = await axios.post(
        `${PADDLE_API_URL}/transactions`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${PADDLE_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const transactionData = response.data.data;
      console.log('✅ Paddle transaction created:', transactionData.id);
      
      // Extract checkout URL
      const checkoutUrl = transactionData.checkout?.url || response.data.checkout_url;
      
      if (!checkoutUrl) {
        console.error('❌ No checkout URL in response:', response.data);
        throw new Error('No checkout URL returned from Paddle');
      }
      
      console.log('✅ Checkout URL:', checkoutUrl);
      
      // Return both URL and transaction ID (for overlay checkout support)
      return {
        url: checkoutUrl,
        transactionId: transactionData.id
      };
    } catch (error) {
      if (error.response) {
        console.error('❌ Paddle API error:', {
          status: error.response.status,
          data: error.response.data
        });
        throw new Error(error.response.data?.error?.detail || 'Paddle API error');
      }
      console.error('❌ Error creating Paddle checkout:', error.message);
      throw error;
    }
  },

  /**
   * Store Paddle subscription/customer IDs after webhook
   */
  async storePaddleSubscription(organizationId, paddleCustomerId, paddleSubscriptionId, paddlePlanId) {
    const { error } = await supabaseAdmin
      .from('organizations')
      .update({
        paddle_customer_id: paddleCustomerId,
        paddle_subscription_id: paddleSubscriptionId,
        paddle_plan_id: paddlePlanId,
        billing_provider: 'paddle',
        updated_at: new Date().toISOString(),
      })
      .eq('id', organizationId);
    if (error) throw error;
  },

  /**
   * Update subscription to a new plan (upgrade/downgrade)
   * Used when users want to switch from Starter to Pro or vice versa
   * 
   * Per Paddle docs: https://developer.paddle.com/build/subscriptions/replace-products-prices-upgrade-downgrade
   * We need to:
   * 1. Get existing subscription items
   * 2. Replace the base plan price_id with new one
   * 3. Keep any addon items
   */
  async updateSubscription(subscriptionId, newPriceId, prorationBehavior = 'prorated_immediately') {
    try {
      console.log('🔄 Step 1: Getting current subscription details...', {
        subscriptionId
      });

      // Step 1: Get current subscription to extract existing items
      const currentSub = await this.getSubscriptionDetails(subscriptionId);
      
      if (!currentSub || !currentSub.items) {
        throw new Error('Could not retrieve current subscription items');
      }

      console.log('📋 Current subscription items:', currentSub.items.map(i => ({
        price_id: i.price.id,
        quantity: i.quantity
      })));

      // Step 2: Build new items array
      // Replace the base plan with new price_id, keep other items (addons) if any
      const newItems = currentSub.items.map(item => {
        // For now, assuming single item (base plan)
        // In future, you can add logic to identify base plan vs addons
        return {
          price_id: newPriceId,
          quantity: 1
        };
      });

      // If subscription has no items for some reason, create new array
      if (newItems.length === 0) {
        newItems.push({
          price_id: newPriceId,
          quantity: 1
        });
      }

      console.log('🔄 Step 2: Updating subscription with new items...', {
        subscriptionId,
        newItems,
        prorationBehavior
      });

      // Step 3: Update subscription using Paddle Billing API
      const response = await axios.patch(
        `${PADDLE_API_URL}/subscriptions/${subscriptionId}`,
        {
          items: newItems,
          proration_billing_mode: prorationBehavior // 'prorated_immediately', 'prorated_next_billing_period', or 'do_not_bill'
        },
        {
          headers: {
            'Authorization': `Bearer ${PADDLE_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const updatedSubscription = response.data.data;
      console.log('✅ Subscription updated successfully:', {
        id: updatedSubscription.id,
        status: updatedSubscription.status
      });
      
      return {
        success: true,
        subscription: updatedSubscription
      };
    } catch (error) {
      if (error.response) {
        console.error('❌ Paddle API error:', {
          status: error.response.status,
          data: error.response.data
        });
        throw new Error(error.response.data?.error?.detail || 'Failed to update subscription');
      }
      console.error('❌ Error updating subscription:', error.message);
      throw error;
    }
  },

  /**
   * Get subscription details from Paddle
   */
  async getSubscriptionDetails(subscriptionId) {
    try {
      const response = await axios.get(
        `${PADDLE_API_URL}/subscriptions/${subscriptionId}`,
        {
          headers: {
            'Authorization': `Bearer ${PADDLE_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data.data;
    } catch (error) {
      if (error.response) {
        console.error('❌ Paddle API error:', error.response.data);
        throw new Error('Failed to get subscription details');
      }
      throw error;
    }
  },

  // Add more Paddle API methods as needed (cancel, invoices, etc.)
};

module.exports = paddleService;
