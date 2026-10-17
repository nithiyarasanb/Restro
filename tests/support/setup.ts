import "@testing-library/jest-dom/vitest";

// Deterministic test environment (never real secrets).
process.env.DATA_SOURCE ??= "memory";
process.env.APP_SECRET ??= "test-app-secret-test-app-secret-1234567890";
process.env.PAYMENT_WEBHOOK_SECRET ??= "test-webhook-secret-123456";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.PAYMENT_PROVIDER ??= "mock";

// Keep request logs out of test output.
const info = console.info;
console.info = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes('"msg":"request"')) return;
  info(...args);
};
