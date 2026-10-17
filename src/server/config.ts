import "server-only";
import { z } from "zod";

// Environment is validated once at startup (DG §10 "Environment validation").

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATA_SOURCE: z.enum(["memory", "postgres"], {
      message: "DATA_SOURCE must be set to 'memory' (demo data) or 'postgres'",
    }),
    ALLOW_DEMO_MODE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    DATABASE_URL: z.string().optional(),
    APP_BASE_URL: z.url().default("http://localhost:3000"),
    PAYMENT_PROVIDER: z.enum(["mock"]).default("mock"),
    PAYMENT_WEBHOOK_SECRET: z.string().min(16, "PAYMENT_WEBHOOK_SECRET must be at least 16 characters"),
    APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters (used to sign order tracking tokens)"),
    SESSION_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
    UPLOAD_DIR: z.string().default(".data/uploads"),
    /** Failed-or-not sign-in attempts allowed per email+client per 15 minutes (×5 per client). */
    /** Scales every per-route API rate limit (e.g. 100 for a single-machine load test). */
    API_RATE_LIMIT_MULTIPLIER: z.coerce.number().min(0.1).max(10_000).default(1),
    LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(8),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.DATA_SOURCE === "postgres" && !env.DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "DATABASE_URL is required when DATA_SOURCE=postgres" });
    }
    if (env.NODE_ENV === "production" && env.DATA_SOURCE === "memory" && !env.ALLOW_DEMO_MODE) {
      ctx.addIssue({
        code: "custom",
        path: ["DATA_SOURCE"],
        message: "Refusing to run production with in-memory demo data. Use DATA_SOURCE=postgres (or ALLOW_DEMO_MODE=true for a throwaway preview).",
      });
    }
    if (env.NODE_ENV === "production" && env.PAYMENT_PROVIDER === "mock" && !env.ALLOW_DEMO_MODE) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER"],
        message: "The mock payment provider is test-only and cannot run in production.",
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema> & { isDemo: boolean; cookieSecure: boolean };

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  }
  const env = parsed.data;
  cached = {
    ...env,
    isDemo: env.DATA_SOURCE === "memory",
    cookieSecure: env.SESSION_COOKIE_SECURE ? env.SESSION_COOKIE_SECURE === "true" : env.NODE_ENV === "production",
  };
  return cached;
}

/** Test helper: force re-reading the environment. */
export function resetConfigForTests(): void {
  cached = null;
}
