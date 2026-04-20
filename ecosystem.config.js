/**
 * PM2 Ecosystem Config — AutoHisob
 *
 * Usage:
 *   npm install -g pm2
 *   cd /var/www/Avtohisob/backend && npm run build
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save && pm2 startup
 */

module.exports = {
  apps: [
    {
      name: 'avtohisob-backend',
      script: './backend/dist/server.js',
      cwd: '/var/www/Avtohisob',
      instances: 'max',         // Use all CPU cores
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },

      // Logging
      out_file: '/var/log/avtohisob/backend-out.log',
      error_file: '/var/log/avtohisob/backend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Auto-restart
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Source maps for stack traces
      source_map_support: true,
    },
  ],

  deploy: {
    production: {
      user: 'deploy',
      host: process.env.DEPLOY_HOST || 'avtohisob.uz',
      ref: 'origin/main',
      repo: 'git@github.com:your-org/avtohisob.git',
      path: '/var/www/Avtohisob',
      'pre-deploy-local': '',
      'post-deploy': [
        'cd backend && npm ci --omit=dev',
        'cd backend && npx prisma migrate deploy',
        'cd backend && npm run build',
        'pm2 reload ecosystem.config.js --env production',
        'pm2 save',
      ].join(' && '),
      'pre-setup': 'apt-get install -y git',
    },
  },
}
