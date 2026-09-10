function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: process.env.PORT ?? "4000",
  isProduction: process.env.NODE_ENV === "production",
  clientUrl: requireEnv("CLIENT_URL"),
  clientId: requireEnv("CLIENT_ID"),
  clientSecret: requireEnv("CLIENT_SECRET"),
  redirectUri: requireEnv("REDIRECT_URI"),
  sfLoginUrl: requireEnv("SF_LOGIN_URL"),
  sessionSecret: requireEnv("SESSION_SECRET"),
  // Optional for now so existing CRUD functionality keeps working without a
  // key. The agent route (Task 3+) checks for it and returns a clear error
  // if it's missing. Can be promoted to requireEnv once the agent is core.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
};
