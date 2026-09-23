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

'use client'

import { readPlatformConsent } from '@aglyn/aglyn/app-utils/platform-visitor-consent'
import { VISITOR_CONSENT_CHANGED_EVENT } from '@aglyn/aglyn/app-utils/visitor-consent'
import { setPageFirstTouchStorage } from '@aglyn/shared-util-first-touch/first-touch-page'
import { useEffect } from 'react'

/**
 * The console's consent, forwarded to the first-touch capture (AGL-3289).
 *
 * The root layout includes the capture as a script marked pending, so it
 * holds the visit in memory until this says otherwise: the visitor's recorded
 * answer when there is one — granted or refused — and still pending when
 * there is none yet, because an undecided visitor has not said no. It
 * re-forwards on every consent change, so an accept writes the record on this
 * pageview and a withdrawal erases it on this pageview. Renders nothing.
 */
export default function FirstTouchConsentBridge(): null {
  useEffect(() => {
    const forward = () => {
      const stored = readPlatformConsent()
      setPageFirstTouchStorage(stored ? stored.analytics : null)
    }
    forward()
    window.addEventListener(VISITOR_CONSENT_CHANGED_EVENT, forward)
    return () => window.removeEventListener(VISITOR_CONSENT_CHANGED_EVENT, forward)
  }, [])
  return null
}
