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

import { buildRoute, Route } from '@aglyn/aglyn'
import { isHostInPreview } from '@aglyn/aglyn/app-utils/site-preview'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Tooltip } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useHostId, useHostSubdomain, useIsHostAdmin } from './host-id-provider'
import { useOrgSlug } from '../hooks/use-org-scope'
import useFirestoreDoc from '../hooks/use-firestore-doc'

/**
 * "This site is in preview" (AGL-4086), on every console page of a site whose
 * `preview` is on — the "hidden from search" banner's shape, beside it.
 *
 * Not dismissible, for that banner's reason: the whole failure mode of a
 * private site is that it stays private after launch day because nobody
 * remembered the switch. "Make it public" takes a site admin to the switch in
 * Admin → Error pages, where the change is made on purpose; anyone else sees
 * it off, with who can make it, rather than not at all.
 */
export function SitePreviewBanner() {
  const hostId = useHostId()
  const host = useHostSubdomain()
  const orgSlug = useOrgSlug()
  const isAdmin = useIsHostAdmin()
  const firestore = useFirestore()
  const { data: hostDoc } = useFirestoreDoc<any>(
    () => (hostId ? doc(firestore, 'hosts', hostId) : null),
    [firestore, hostId],
    { idField: '$id' },
  )

  if (!isHostInPreview(hostDoc)) return null

  const action =
    orgSlug && host ? (
      isAdmin ? (
        <AppLink
          componentVariant="button"
          color="inherit"
          size="small"
          href={buildRoute(Route.HOST_ADMIN_ERROR_PAGES, { orgSlug, host })}
        >
          {'Make it public'}
        </AppLink>
      ) : (
        <Tooltip title="Only a site admin can make the site public">
          {/* A disabled button fires no hover events; the span carries them. */}
          <span>
            <Button color="inherit" size="small" disabled>
              {'Make it public'}
            </Button>
          </span>
        </Tooltip>
      )
    ) : undefined

  return (
    <Alert severity="info" sx={{ borderRadius: 0 }} action={action}>
      {'This site is in preview. Only you and your team can see it; visitors ' +
        'see your 503 page or "Coming soon".'}
    </Alert>
  )
}
SitePreviewBanner.displayName = 'SitePreviewBanner'

export default SitePreviewBanner
