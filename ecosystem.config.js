module.exports = {
  apps: [{
    name: 'talori',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_restarts: 20,
    restart_delay: 3000,
    max_memory_restart: '500M',
    env: { NODE_ENV: 'production' },
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
    time: true,
  }],
};
