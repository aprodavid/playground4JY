import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getEnv } from './env';

function init() {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }
  return initializeApp({
    credential: cert({
      projectId: getEnv('FIREBASE_PROJECT_ID'),
      clientEmail: getEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey: getEnv('FIREBASE_PRIVATE_KEY'),
    }),
  });
}

export const db = getFirestore(init());
