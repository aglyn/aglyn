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

import { ATTRIBUTION_ATTRIBUTE } from '@aglyn/aglyn/app-utils/attribution-attribute'
import { useEffect } from 'react'

export interface AttributionGuardProps {
  hostId?: string
}

/**
 * Mounts the attribution guard. Renders nothing.
 *
 * From an effect rather than module scope — the opposite of the error beacon
 * beside it, and for the opposite reason. That one exists to catch failures
 * during boot, so it has to be armed before boot. This one measures whether
 * elements are PRESENTED, which is a question with no answer until the
 * document has been laid out; asking it at module scope would ask it of a
 * page that does not exist yet.
 *
 * ## Why the guard itself arrives late, and the templates do not
 *
 * The renderer mounts this only where there is something to guard — the
 * credit badge and the report control both hang off `showBranding` — but a
 * STATIC import ships the guard's code to every site regardless, paid ones
 * included, because a module's bytes are decided by the import graph and not
 * by whether the component renders (AGL-2706).
 *
 * So the installer is reached through `import()` and the sites that never
 * show attribution never fetch it. What does NOT wait for that chunk is the
 * capture below: the repair rebuilds a suppressed element from a copy of the
 * original, and by the time one is missing there is nothing left to clone.
 * Taking the copies here, synchronously, keeps the window in which a removal
 * can go unrecorded exactly as wide as it was when the whole guard was
 * eager — a chunk fetch is a fine moment to CHECK an element, and a bad one
 * to first look for it.
 */
export default function AttributionGuard(props: AttributionGuardProps): null {
  const { hostId } = props
  useEffect(() => {
    let shipped: Map<string, Element>
    try {
      shipped = new Map()
      for (const element of Array.from(
        document.querySelectorAll(`[${ATTRIBUTION_ATTRIBUTE}]`),
      )) {
        const subject = element.getAttribute(ATTRIBUTION_ATTRIBUTE) ?? ''
        if (!subject || shipped.has(subject)) continue
        shipped.set(subject, element.cloneNode(true) as Element)
      }
    } catch {
      // A document that cannot be queried is one nothing can be guarded on.
      return
    }
    if (!shipped.size) return
    void import('@aglyn/aglyn/app-utils/attribution-guard')
      .then(({ installAttributionGuard }) => {
        installAttributionGuard({ hostId, shipped })
      })
      // A guard that throws is worse than a guard that misses one page.
      .catch((): void => undefined)
  }, [hostId])
  return null
}
