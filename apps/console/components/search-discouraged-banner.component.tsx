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

import { buildRoute, isSearchDiscouraged, Route } from '@aglyn/aglyn'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { Alert } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useHostId, useHostSubdomain } from './host-id-provider'
import { useOrgSlug } from '../hooks/use-org-scope'
import useFirestoreDoc from '../hooks/use-firestore-doc'

/**
 * "This site is hidden from search" (AGL-1263), on every page of a site whose
 * `seo.discourageSearchEngines` is on.
 *
 * A persistent indicator, and deliberately NOT dismissible — unlike the quota
 * banner beside it, which reports a condition the author cannot immediately
 * undo. This one reports a switch someone flipped on purpose and then forgot,
 * and the whole failure mode is that it stays on for months while the site
 * quietly fails to appear anywhere. A banner you can dismiss is a banner that
 * stops answering "why is my site not on Google" the moment it matters most.
 *
 * Rendered from DashboardLayout, so it is absent from the besigner — the
 * editor is a canvas, not a site-status surface, and the switch is not
 * reachable from there either.
 */
export function SearchDiscouragedBanner() {
  const hostId = useHostId()
  const host = useHostSubdomain()
  const orgSlug = useOrgSlug()
  const firestore = useFirestore()
  const { data: hostDoc } = useFirestoreDoc<any>(
    () => (hostId ? doc(firestore, 'hosts', hostId) : null),
    [firestore, hostId],
    { idField: '$id' },
  )

  if (!isSearchDiscouraged(hostDoc)) return null

  return (
    <Alert
      severity="warning"
      sx={{ borderRadius: 0 }}
      action={
        // Only when both route params resolved. `buildRoute` throws on a
        // missing one (AGL-1054), and a banner that crashes the console is a
        // worse outcome than a banner without a shortcut.
        orgSlug && host ? (
          <AppLink
            componentVariant="button"
            color="inherit"
            size="small"
            href={`${buildRoute(Route.HOST_SETUP, { orgSlug, host })}?tab=hostSeo`}
          >
            {'Change'}
          </AppLink>
        ) : undefined
      }
    >
      {'This site is hidden from search engines. Nothing on it will appear ' +
        'in search results until you allow indexing again.'}
    </Alert>
  )
}
SearchDiscouragedBanner.displayName = 'SearchDiscouragedBanner'

export default SearchDiscouragedBanner
