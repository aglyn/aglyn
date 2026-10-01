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

import {
  isStaleBuildError,
  recoverStaleBuildOrReport,
} from '@aglyn/aglyn/app-utils/stale-build-error'
import StatusScreenPlain from '@aglyn/shared-ui-jsx/components/status-screen-plain.component'
import { useEffect } from 'react'

/**
 * Last boundary of all (AGL-2074): a throw in the ROOT layout.
 *
 * `global-error` REPLACES the root layout, so it must render its own
 * `<html>` and `<body>` — and everything the root layout provides is gone
 * with it: no `AppRouterCacheProvider`, so no emotion, so no MUI styling,
 * and no `ErrorBeacon` component. Hence plain elements with inline styles,
 * and a direct `reportError` rather than a hand-off to a component that is not
 * mounted.
 *
 * A tab open across a deploy reaches it like any other boundary, since the
 * root layout asks for its chunks too, so it runs the same AGL-3279 recovery
 * as `error.tsx`: one reload per tab per half hour, and a **Reload** button
 * when that is spent (AGL-3423).
 *
 * In practice this should never render — the root layout does almost nothing.
 * It exists because the alternative when it DOES is Next's own crash page on
 * a customer's domain, which is the entire defect this issue is about, and a
 * boundary that only covers the likely cases leaves the platform's worst
 * moment as its least designed one.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const stale = isStaleBuildError(error)
  useEffect(() => {
    recoverStaleBuildOrReport(error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        {stale ? (
          <StatusScreenPlain
            code="Update"
            title={'This page is out of date'}
            message={
              'This tab was open while a new version shipped. Reload to pick it up.'
            }
            action={<ReloadButton />}
          />
        ) : (
          <StatusScreenPlain
            code="500"
            title={'Something went wrong'}
            message={
              'This site couldn’t be loaded. Please try again in a moment.'
            }
          />
        )}
      </body>
    </html>
  )
}

function ReloadButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      style={{
        padding: '0.6rem 1.1rem',
        borderRadius: '0.5rem',
        borderStyle: 'solid',
        borderWidth: '1px',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      Reload
    </button>
  )
}
