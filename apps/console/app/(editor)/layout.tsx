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

import type { ReactNode } from 'react'
import AssistPanelComponent from '../../components/assist-panel.component'
import AuthenticatedLayout from '../../components/layouts/authenticated.layout'

/**
 * Full-screen host editor shell (App Router route group, AGL-401): the
 * besigner, screen preview/view, and theme editor used `[AuthenticatedLayout]`
 * only (no MainLayout app bar) so the canvas fills the viewport.
 */
export default function EditorLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedLayout>
      {children}
      {/* Aglyn Assist (AGL-2486). The launcher was mounted in the `(app)`
          layout only, so every editor surface — the besigner above all,
          which is where an author has the most questions and the least
          room to go looking for answers — simply had no assistant. This is
          the SAME gated component the rest of the console mounts, not a
          copy: `release_assist`, the staff-preview verdict and the
          "does this URL name a workspace" scope check all still decide
          whether it renders, and the org-less editor routes (the platform
          email templates under `/admin`) still get nothing, because that
          check answers false for them exactly as it did before. Every
          provider it needs is above the route groups, in `app/providers.tsx`
          and `firebase-app.layout.tsx`, so it needs nothing added here. */}
      <AssistPanelComponent />
    </AuthenticatedLayout>
  )
}
