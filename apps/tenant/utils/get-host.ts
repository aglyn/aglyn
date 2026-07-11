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

import * as Aglyn from '@aglyn/aglyn/server'
import { firebaseAdmin, hostConverter } from '@aglyn/tenant-data-admin'

/**
 * Custom-domain sentinel (AGL-166): the middleware rewrites unrecognized
 * hostnames to `cname--{hostname}` because the edge runtime can't query
 * Firestore; this resolver maps them back via `host.cname`.
 */
export const CNAME_HOST_PREFIX = 'cname--'

export async function getHost(options: { host: Aglyn.HostUid }) {
  const { host } = options
  const data = {
    host: undefined as Aglyn.AglynHost,
    nextPageToken: '',
    error: null,
  }
  const firestore = firebaseAdmin.app().firestore()

  const byCname = host.startsWith(CNAME_HOST_PREFIX)
  const query = byCname
    ? firestore
        .collection('hosts')
        .where('cname', '==', host.slice(CNAME_HOST_PREFIX.length))
    : firestore.collection('hosts').where('subdomain', '==', host)

  await query
    .withConverter(hostConverter)
    .limit(2)
    .get()
    .then((res) => {
      if (res.size) data.host = res.docs[0].data() as Aglyn.AglynHost
      // Connect-time uniqueness should prevent this; log if it slips.
      if (byCname && res.size > 1) {
        console.error('Ambiguous cname resolution', host)
      }
    })
    .catch((error) => {
      console.error(error)
      data.error = error
    })

  return data
}

export default getHost
