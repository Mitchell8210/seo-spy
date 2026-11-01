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
// Each test app gets an isolated DB unless a test selects a durable temp path.
process.env.DATABASE_PATH = ":memory:";
// Offline tests must never load the configured Google service-account file.
process.env.GOOGLE_APPLICATION_CREDENTIALS = "";
process.env.GA4_PROPERTY_ID = "";
process.env.GSC_SITE_URL = "";
process.env.GOOGLE_BUSINESS_ID = "";
