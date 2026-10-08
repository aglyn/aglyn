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

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The kiosk's idle clock (AGL-3623). While `active`, every touch, click or
 * key restarts it; after `idleSeconds` of nothing it starts a visible
 * `warningSeconds` countdown ("Still there?"), and when that runs out it
 * calls `onExpire` — the page's reset, which clears the cart and anything
 * the customer typed. A touch during the countdown cancels it.
 */
export function useKioskIdle(options: {
  active: boolean
  idleSeconds: number
  warningSeconds: number
  onExpire: () => void
}): { warning: number | null; stillHere: () => void } {
  const { active, idleSeconds, warningSeconds } = options
  const [warning, setWarning] = useState<number | null>(null)
  const lastTouch = useRef(Date.now())
  const expire = useRef(options.onExpire)
  expire.current = options.onExpire

  const stillHere = useCallback(() => {
    lastTouch.current = Date.now()
    setWarning(null)
  }, [])

  useEffect(() => {
    if (!active) {
      setWarning(null)
      return undefined
    }
    lastTouch.current = Date.now()
    const touched = () => {
      lastTouch.current = Date.now()
      setWarning((current) => (current === null ? current : null))
    }
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const
    for (const event of events) window.addEventListener(event, touched, { passive: true })
    const timer = setInterval(() => {
      const idleFor = (Date.now() - lastTouch.current) / 1000
      if (idleFor < idleSeconds) return
      const left = Math.ceil(idleSeconds + warningSeconds - idleFor)
      if (left <= 0) {
        lastTouch.current = Date.now()
        setWarning(null)
        expire.current()
        return
      }
      setWarning(left)
    }, 1000)
    return () => {
      clearInterval(timer)
      for (const event of events) window.removeEventListener(event, touched)
    }
  }, [active, idleSeconds, warningSeconds])

  return { warning, stillHere }
}
