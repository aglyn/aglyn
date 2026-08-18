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

import { useEffect } from 'react'
import PlainStatusScreen from '../components/plain-status-screen.component'

/**
 * Root error boundary (AGL-2074).
 *
 * The rung above `[host]/error.tsx`: it catches what that one structurally
 * cannot, which is a throw in `[host]/layout.tsx` itself — the host lookup,
 * the theme resolve, the font/favicon/manifest resolution. That is also
 * exactly the case in which no host data exists, so the plain screen is not a
 * shortcut here, it is the only honest option.
 *
 * The root layout still wraps this, so `ErrorBeacon` is mounted and the
 * document shell is intact. `global-error.tsx` is the rung above again, for
 * when even that is gone.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      ;(
        window as Window & { reportError?: (error: unknown) => void }
      ).reportError?.(error)
    } catch {
      // Reporting never breaks the page.
    }
  }, [error])

  return (
    <PlainStatusScreen
      code="500"
      title={'Something went wrong'}
      message={'This page didn’t load properly. Please try again.'}
      action={
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: '0.6rem 1.1rem',
            borderRadius: '0.5rem',
            border: '1px solid currentColor',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {'Try again'}
        </button>
      }
    />
  )
}
