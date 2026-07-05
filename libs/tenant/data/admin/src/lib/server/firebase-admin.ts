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
// Initializes the firebase-admin default app (cert credential, RTDB URL,
// service account, AppCheck) on module load.
import '@aglyn/shared-util-fbserver'
import { decode, encode } from '@msgpack/msgpack'
import * as firebaseAdmin from 'firebase-admin'

function compress(value: any) {
  return Buffer.from(encode(value))
}
function decompress(value: any) {
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
        // Nodes saved while updateDoc bypassed the client converter are plain
        // maps rather than compressed bytes; decode only binary payloads.
        data.nodes = ArrayBuffer.isView(data.nodes)
          ? decompress(data.nodes)
          : data.nodes
      }
      data.$id = snapshot.id
      return data as Aglyn.AglynScreenVersion
    },
  }

export { firebaseAdmin }
export default firebaseAdmin
