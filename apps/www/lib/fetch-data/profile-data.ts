/**
 * @license
 * Copyright 2021 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
