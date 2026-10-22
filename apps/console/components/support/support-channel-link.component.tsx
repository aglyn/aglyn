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

import { AppLink } from '@aglyn/shared-ui-jsx'
import { Button } from '@mui/material'
import { supportSurfaceRoute, type SupportSurface } from '../../utils/support-surfaces'

/**
 * The way from one Support channel to the other (AGL-1158).
 *
 * Splitting the page is only an improvement if Support still reads as ONE
 * section. There is a single nav tab for it and it points at whichever
 * channel the tier makes primary, so without this the other channel has no
 * entry point at all — a forum-only workspace would never see that tickets
 * exist, and a Pro workspace would lose the forum entirely.
 *
 * `AppLink`, not a MUI `href`: a bare `href` leaves the router out of it and
 * hard-navigates, dropping the whole client shell on an in-app link.
 */
export interface SupportChannelLinkProps {
  /** The channel being linked TO — i.e. the one the page is NOT. */
  to: SupportSurface
  orgSlug: string
}

const LABEL: Record<SupportSurface, string> = {
  tickets: 'Support tickets',
  forum: 'Community forum',
}

export function SupportChannelLink(props: SupportChannelLinkProps) {
  const { to, orgSlug } = props
  // No org slug, no link. `buildRoute` would happily emit `/undefined/support/…`
  // and the failure would be a click, not a compile.
  if (!orgSlug) return null
  return (
    <AppLink href={supportSurfaceRoute(to, orgSlug)}>
      <Button variant="outlined" color="primary" component="span">
        {LABEL[to]}
      </Button>
    </AppLink>
  )
}
SupportChannelLink.displayName = 'SupportChannelLink'

export default SupportChannelLink
