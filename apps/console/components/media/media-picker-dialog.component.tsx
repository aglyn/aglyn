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

import type * as Aglyn from '@aglyn/aglyn'
import { hostQualifiedCdnPath } from '@aglyn/aglyn'
import { useHostOrgId } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tab,
  Tabs,
} from '@mui/material'
import { useState } from 'react'
import MediaLibraryComponent from './media-library.component'

export interface MediaPickerDialogProps {
  /** Host scope — the site's private library. */
  hostId?: string
  /**
   * Org scope — the shared library. When omitted alongside a `hostId`, the
   * host's org is resolved so shared org media is pickable via a tab too.
   */
  orgId?: string
  open: boolean
  onClose: () => void
  /** Receives the chosen media (use `media.url`/`media.cdnPath` for src). */
  onPick: (media: Aglyn.AglynHostMedia) => void
}

/**
 * The one canonical media picker (AGL-821): a dialog around the shared
 * MediaLibraryComponent, host- or org-scoped. When both a host and its org
 * are in play, a tab switches between the site-private library and the
 * organization's shared one — replacing the old hand-rolled OrgMediaStrip
 * so every picker gets the same folders, upload, and polished grid.
 *
 * The Organization tab is scoped to the site being edited (AGL-1045):
 * you can only place what that site is allowed to render. Opened without a
 * host — the org Media page — it shows everything the viewer may see.
 */
export function MediaPickerDialog(props: MediaPickerDialogProps) {
  const { hostId, orgId, open, onClose, onPick } = props
  const derivedOrgId = useHostOrgId(hostId)
  const orgScope = orgId ?? derivedOrgId
  const showTabs = Boolean(hostId) && Boolean(orgScope)
  const [tab, setTab] = useState<'site' | 'org'>(hostId ? 'site' : 'org')

  const pick = (media: Aglyn.AglynHostMedia) => {
    // Hand back a CDN path that names the site using the asset (AGL-1043).
    // `cdnPath` is one stored string and a restricted asset can be visible
    // to N sites, so the qualified form has to be built at pick time — the
    // doc cannot store a URL that works for all of them. A no-op for
    // org-wide assets, which is every asset unless someone restricted one.
    const qualified = hostQualifiedCdnPath(media.cdnPath, media.visibleTo, hostId)
    onPick(qualified === media.cdnPath ? media : { ...media, cdnPath: qualified })
    onClose()
  }

  const showSite = Boolean(hostId) && (!showTabs || tab === 'site')
  const showOrg = Boolean(orgScope) && (hostId ? tab === 'org' : true)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{'Choose media'}</DialogTitle>
      <DialogContent>
        {showTabs ? (
          <Tabs
            value={tab}
            onChange={(_event, value) => setTab(value)}
            sx={{ mb: 2 }}
          >
            <Tab value="site" label="This site" />
            <Tab value="org" label="Organization (shared)" />
          </Tabs>
        ) : null}
        {showSite && hostId ? (
          <MediaLibraryComponent hostId={hostId} onSelect={pick} />
        ) : null}
        {showOrg && orgScope ? (
          <MediaLibraryComponent
            orgId={orgScope}
            // Show only what THIS site may render (AGL-1045). This is the
            // discovery boundary the project exists for: an agency employee
            // building a client's page cannot find — let alone place — an
            // asset restricted to the agency's internal sites.
            forHostId={hostId}
            onSelect={pick}
          />
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
      </DialogActions>
    </Dialog>
  )
}
MediaPickerDialog.displayName = 'MediaPickerDialog'

export default MediaPickerDialog
