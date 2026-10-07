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

import { ICON_VARIANT_SEARCH } from '@aglyn/shared-data-enums/icons'
import { AppLink, Container } from '@aglyn/shared-ui-jsx'
import { Button } from '@mui/material'
import EmptyState from './empty-state.component'
import { CONTENT_MAX_WIDTH } from '../constants/shared'
import { buildRoute, Route } from '../constants/route-links'
import { useOrgSlug } from '../hooks/use-org-scope'

/**
 * The not-found body for a SITE address (AGL-3596): the server has answered
 * that the URL's subdomain is not a site this user can open in this
 * workspace — deleted, or their access to it removed.
 *
 * Separate from `NotFoundContent` because the useful way out is different. A
 * bad page path is fixed by going back into the workspace; a site that is gone
 * is fixed by picking another site, so the action is the workspace's Sites
 * list. Without a workspace in the URL there is no Sites list to name, and the
 * workspaces page is the safe destination instead.
 */
export function SiteNotFoundContent() {
  const orgSlug = useOrgSlug()
  return (
    <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
      <EmptyState
        // The caller decided this from a server answer, so there is no read
        // behind this state whose success is in question (AGL-1066).
        read="loaded"
        iconPath={ICON_VARIANT_SEARCH.path}
        title={'This site doesn’t exist anymore'}
        description={
          'It may have been deleted, or you no longer have access to it. ' +
          'Pick another site to keep going.'
        }
        action={
          <Button
            variant="contained"
            color="primary"
            component={AppLink as any}
            {...({ componentVariant: 'naked', nativeButton: false } as any)}
            href={
              orgSlug ? buildRoute(Route.HOST_LIST, { orgSlug }) : '/'
            }
          >
            {'Back to Sites'}
          </Button>
        }
      />
    </Container>
  )
}
SiteNotFoundContent.displayName = 'SiteNotFoundContent'

export default SiteNotFoundContent
