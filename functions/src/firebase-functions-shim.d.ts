declare module 'firebase-functions/params' {
  export function defineSecret(name: string): { value: () => string };
  export function defineString(name: string): { value: () => string };
}

declare module 'firebase-functions/v2/scheduler' {
  export function onSchedule(config: unknown, handler: any): unknown;
}

declare module 'firebase-functions/v2/https' {
  export function onRequest(config: unknown, handler: any): unknown;
}

declare module 'firebase-functions/v2/firestore' {
  export function onDocumentCreated(config: unknown, handler: any): unknown;
}
