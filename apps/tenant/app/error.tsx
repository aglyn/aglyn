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

import { redispatchCaughtError } from '@aglyn/aglyn/app-utils/redispatch-caught-error'
import {
  isStaleBuildError,
  shouldReloadForStaleBuild,
} from '@aglyn/aglyn/app-utils/stale-build-error'
import { PLATFORM_DEFAULT_LOCALE } from '@aglyn/aglyn/app-utils/seo-locale'
import { useEffect } from 'react'
import StatusScreenPlain from '@aglyn/shared-ui-jsx/components/status-screen-plain.component'
import DocumentShell from '../components/document-shell.component'

/**
 * Root error boundary (AGL-2074).
 *
 * The rung above `[host]/[scheme]/error.tsx`: it catches what that one structurally
 * cannot, which is a throw in `[host]/[scheme]/layout.tsx` itself — the host lookup,
 * the theme resolve, the font/favicon/manifest resolution. That is also
 * exactly the case in which no host data exists, so the plain screen is not a
 * shortcut here, it is the only honest option.
 *
 * It renders the document shell ITSELF (AGL-3153). An error boundary replaces
 * its segment's children, and the shell moved down to `[host]/layout.tsx` so
 * that `<html lang>` could be the site's own language — which is precisely the
 * layout a throw here has taken out of the tree. So this rung carries its own,
 * and `ErrorBeacon` is mounted exactly as it was when the root layout held it.
 *
 * The PLATFORM DEFAULT language, for the same reason the screen is plain:
 * there is no resolved host at this point, so there is no site whose language
 * could be named. `global-error.tsx` is the rung above again, for when even
 * this is gone.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  /*
   * A TAB OPEN ACROSS A DEPLOY (AGL-3279). The document names chunks the
   * origin no longer serves, so this is not a crash to report and **Try
   * again** cannot fix it — `reset()` re-renders the same tree, which asks
   * for the same missing file. One reload per tab per half hour puts the
   * visitor on the build that is actually deployed.
   */
  const stale = isStaleBuildError(error)
  useEffect(() => {
    if (shouldReloadForStaleBuild(error)) {
      window.location.reload()
      return
    }
    redispatchCaughtError(error)
  }, [error])

  return (
    <DocumentShell lang={PLATFORM_DEFAULT_LOCALE}>
      <StatusScreenPlain
        // Not a server error: the deploy is fine and this tab is behind it.
        code={stale ? 'Update' : '500'}
        // NAMES NOBODY: this boundary renders on a white-labeled site, so
        // the sentence is about the tab, not about whose software it is.
        title={stale ? 'This page is out of date' : 'Something went wrong'}
        message={
          stale
            ? 'This tab was open while a new version shipped. Reload to pick it up.'
            : 'This page didn’t load properly. Please try again.'
        }
        action={
          <button
            type="button"
            onClick={() => (stale ? window.location.reload() : reset())}
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
            {stale ? 'Reload' : 'Try again'}
          </button>
        }
      />
    </DocumentShell>
  )
}
