module.exports = {
  apps: [{
    name: 'todo',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    env: {
      NODE_ENV: 'production',
      PORT: 3002,
      FORCE_HTTPS: '1'
    }
  }]
};
