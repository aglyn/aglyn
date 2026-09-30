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
import ConsoleDockSlot from '../../components/console-dock-slot.component'
import BesignerPluginZones from '../../components/besigner-plugin-zones.component'
import AuthenticatedLayout from '../../components/layouts/authenticated.layout'

/**
 * Full-screen host editor shell (App Router route group, AGL-401): the
 * besigner, screen preview/view, and theme editor used `[AuthenticatedLayout]`
 * only (no MainLayout app bar) so the canvas fills the viewport.
 */
export default function EditorLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedLayout>
      {/* The besigner's plugin zones (AGL-2984), for every editor below. */}
      <BesignerPluginZones>{children}</BesignerPluginZones>
      {/* The console dock (AGL-2486, AGL-2940), here as well as in the
          `(app)` layout: every editor surface — the besigner above all — is
          somewhere a floating panel such as the assistant is needed, and this
          is the SAME slot the rest of the console mounts, not a copy. Whether
          a widget renders stays the widget's and the shell's to decide (its
          own release flag, the staff-preview verdict and the "does this URL
          name a workspace" scope check), and the org-less editor routes (the
          platform email templates under `/admin`) still get no scope. Every
          provider it needs is above the route groups, in `app/providers.tsx`
          and `firebase-app.layout.tsx`. */}
      <ConsoleDockSlot />
    </AuthenticatedLayout>
  )
}
