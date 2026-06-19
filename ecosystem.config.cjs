// PM2 config for the AI Scoring Tool (resume-matcher-pro).
// The Express backend serves BOTH the /api/* routes and the built React
// frontend (client/dist), so a single process covers frontend + backend.
// Served behind Caddy under https://mrr-process-tracker.joulestowatts.com/j2w-ai-scoring-agent
module.exports = {
  apps: [
    {
      name: "ai-scoring-agent",
      cwd: "/home/ubuntu/ai-scoring-tool",
      script: "server/index.js",
      // node:sqlite is behind a flag on Node 24.
      interpreter: "node",
      interpreter_args: "--experimental-sqlite",
      env: {
        PORT: "3001",
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 10,
      time: true,
    },
  ],
};
