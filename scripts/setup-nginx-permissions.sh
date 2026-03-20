#!/bin/bash

###############################################################################
# Setup Nginx Permissions for Custom Domain Feature
# This script configures your EC2 user to manage Nginx and Certbot
###############################################################################

echo "=== Custom Domain Setup - Nginx Permissions ==="
echo ""

# Step 1: Detect current user
CURRENT_USER=$(whoami)
echo "✓ Detected user: $CURRENT_USER"
echo ""

# Step 2: Ask for confirmation
read -p "Is this the user that runs your Node.js backend? (y/n): " confirm
if [ "$confirm" != "y" ]; then
    echo ""
    echo "Please run this script as the user that runs Node.js"
    echo "Example: sudo -u ubuntu bash setup-nginx-permissions.sh"
    exit 1
fi

echo ""
echo "=== Step 1: Creating custom domains directory ==="
sudo mkdir -p /etc/nginx/sites-available/custom-domains
sudo mkdir -p /etc/nginx/sites-enabled/custom-domains
sudo chown -R $CURRENT_USER:www-data /etc/nginx/sites-available/custom-domains
sudo chown -R $CURRENT_USER:www-data /etc/nginx/sites-enabled/custom-domains
sudo chmod 755 /etc/nginx/sites-available/custom-domains
sudo chmod 755 /etc/nginx/sites-enabled/custom-domains
echo "✓ Created /etc/nginx/sites-available/custom-domains"
echo "✓ Created /etc/nginx/sites-enabled/custom-domains"

echo ""
echo "=== Step 2: Configuring sudo permissions ==="
SUDOERS_FILE="/etc/sudoers.d/custom-domains-$CURRENT_USER"
echo "Creating $SUDOERS_FILE"

sudo tee $SUDOERS_FILE > /dev/null << EOF
# Allow $CURRENT_USER to manage Nginx and Certbot for custom domains
# Created by custom domain setup script

# Nginx reload (no password required)
$CURRENT_USER ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t
$CURRENT_USER ALL=(ALL) NOPASSWD: /usr/sbin/nginx -s reload
$CURRENT_USER ALL=(ALL) NOPASSWD: /bin/systemctl reload nginx
$CURRENT_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart nginx

# Certbot commands (no password required)
$CURRENT_USER ALL=(ALL) NOPASSWD: /usr/bin/certbot certonly *
$CURRENT_USER ALL=(ALL) NOPASSWD: /usr/bin/certbot renew
$CURRENT_USER ALL=(ALL) NOPASSWD: /usr/bin/certbot delete *
$CURRENT_USER ALL=(ALL) NOPASSWD: /usr/bin/certbot certificates

# File operations for custom domain configs
$CURRENT_USER ALL=(ALL) NOPASSWD: /bin/ln -s /etc/nginx/sites-available/custom-domains/* /etc/nginx/sites-enabled/custom-domains/
$CURRENT_USER ALL=(ALL) NOPASSWD: /bin/rm /etc/nginx/sites-enabled/custom-domains/*
EOF

sudo chmod 440 $SUDOERS_FILE
echo "✓ Created sudoers file with NOPASSWD permissions"

echo ""
echo "=== Step 3: Validating sudoers configuration ==="
if sudo visudo -c -f $SUDOERS_FILE; then
    echo "✓ Sudoers file syntax is valid"
else
    echo "✗ ERROR: Sudoers file has syntax errors!"
    sudo rm $SUDOERS_FILE
    exit 1
fi

echo ""
echo "=== Step 4: Testing permissions ==="
echo "Testing Nginx reload..."
if sudo nginx -t; then
    echo "✓ Nginx test passed"
else
    echo "✗ Nginx configuration has errors - please fix before continuing"
    exit 1
fi

echo ""
echo "=== Step 5: Update Nginx main configuration ==="
NGINX_CONF="/etc/nginx/nginx.conf"
if ! grep -q "include /etc/nginx/sites-enabled/custom-domains/\*;" $NGINX_CONF; then
    echo "Adding custom-domains include to nginx.conf..."
    sudo sed -i '/include \/etc\/nginx\/sites-enabled\/\*/a\    include /etc/nginx/sites-enabled/custom-domains/*;' $NGINX_CONF
    echo "✓ Updated nginx.conf to include custom-domains"
else
    echo "✓ nginx.conf already includes custom-domains"
fi

echo ""
echo "=== Step 6: Reload Nginx ==="
if sudo systemctl reload nginx; then
    echo "✓ Nginx reloaded successfully"
else
    echo "✗ Failed to reload Nginx"
    exit 1
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  ✅ Custom Domain Nginx Permissions Setup Complete!       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "User: $CURRENT_USER"
echo ""
echo "Next Steps:"
echo "1. Add environment variables to your backend .env:"
echo "   NGINX_CUSTOM_DOMAINS_DIR=/etc/nginx/sites-available/custom-domains"
echo "   NGINX_SITES_ENABLED=/etc/nginx/sites-enabled/custom-domains"
echo "   CERTBOT_EMAIL=admin@faddy.site"
echo "   BASE_DOMAIN=faddy.site"
echo ""
echo "2. Test the permissions:"
echo "   sudo nginx -t"
echo "   sudo systemctl reload nginx"
echo ""
echo "3. Deploy your backend with custom domain feature"
echo ""
echo "4. Test adding a custom domain from the admin panel"
echo ""
