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

import dynamic from 'next/dynamic'

/**
 * The screen itself, in a chunk of its own (AGL-2706).
 *
 * This boundary is a client reference in every successful response and gets
 * its own chunk group, so the console chrome it composes was emitted twice on
 * every route — a second app bar, avatar, org switcher, report-issue dialog
 * and create-org dialog, plus the MUI `Tabs`, `Chip`, `Badge`, `AppBar` and
 * `Avatar` behind them — to draw a page that appears only on an unmatched
 * URL. `ssr: true` keeps the screen in the served markup where it does
 * render; the explicit `loading` is what gives the lazy component its own
 * `Suspense` boundary rather than an ancestor's.
 */
const RootNotFoundScreen = dynamic(
  () => import('../components/root-not-found.component'),
  { ssr: true, loading: () => null },
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
  return <RootNotFoundScreen />
}
