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
};
