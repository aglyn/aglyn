import { app } from '../firebase/server-app'

export const getProfileData = async (username) => {
  const db = app.firestore()
  const profileCollection = db.collection('profile')
  const profileDoc = await profileCollection.doc(username).get()

  if (!profileDoc.exists) {
    return null
  }

  return profileDoc.data()
}