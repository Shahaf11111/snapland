import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  AREAS_QUERY_LIMIT: z.coerce.number().int().min(1).max(20000).default(1000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 chars"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 chars"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 30),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  RATE_LIMIT_MAX_PER_MINUTE: z.coerce.number().int().positive().default(50),
  WS_PREVIEW_MAX_PER_SECOND: z.coerce.number().int().positive().default(20),
  WS_BACKPRESSURE_SOFT_BYTES: z.coerce.number().int().positive().default(64 * 1024),
  WS_BACKPRESSURE_HARD_BYTES: z.coerce.number().int().positive().default(1024 * 1024),
});

export type EnvConfig = z.infer<typeof envSchema>;

/** Passed as `ConfigModule.forRoot({ validate })` — runs once at boot, so a
 *  misconfigured environment fails fast instead of surfacing as a runtime
 *  error on the first request that needs it. */
export function validate(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`
    );
  }
  return parsed.data;
}
