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

import {
  useHost as useHostDocument,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { useCallback } from 'react'
import { announceHostDocumentWrite } from '../utils/host-document-writes'

type HostDocumentHook = typeof useHostDocument
type HostDocumentResult = ReturnType<HostDocumentHook>
type HostSetDoc = HostDocumentResult['setDoc']

/**
 * The host document, as the console reads AND writes it (AGL-3386).
 *
 * The same listener and the same setter as the library's `useHost`, with one
 * difference: a write that lands and touches anything the published site
 * renders drops the site's cached pages, through
 * `announceHostDocumentWrite`. Settings have no publish step, so without it
 * a saved theme, favicon or SEO title waited out the page's hour-long cache.
 *
 * This is the console's only `useHost`. `host-document-writes-sweep.spec.ts`
 * refuses a console file that imports the library's hook directly, because
 * doing so gets a setter that saves silently.
 *
 * The setter resolves when the WRITE does, exactly as before. The drop runs
 * behind it and cannot reject, so no caller's success path or error path
 * moves.
 */
export function useHost(
  ...args: Parameters<HostDocumentHook>
): HostDocumentResult {
  const [data] = args
  const hostId = data.hostId
  const result = useHostDocument(...args)
  const { setDoc } = result
  const { data: user } = useUser()

  const announcingSetDoc = useCallback<HostSetDoc>(
    async (payload, options) => {
      await setDoc(payload, options)
      void announceHostDocumentWrite({ user, hostId, payload })
    },
    [setDoc, user, hostId],
  )

  return { ...result, setDoc: announcingSetDoc }
}

export default useHost
