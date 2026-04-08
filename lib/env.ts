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

export function getPublicDataEnv() {
  return {
    baseUrl: getEnv('PUBLIC_DATA_BASE_URL'),
    serviceKey: getEnv('PUBLIC_DATA_SERVICE_KEY'),
  };
}

export function getFirebaseAdminEnv() {
  return {
    projectId: getEnv('FIREBASE_PROJECT_ID'),
    clientEmail: getEnv('FIREBASE_CLIENT_EMAIL'),
    privateKey: getEnv('FIREBASE_PRIVATE_KEY'),
  };
}

export function isMissingEnvError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith('Missing env: ');
}
