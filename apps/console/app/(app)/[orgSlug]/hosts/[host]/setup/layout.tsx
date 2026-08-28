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

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { segmentTitle } from '../../../../../page-title'

/*
 * Title shell (AGL-1059): the sections below are client components, and a
 * client component cannot export `metadata` — so their title lives here, in
 * the nearest server layout.
 *
 * `template`, not a bare string (AGL-693). Setup has TITLED ROUTES below it
 * now that its sections are pages, and a layout that sets only a `default`
 * replaces the root template for everything nested under it — so a section
 * naming itself would lose the brand suffix. `segmentTitle` re-declares both.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string }>
}): Promise<Metadata> {
  const { host } = await params
  return { title: segmentTitle(`Setup · ${host}`) }
}

export default function HostSetupTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
