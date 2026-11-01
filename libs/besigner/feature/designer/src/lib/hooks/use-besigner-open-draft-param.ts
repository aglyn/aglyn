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
  BESIGNER_OPEN_DRAFT_PARAM,
  BESIGNER_OPEN_DRAFT_VALUE,
} from '@aglyn/aglyn/app-utils/version-draft'
import { useEffect, useState } from 'react'

/**
 * Whether the link that opened this editor asked for the saved draft
 * (AGL-4116). Read once, then taken off the address, so a reload is an
 * ordinary open rather than a second ask laid over what the author has done
 * since.
 */
export function useBesignerOpenDraftParam(): boolean {
  const [asked] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get(BESIGNER_OPEN_DRAFT_PARAM) ===
        BESIGNER_OPEN_DRAFT_VALUE,
  )
  useEffect(() => {
    if (!asked) return
    const url = new URL(window.location.href)
    url.searchParams.delete(BESIGNER_OPEN_DRAFT_PARAM)
    window.history.replaceState(window.history.state, '', url)
  }, [asked])
  return asked
}

export default useBesignerOpenDraftParam
