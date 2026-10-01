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
import type { ReactNode } from 'react'
import { entityPageTitle } from '../../../../../../../../../entity-page-title'

interface DocumentRouteParams {
  host: string
  documentSegment: string
  docId: string
}

// Title-only shell. Without it this route inherits its title from the host
// layout six segments up, which is the string the besigner tab beside it
// already shows — so a preview and the editor that opened it would be
// indistinguishable in the tab strip.
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
      noun: `${besignerDocumentTitle(declared.noun)} preview`,
      scope: host,
    }),
  }
}

/** The preview of a plugin document's version; an undeclared segment 404s. */
export default async function PluginDocumentPreviewLayout({
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
