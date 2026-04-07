export interface EnvRequirement {
  name: string;
  required: boolean;
  description: string;
}

export function validateEnv(requirements: EnvRequirement[]): void {
  const missing: string[] = [];
  for (const req of requirements) {
    if (req.required && !process.env[req.name]) {
      missing.push(`  ${req.name} — ${req.description}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.join('\n')}\n\nSet these in your .env file or Railway dashboard.`
    );
  }
}
