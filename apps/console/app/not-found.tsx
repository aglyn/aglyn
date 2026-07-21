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

import AuthenticatedLayout from '../components/layouts/authenticated.layout'
import MainLayout from '../components/layouts/main.layout'
import NotFoundContent from '../components/not-found-content.component'

/**
 * Global not-found boundary (AGL-625). This root `not-found.tsx` catches both
 * unmatched URLs (e.g. a retired `/[hostId]` bookmark after the AGL-621 move)
 * and explicit `notFound()` calls that bubble past the route groups. It adds
 * the console chrome itself, since the `(app)` group layout does not wrap the
 * root boundary. Authenticated so the app bar renders; the org switcher hides
 * itself when there is no current workspace.
 */
export default function NotFound() {
  return (
    <AuthenticatedLayout>
      <MainLayout>
        <NotFoundContent />
      </MainLayout>
    </AuthenticatedLayout>
  )
}
