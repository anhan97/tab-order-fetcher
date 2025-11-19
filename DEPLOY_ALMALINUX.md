# Deployment Guide for AlmaLinux 8.9 VPS

This guide will help you deploy your Shopify App (Tab Order Fetcher) to a Contabo VPS running AlmaLinux 8.9.

## Prerequisites

1.  **VPS Access**: You need the IP address and root password of your VPS.
2.  **Domain Name**: You should have a domain name pointing to your VPS IP address (e.g., `app.yourdomain.com`).
3.  **Shopify App Credentials**: Client ID, Client Secret, etc.

## Step 1: Initial Server Setup

Connect to your VPS via SSH:
```bash
ssh root@<your_vps_ip>
```

Update the system:
```bash
dnf update -y
```

## Step 2: Install Dependencies

We will use a script to install Node.js, PostgreSQL, Nginx, and PM2.

Create a file named `setup_almalinux.sh` on your server:
```bash
nano setup_almalinux.sh
```

Paste the content of the `setup_almalinux.sh` script (provided below) into this file.

Make it executable and run it:
```bash
chmod +x setup_almalinux.sh
./setup_almalinux.sh
```

## Step 3: Configure Database

The script installs PostgreSQL. You need to create a database and user.

Initialize PostgreSQL (if not already done):
```bash
postgresql-setup --initdb
systemctl enable postgresql
systemctl start postgresql
```

Create database and user:
```bash
sudo -u postgres psql
```

Inside the SQL prompt:
```sql
CREATE DATABASE tab_order_fetcher;
CREATE USER app_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE tab_order_fetcher TO app_user;
\q
```

## Step 4: Deploy Code

You can transfer your code using `scp` or `git`. Assuming you use `git`:

1.  Generate an SSH key on VPS (if using private repo): `ssh-keygen -t ed25519` and add to GitHub.
2.  Clone your repository:
    ```bash
    git clone <your_repo_url> /var/www/tab-order-fetcher
    cd /var/www/tab-order-fetcher
    ```

## Step 5: Configure Environment Variables

Create `.env` file in `backend` directory:
```bash
cd /var/www/tab-order-fetcher/backend
cp .env.example .env
nano .env
```

Update the `.env` file with your production values:
- `DATABASE_URL="postgresql://app_user:your_secure_password@localhost:5432/tab_order_fetcher?schema=public"`
- `PORT=3001`
- `FRONTEND_URL=https://app.yourdomain.com`
- Shopify Credentials

Create `.env` file in `frontend` (root) directory:
```bash
cd /var/www/tab-order-fetcher
nano .env
```
- `VITE_API_URL=https://app.yourdomain.com/api`

## Step 6: Build and Start

**Backend:**
```bash
cd /var/www/tab-order-fetcher/backend
npm install
npx prisma migrate deploy
npm run build
pm2 start dist/server.js --name "backend"
```

**Frontend:**
```bash
cd /var/www/tab-order-fetcher
npm install
npm run build
```

## Step 7: Configure Nginx

Create an Nginx config file:
```bash
nano /etc/nginx/conf.d/tab-order-fetcher.conf
```

Paste the following (replace `app.yourdomain.com` with your domain):

```nginx
server {
    listen 80;
    server_name app.yourdomain.com;

    root /var/www/tab-order-fetcher/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable and start Nginx:
```bash
systemctl enable nginx
systemctl start nginx
```

Test configuration:
```bash
nginx -t
systemctl restart nginx
```

## Step 8: Configure Firewall

AlmaLinux uses firewalld by default:
```bash
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
```

## Step 9: SSL (HTTPS)

Install Certbot:
```bash
dnf install epel-release -y
dnf install certbot python3-certbot-nginx -y
certbot --nginx -d app.yourdomain.com
```

## Step 10: Finalize

Save PM2 list to restart on reboot:
```bash
pm2 save
pm2 startup
```

Your app should now be live at `https://app.yourdomain.com`!

## Troubleshooting

### SELinux Issues
If you encounter permission issues, you may need to configure SELinux:
```bash
# Check SELinux status
getenforce

# If enforcing, you may need to allow nginx to connect to network
setsebool -P httpd_can_network_connect 1
```

### PostgreSQL Connection Issues
Ensure PostgreSQL is configured to accept local connections:
```bash
nano /var/lib/pgsql/data/pg_hba.conf
```

Add or modify:
```
local   all             all                                     md5
host    all             all             127.0.0.1/32            md5
```

Then restart PostgreSQL:
```bash
systemctl restart postgresql
```
