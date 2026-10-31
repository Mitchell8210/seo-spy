process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.HOST = "127.0.0.1";
process.env.PORT = "3001";
process.env.DEMO_STAGE_DELAY_MS = "100";
process.env.PAGESPEED_API_KEY = "";
process.env.PAGESPEED_TIMEOUT_MS = "120000";
// Automated suites cannot inherit real model credentials or opt into live AI.
process.env.MODEL_API_KEY = "";
process.env.AI_ENABLED = "false";
process.env.MOCK_AI = "true";
process.env.AI_MODE = "mock";
