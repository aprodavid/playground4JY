const required = [
  'PUBLIC_DATA_SERVICE_KEY',
  'PUBLIC_DATA_BASE_URL',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
] as const;

export function getEnv(name: (typeof required)[number]): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return name === 'FIREBASE_PRIVATE_KEY' ? value.replace(/\\n/g, '\n') : value;
}

export function validateEnv(): void {
  required.forEach((key) => {
    if (!process.env[key]) {
      throw new Error(`Missing env: ${key}`);
    }
  });
}
