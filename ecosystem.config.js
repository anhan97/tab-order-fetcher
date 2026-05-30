// PM2 ecosystem config — checked in so `pm2 start ecosystem.config.js`
// from the repo root reproduces the production process layout exactly.
//
// Single source of truth for cwd, script entry, env, and restart policy.
// Avoids the "Missing script: start" loop that happens when PM2 is told
// to run `npm run start` from the repo root (root package.json has no
// such script — it lives in backend/package.json).
module.exports = {
  apps: [
    {
      name: 'tab-order-fetcher-backend',
      cwd: './backend',
      // Run npm directly so we keep using the existing backend/package.json
      // "start": "ts-node server.ts" entrypoint. ts-node lets us deploy
      // without a TypeScript build step on the server.
      script: 'npm',
      args: 'run start',
      // Single instance — the schedulers (PL recompute, FB metrics sync)
      // are not safe to run in parallel.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // Crash if memory climbs past 1 GB — usually means a runaway sync.
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
