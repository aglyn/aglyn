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

import AuthenticatedLayout from './layouts/authenticated.layout'
import MainLayout from './layouts/main.layout'
import NotFoundContent from './not-found-content.component'

/**
 * The console chrome the ROOT not-found boundary wears (AGL-625), in its own
 * module so the boundary can reach it lazily (AGL-2706).
 *
 * `app/not-found.tsx` is a client entry of its own, so Turbopack builds it a
 * chunk group separate from the one the `(app)` layout is in. Composing this
 * chrome directly in the boundary put `AuthenticatedLayout` and `MainLayout`
 * — and their dependency stacks, `@popperjs/core`, `@simplewebauthn/browser`
 * and about 100 KB of `@mui/material` — into BOTH groups, as private copies
 * the page group already had.
 *
 * Every signed-in page mounts a not-found boundary whether or not anything is
 * missing, so that second copy was fetched on ordinary console pages, not on
 * 404s. Splitting it here lets `not-found.tsx` hold a module reference and
 * pull the chrome only when it actually renders.
 *
 * Nothing in `not-found.tsx` may import this statically: a static and a
 * dynamic import of one module resolve to one module, and the static one
 * wins. `not-found-chrome-stays-lazy.spec.ts` asserts that it does not.
 */
export function NotFoundChrome() {
  return (
    <AuthenticatedLayout>
      <MainLayout>
        <NotFoundContent />
      </MainLayout>
    </AuthenticatedLayout>
  )
}
NotFoundChrome.displayName = 'NotFoundChrome'

export default NotFoundChrome
