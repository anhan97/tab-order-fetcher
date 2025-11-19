#!/bin/bash

# Setup script for Tab Order Fetcher on Ubuntu VPS

# Exit on error
set -e

echo "Starting VPS setup..."

# 1. Update System
echo "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js (v20)
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install PostgreSQL
echo "Installing PostgreSQL..."
sudo apt install -y postgresql postgresql-contrib

# 4. Install Nginx
echo "Installing Nginx..."
sudo apt install -y nginx

# 5. Install PM2
echo "Installing PM2..."
sudo npm install -g pm2

# 6. Install Certbot
echo "Installing Certbot..."
sudo apt install -y certbot python3-certbot-nginx

# 7. Install Git
echo "Installing Git..."
sudo apt install -y git

echo "----------------------------------------------------------------"
echo "Setup complete!"
echo "Next steps:"
echo "1. Configure PostgreSQL database and user."
echo "2. Clone your repository to /var/www/tab-order-fetcher."
echo "3. Configure .env files."
echo "4. Build and start the application."
echo "----------------------------------------------------------------"
