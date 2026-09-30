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

import {
  besignerDocumentForSegment,
  besignerDocumentTitle,
} from '@aglyn/aglyn/plugin-manager/besigner-documents'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { entityPageTitle } from '../../../../../../../../../entity-page-title'
import type { ReactNode } from 'react'

interface DocumentRouteParams {
  host: string
  documentSegment: string
  docId: string
}

// Title-only shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so its title lives here, in the
// nearest server layout. The suffix comes from the root title template.
export async function generateMetadata({
  params,
}: {
  params: Promise<DocumentRouteParams>
}): Promise<Metadata> {
  const { host, documentSegment, docId } = await params
  const declared = besignerDocumentForSegment(documentSegment)
  if (!declared) return {}
  return {
    title: entityPageTitle({
      subject: docId,
      noun: `${besignerDocumentTitle(declared.noun)} besigner`,
      scope: host,
    }),
  }
}

/**
 * The besigner for a document a plugin keeps under a site (AGL-3080): the
 * segment names the kind, and a segment no plugin declared is not a route.
 */
export default async function PluginDocumentBesignerLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<DocumentRouteParams>
}) {
  const { documentSegment } = await params
  if (!besignerDocumentForSegment(documentSegment)) notFound()
  return <>{children}</>
}
