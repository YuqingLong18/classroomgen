module.exports = {
  apps : [{
    name: "imagelab",
    script: "node_modules/next/dist/bin/next", // Points DIRECTLY to the binary
    args: "start",
    cwd: "/www/wwwroot/classroomgen",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "production",
      PORT: 3003  // <--- Forces the port here permanently
    }
  }]
};