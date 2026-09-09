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
 * The body of the console's global 404 (AGL-625), in a module of its own.
 *
 * Split out so `app/not-found.tsx` can reach it through `next/dynamic`
 * (AGL-2706). A root `not-found.tsx` is a client reference in every
 * successful response, and Turbopack gives that boundary its own chunk group
 * — so composing the console chrome here emitted a SECOND copy of the app
 * bar, the avatar, the org switcher, the report-issue and create-org dialogs
 * and their MUI parts on every console route, for a screen that draws only on
 * an unmatched URL.
 *
 * The chrome is composed here rather than by the `(app)` group layout because
 * the root boundary renders outside that group and would otherwise have no
 * app bar at all. `(app)/not-found.tsx` is the sibling for a `notFound()`
 * raised INSIDE the group, where the group layout already supplies the chrome.
 */
export default function RootNotFound() {
  return (
    <AuthenticatedLayout>
      <MainLayout>
        <NotFoundContent />
      </MainLayout>
    </AuthenticatedLayout>
  )
}
