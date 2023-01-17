/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import * as Aglyn from '@aglyn/aglyn'
import { decode, encode } from '@msgpack/msgpack'
import * as firebaseAdmin from 'firebase-admin'

function compress(value) {
  return Buffer.from(encode(value))
}
function decompress(value) {
  return decode(value)
}

export const hostConverter: firebaseAdmin.firestore.FirestoreDataConverter<Aglyn.AglynHost> =
  {
    toFirestore(data) {
      if (data.$id) delete data.$id
      // data.updatedAt = firebaseAdmin.firestore.Timestamp.now()
      return data
    },
    fromFirestore(snapshot) {
      if (!snapshot.exists) return undefined
      const data = snapshot.data()
      data.$id = snapshot.id
      return data as Aglyn.AglynScreen
    },
  }

export const screenConverter: firebaseAdmin.firestore.FirestoreDataConverter<Aglyn.AglynScreen> =
  {
    toFirestore(data) {
      if (data.$id) delete data.$id
      data.updatedAt = firebaseAdmin.firestore.Timestamp.now()
      return data
    },
    fromFirestore(snapshot) {
      if (!snapshot.exists) return undefined
      const data = snapshot.data()
      data.$id = snapshot.id
      return data as Aglyn.AglynScreen
    },
  }

export const screenVersionConverter: firebaseAdmin.firestore.FirestoreDataConverter<Aglyn.AglynScreenVersion> =
  {
    toFirestore(data) {
      if (data.elements) {
        data.nodes = data.elements
        delete data.elements
      }
      if (data['bundleId']) {
        data.pluginId = data['bundleId']
        delete data['bundleId']
      }
      if (data.nodes) data.nodes = compress(data.nodes) as any
      if (data.$id) delete data.$id
      data.updatedAt = firebaseAdmin.firestore.Timestamp.now()
      return data
    },
    fromFirestore(snapshot) {
      if (!snapshot.exists) return undefined
      const data = snapshot.data()
      if (data?.elements) {
        data.nodes = data.elements
        delete data.elements
      }
      if (data?.['bundleId']) {
        data.pluginId = data['bundleId']
        delete data['bundleId']
      }
      if (data?.nodes) {
        data.nodes = decompress(data.nodes)
      }
      data.$id = snapshot.id
      return data as Aglyn.AglynScreenVersion
    },
  }

/**
 * default module loading invokes
 */

if (!firebaseAdmin.apps.length) {
  const app = firebaseAdmin.initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    serviceAccountId: process.env.FIREBASE_CLIENT_EMAIL,
    credential: firebaseAdmin.credential.cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // https://stackoverflow.com/a/41044630/1332513
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  })
  // reCAPTCHA v3
  const appCheck = firebaseAdmin.appCheck(app)
}

export { firebaseAdmin }
export default firebaseAdmin
