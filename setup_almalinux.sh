#!/bin/bash

# Setup script for Tab Order Fetcher on AlmaLinux 8.9

# Exit on error
set -e

echo "Starting AlmaLinux VPS setup..."

# 1. Clean up problematic repositories
echo "Cleaning up repositories..."
# Disable MariaDB repo if it exists and is causing issues
if [ -f /etc/yum.repos.d/mariadb.repo ]; then
    echo "Disabling MariaDB repository..."
    sudo dnf config-manager --disable mariadb 2>/dev/null || true
fi

# Clean cache
sudo dnf clean all

# 2. Update System
echo "Updating system packages..."
sudo dnf update -y

# 2. Install EPEL repository
echo "Installing EPEL repository..."
sudo dnf install epel-release -y

# 3. Install Node.js (v20)
echo "Installing Node.js..."
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# 4. Install PostgreSQL 13
echo "Installing PostgreSQL..."
sudo dnf install -y postgresql-server postgresql-contrib

# 5. Install Nginx
echo "Installing Nginx..."
sudo dnf install -y nginx

# 6. Install PM2
echo "Installing PM2..."
sudo npm install -g pm2

# 7. Install Certbot
echo "Installing Certbot..."
sudo dnf install -y certbot python3-certbot-nginx

# 8. Install Git
echo "Installing Git..."
sudo dnf install -y git

# 9. Configure firewall
echo "Configuring firewall..."
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --reload

echo "----------------------------------------------------------------"
echo "Setup complete!"
echo "Next steps:"
echo "1. Initialize PostgreSQL: postgresql-setup --initdb && systemctl enable postgresql && systemctl start postgresql"
echo "2. Configure PostgreSQL database and user."
echo "3. Clone your repository to /var/www/tab-order-fetcher."
echo "4. Configure .env files."
echo "5. Build and start the application."
echo "----------------------------------------------------------------"
