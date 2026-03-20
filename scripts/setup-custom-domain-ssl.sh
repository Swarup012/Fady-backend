#!/bin/bash

# Custom Domain SSL Setup Script
# This script automates SSL certificate generation for custom domains

set -e  # Exit on error

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Please run as root (use sudo)"
    exit 1
fi

# Check if domain argument is provided
if [ -z "$1" ]; then
    echo "❌ Usage: sudo ./setup-custom-domain-ssl.sh <domain> <email>"
    echo "   Example: sudo ./setup-custom-domain-ssl.sh feedback.acme.com admin@faddy.site"
    exit 1
fi

DOMAIN=$1
EMAIL=${2:-"admin@faddy.site"}
WEBROOT="/var/www/certbot"

echo "🔒 Setting up SSL for: $DOMAIN"
echo "📧 Email: $EMAIL"

# Create webroot directory if it doesn't exist
mkdir -p $WEBROOT

# Step 1: Test Nginx configuration
echo "📋 Step 1: Testing Nginx configuration..."
nginx -t
if [ $? -ne 0 ]; then
    echo "❌ Nginx configuration test failed"
    exit 1
fi

# Step 2: Reload Nginx
echo "🔄 Step 2: Reloading Nginx..."
systemctl reload nginx

# Step 3: Obtain SSL certificate from Let's Encrypt
echo "🔐 Step 3: Obtaining SSL certificate..."
certbot certonly \
    --webroot \
    --webroot-path=$WEBROOT \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    --domain $DOMAIN \
    --non-interactive

if [ $? -ne 0 ]; then
    echo "❌ Failed to obtain SSL certificate"
    exit 1
fi

# Step 4: Verify certificate was created
echo "✅ Step 4: Verifying certificate..."
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    echo "❌ Certificate file not found"
    exit 1
fi

# Step 5: Update Nginx config to use SSL
echo "🔄 Step 5: Updating Nginx configuration for SSL..."
# The SSL server block should already be in the template
# Just reload Nginx to apply it
nginx -t && systemctl reload nginx

if [ $? -ne 0 ]; then
    echo "❌ Failed to reload Nginx with SSL configuration"
    exit 1
fi

# Step 6: Verify SSL is working
echo "🧪 Step 6: Testing SSL connection..."
sleep 2
curl -sSf https://$DOMAIN > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ SSL is working correctly!"
else
    echo "⚠️  SSL certificate installed but connection test failed"
    echo "   Please check your DNS and firewall settings"
fi

# Step 7: Set up auto-renewal (should already be configured)
echo "🔄 Step 7: Verifying auto-renewal is configured..."
systemctl status certbot.timer --no-pager | grep -q "active"
if [ $? -eq 0 ]; then
    echo "✅ Auto-renewal is active"
else
    echo "⚠️  Auto-renewal may not be configured. Run: systemctl enable certbot.timer"
fi

echo ""
echo "🎉 SSL setup complete for $DOMAIN!"
echo ""
echo "Certificate Details:"
echo "  - Certificate: /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
echo "  - Private Key: /etc/letsencrypt/live/$DOMAIN/privkey.pem"
echo "  - Expires: $(openssl x509 -enddate -noout -in /etc/letsencrypt/live/$DOMAIN/fullchain.pem | cut -d= -f2)"
echo ""
echo "Auto-renewal will happen automatically via certbot.timer"
echo "Test auto-renewal with: certbot renew --dry-run"
