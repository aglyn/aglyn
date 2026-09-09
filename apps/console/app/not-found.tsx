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

import { Suspense, lazy } from 'react'

/**
 * The chrome is behind a lazy boundary, and nothing here may import it
 * statically (AGL-2706).
 *
 * This file is a client entry of its own, so Turbopack gives it a chunk group
 * separate from the `(app)` layout's. Composing the chrome here put
 * `AuthenticatedLayout` and `MainLayout` in both, as private copies of what
 * the page group already carries — and a not-found boundary is mounted into
 * every successful response, so the copy was fetched on ordinary console
 * pages rather than on 404s.
 *
 * `(app)/not-found.tsx` is what a `notFound()` from inside the group renders,
 * so this boundary is reached only by URLs that match no route at all. Paying
 * a chunk fetch on that arrival, and nothing on every other page, is the right
 * way round.
 */
const NotFoundChrome = lazy(
  () => import('../components/not-found-chrome.component'),
)

/**
 * Global not-found boundary (AGL-625). This root `not-found.tsx` catches both
 * unmatched URLs (e.g. a retired `/[hostId]` bookmark after the AGL-621 move)
 * and explicit `notFound()` calls that bubble past the route groups. It adds
 * the console chrome itself, since the `(app)` group layout does not wrap the
 * root boundary. Authenticated so the app bar renders; the org switcher hides
 * itself when there is no current workspace.
 */
export default function NotFound() {
  // `null` rather than a spinner: `AuthenticatedLayout` opens on its own
  // splash while auth resolves, so a fallback here would be a second loading
  // state in front of that one.
  return (
    <Suspense fallback={null}>
      <NotFoundChrome />
    </Suspense>
  )
}
