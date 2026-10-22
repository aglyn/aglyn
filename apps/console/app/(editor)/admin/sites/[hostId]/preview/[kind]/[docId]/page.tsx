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

import { EnabledPluginsContext, resolveHostEnabledPlugins } from '@aglyn/aglyn'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { Alert, Box } from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useParams, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import '../../../../../../../../constants/app-setup'
import DocumentPreview from '../../../../../../../../components/document-preview.component'
import { consolePluginLoader } from '../../../../../../../../constants/console-plugin-loader'
import { isPreviewKind } from '../../../../../../../../utils/staff-site-links'

/**
 * The site's own plugin set, resolved from the site and its organization
 * rather than from the staffer's current workspace.
 *
 * `withSitePlugins` — what the customer preview routes wrap themselves in —
 * reads `useCurrentOrg()`, which on a staff route is whichever workspace the
 * staffer last had open: a preview of someone else's site would then render
 * with THAT workspace's blocks, and a block the site uses and the staffer's
 * workspace does not enable would draw as missing. The rules let staff read
 * both documents, so the set is the one the site itself renders with.
 */
function useSitePluginIds(hostId: string): { ready: boolean; ids: string[]; failed: boolean } {
  const firestore = useFirestore()
  const [state, setState] = useState<{ ready: boolean; ids: string[]; failed: boolean }>({
    ready: false,
    ids: [],
    failed: false,
  })
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const host = await getDoc(doc(firestore, 'hosts', hostId))
        const orgId = host.get('orgId')
        const org =
          typeof orgId === 'string' && orgId ? await getDoc(doc(firestore, 'orgs', orgId)) : null
        const ids = resolveHostEnabledPlugins(
          (org?.data() as { enabledPlugins?: string[] } | undefined) ?? null,
          (host.data() as { disabledPlugins?: string[]; enabledPlugins?: string[] } | undefined) ??
            null,
        )
        await consolePluginLoader.ensure(ids, ['site'])
        if (active) setState({ ready: true, ids, failed: false })
      } catch (error) {
        console.error('[staff preview] could not load the site plugins', error)
        if (active) setState({ ready: false, ids: [], failed: true })
      }
    })()
    return () => {
      active = false
    }
  }, [firestore, hostId])
  return state
}

function StaffSitePreview() {
  const params = useParams<{ hostId: string; kind: string; docId: string }>()
  const search = useSearchParams()
  const hostId = params?.hostId ?? ''
  const kind = params?.kind
  const docId = params?.docId ?? ''
  const versionId = search?.get('version') || undefined
  const plugins = useSitePluginIds(hostId)

  if (!isPreviewKind(kind)) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">{`"${kind}" is not something a site previews.`}</Alert>
      </Box>
    )
  }
  if (plugins.failed) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{'Could not read this site to preview it.'}</Alert>
      </Box>
    )
  }
  if (!plugins.ready) return null
  return (
    <EnabledPluginsContext.Provider value={plugins.ids}>
      <DocumentPreview ids={hostId && docId ? { hostId, kind, docId, versionId } : null} />
    </EnabledPluginsContext.Provider>
  )
}

/**
 * A site's screen, layout, component, template or form as its draft renders
 * (AGL-3378), for staff who are not members of the site. The customer routes
 * resolve the site from the reader's memberships and 404 for everyone else;
 * this one takes the site from its URL.
 */
export default function StaffSitePreviewPage() {
  return (
    <Suspense fallback={null}>
      <StaffSitePreview />
    </Suspense>
  )
}
