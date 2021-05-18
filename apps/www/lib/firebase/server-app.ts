import * as _admin from 'firebase-admin'

export const app = _admin

export type FbUserRecord = _admin.auth.UserRecord

export const initializeServerApp = (): ReturnType<typeof app.initializeApp> => {
  return app.initializeApp({
    credential: app.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // https://stackoverflow.com/a/41044630/1332513
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  })
}

if (!app.apps.length) {
  initializeServerApp()
}

export const verifyIdToken = (idToken: string) => {
  return app.auth().verifyIdToken(idToken).catch((error) => {
    throw error
  })
}