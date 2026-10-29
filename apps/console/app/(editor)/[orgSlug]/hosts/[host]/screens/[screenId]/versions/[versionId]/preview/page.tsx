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

import { useParams } from 'next/navigation'
import '../../../../../../../../../../constants/app-setup'
// Dynamic site-plugin activation (AGL-417): canvas components register
// via the org-gated loader; the page gates the canvas on readiness.
import { withSitePlugins } from '../../../../../../../../../../components/console-plugins-gate.component'
import DocumentPreview from '../../../../../../../../../../components/document-preview.component'
import { useHostId, useHostSubdomain } from '../../../../../../../../../../components/host-id-provider'
import ScreenVersionReviewBar from '../../../../../../../../../../components/screen-version-review-bar.component'
import { useOrgSlug } from '../../../../../../../../../../hooks/use-org-scope'

function ScreenPreviewPage() {
  const params = useParams<{ screenId: string; versionId: string }>()
  const hostId = useHostId()
  const host = useHostSubdomain()
  const orgSlug = useOrgSlug()
  const screenId = params?.screenId as string
  const versionId = params?.versionId as string

  return (
    <>
      <DocumentPreview
        ids={
          hostId && screenId
            ? { hostId, kind: 'screen', docId: screenId, versionId }
            : null
        }
      />
      {/* Publish it, or open it in the Besigner (AGL-3616). */}
      {screenId && versionId ? (
        <ScreenVersionReviewBar
          hostId={hostId}
          orgSlug={orgSlug}
          host={host}
          screenId={screenId}
          versionId={versionId}
        />
      ) : null}
    </>
  )
}

export default withSitePlugins(ScreenPreviewPage)
