/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useCallback } from 'react'
import { useUser } from './firebase/firebase-services'

/**
 * Posts a JSON body to a plugin's console API as the signed-in user, as a
 * FOLLOW-UP to something that has already happened: a figure recounted after
 * a delete, a mirror restamped after a switch (AGL-3330).
 *
 * Best effort, and it never throws: the act that prompted it has already
 * landed, so a follow-up that fails is logged and answered `false`, and the
 * caller carries on. Anything whose outcome the reader must see belongs on a
 * call that reports it, not here.
 *
 * @returns whether the route answered 2xx.
 */
export function usePluginApiPost(): (path: string, body: unknown) => Promise<boolean> {
  const { data: user } = useUser()
  return useCallback(
    async (path, body) => {
      try {
        const response = await authorizedFetch(user, path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!response.ok) console.error(`${path} answered ${response.status}`)
        return response.ok
      } catch (error) {
        console.error(`${path} failed`, error)
        return false
      }
    },
    [user],
  )
}

export default usePluginApiPost
