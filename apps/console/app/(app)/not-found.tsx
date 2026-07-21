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

import NotFoundContent from '../../components/not-found-content.component'

/**
 * Not-found boundary for the authenticated `(app)` group (AGL-625). A
 * `notFound()` from inside `(app)` (e.g. OrgGuard on an unknown org) renders
 * this INSTEAD of the root `not-found.tsx`, so the chrome comes only from the
 * `(app)` layout — the root boundary would add a second `MainLayout` and
 * double the app bar.
 */
export default function AppNotFound() {
  return <NotFoundContent />
}
