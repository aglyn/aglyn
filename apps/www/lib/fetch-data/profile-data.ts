import * as firebaseAdmin from 'firebase-admin'
import serverApp from '../firebase/fb-admin'


export const getProfileData = async (username) => {
  const db = serverApp.firestore()
  const profileCollection = db.collection('profile')
  const profileDoc = await profileCollection.doc(username).get()

  if (!profileDoc.exists) {
    return null
  }

  return profileDoc.data()
}

export const verifyIdToken = (idToken: string) => {
  return firebaseAdmin.auth().verifyIdToken(idToken).catch((error) => {
    throw error
  })
}
