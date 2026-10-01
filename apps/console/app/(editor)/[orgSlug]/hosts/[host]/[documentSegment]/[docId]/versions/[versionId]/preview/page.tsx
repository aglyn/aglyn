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

import { besignerDocumentForSegment } from '@aglyn/aglyn/plugin-manager/besigner-documents'
import { useParams } from 'next/navigation'
import '../../../../../../../../../../constants/app-setup'
import { withSitePlugins } from '../../../../../../../../../../components/console-plugins-gate.component'
import DocumentPreview from '../../../../../../../../../../components/document-preview.component'
import { useHostId } from '../../../../../../../../../../components/host-id-provider'
import { isPreviewKind } from '../../../../../../../../../../utils/staff-site-links'

/**
 * A plugin document's version, rendered the way the site will (AGL-1203).
 *
 * The kind comes from the plugin's declaration for this segment. The preview
 * surface composes only the kinds it knows how to read, so a declared kind it
 * does not is shown as nothing to preview rather than as a guess.
 */
function PluginDocumentPreviewPage() {
  const params = useParams<{
    documentSegment: string
    docId: string
    versionId: string
  }>()
  const hostId = useHostId()
  const docId = params?.docId as string
  const versionId = params?.versionId as string
  const kind = besignerDocumentForSegment(params?.documentSegment)?.kind

  return (
    <DocumentPreview
      ids={
        hostId && docId && isPreviewKind(kind)
          ? { hostId, kind, docId, versionId }
          : null
      }
    />
  )
}

export default withSitePlugins(PluginDocumentPreviewPage)
