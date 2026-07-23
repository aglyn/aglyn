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
import AuthenticatedLayout from '../../components/layouts/authenticated.layout'
import MainLayout from '../../components/layouts/main.layout'
import SecondaryNavBarComponent from '../../components/secondary-nav-bar.component'

/**
 * The console's authenticated shell (App Router route group, AGL-401). Every
 * signed-in page lived behind `[AuthenticatedLayout, MainLayout]` in the
 * Pages Router `.layouts` array; this folder layout provides that shell once.
 * MainLayout's optional `title` only fed the document title, so pages set
 * their own via `NextPageTitle`/metadata. Pages wrap their body in
 * `DashboardLayout` (per-page header/breadcrumbs) inside their page.
 *
 * The secondary app bar is deliberately NOT in there with them (AGL-755):
 * this is the only position above every route boundary in the group, so it is
 * also the only one where the site switcher survives a navigation.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    // Email/password accounts must verify before any console access
    // (AGL-479); OAuth accounts arrive verified, so this only gates them.
    <AuthenticatedLayout requireEmailVerification>
      <MainLayout>
        <SecondaryNavBarComponent />
        {children}
      </MainLayout>
    </AuthenticatedLayout>
  )
}
