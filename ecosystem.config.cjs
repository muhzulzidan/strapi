module.exports = {
  apps: [
    {
      name: 'tasfrl-cms',
      cwd: '/srv/cms',
      script: 'npm',
      args: 'run start',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '1337',
      },
      out_file: '/srv/api/logs/pm2/tasfrl-cms-out.log',
      error_file: '/srv/api/logs/pm2/tasfrl-cms-error.log',
      merge_logs: true,
      time: true,
    },
  ],
}
