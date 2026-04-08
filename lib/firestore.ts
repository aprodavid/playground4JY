import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdminEnv } from './env';

function init() {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }
  const env = getFirebaseAdminEnv();
  return initializeApp({
    credential: cert({
      projectId: env.projectId,
      clientEmail: env.clientEmail,
      privateKey: env.privateKey,
    }),
  });
}

export function getFirestoreAdmin() {
  return getFirestore(init());
}
