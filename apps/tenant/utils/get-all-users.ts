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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'

export async function getAllUsers(nextPageToken?: string) {
  const data: { users: object[]; nextPageToken: string | null; error: Error | null } = { users: [], nextPageToken: null, error: null }

  // List batch of users, 1000 at a time.
  await firebaseAdmin
    .app()
    .auth()
    .listUsers(1000, nextPageToken)
    .then((listUsersResult) => {
      listUsersResult.users.forEach((userRecord) => {
        data.users.push(userRecord.toJSON())
      })
      if (listUsersResult.pageToken) {
        data.nextPageToken = listUsersResult.pageToken
      }
    })
    .catch((error) => {
      console.error('Error listing users:', error)
      data.error = error
    })

  return data
}
export default getAllUsers
