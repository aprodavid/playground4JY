import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { initializeFirestore, type Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminEnv } from './env';

let firestoreInstance: Firestore | null = null;

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
  if (firestoreInstance) {
    return firestoreInstance;
  }
  const app = init();
  firestoreInstance = initializeFirestore(app);
  return firestoreInstance;
}
