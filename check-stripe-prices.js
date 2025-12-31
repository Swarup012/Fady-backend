// Quick script to find your Stripe Price ID
// Run with: node check-stripe-prices.js

require('dotenv').config();
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function getPrices() {
  try {
    console.log('🔍 Fetching prices from Stripe...\n');
    
    // Get the product first
    const productId = 'prod_TevmFI0m5hgCn9';
    console.log(`📦 Product ID: ${productId}\n`);
    
    // List all prices for this product
    const prices = await stripe.prices.list({
      product: productId,
      limit: 10,
    });

    if (prices.data.length === 0) {
      console.log('❌ No prices found for this product!');
      console.log('\n💡 You need to create a price in Stripe Dashboard:');
      console.log('   https://dashboard.stripe.com/test/products/' + productId);
      return;
    }

    console.log(`✅ Found ${prices.data.length} price(s):\n`);

    prices.data.forEach((price, index) => {
      console.log(`Price ${index + 1}:`);
      console.log(`  ID: ${price.id}`);
      console.log(`  Amount: $${price.unit_amount / 100} ${price.currency.toUpperCase()}`);
      console.log(`  Interval: ${price.recurring?.interval || 'one-time'}`);
      console.log(`  Active: ${price.active ? '✅' : '❌'}`);
      
      if (price.recurring?.interval === 'month' && price.active) {
        console.log('\n  👉 USE THIS FOR STRIPE_PRICE_MONTHLY:');
        console.log(`     STRIPE_PRICE_MONTHLY=${price.id}\n`);
      }
      console.log('---');
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.statusCode === 401) {
      console.log('\n⚠️  Authentication failed!');
      console.log('Your STRIPE_SECRET_KEY might be invalid.');
      console.log('Current key starts with:', process.env.STRIPE_SECRET_KEY?.substring(0, 20) + '...');
    }
  }
}

getPrices();
