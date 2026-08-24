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
import { useSnackbar } from 'notistack'
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

  const { enqueueSnackbar } = useSnackbar()

  const pick = (media: Aglyn.AglynHostMedia) => {
    /**
     * A private asset can never be placed into page content (AGL-1051).
     * It has no `cdnPath`, so picking one would put an empty `src` on the
     * page — a broken image on a published site, with nothing saying why.
     * Refusing at the pick, with the reason, is the difference between a
     * rule people can follow and a mystery they file a ticket about.
     *
     * This is a usability guard, not the boundary: the boundary is that
     * the bytes need a signature, which no page node carries.
     */
    if (media.private) {
      enqueueSnackbar(
        'That file is private, so it cannot be placed on a page. ' +
          'Turn off Private in the media library to use it here.',
        { variant: 'warning', persist: false },
      )
      return
    }
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
    <Dialog
      open={open}
      onClose={onClose}
      // `false`, not `"md"` — `md` capped the paper at 900px, which is why a
      // library of 4-across thumbnails browsed three-across in a letterbox.
      // The real cap lives in the sx below, where it can be a ratio.
      maxWidth={false}
      slotProps={{
        paper: {
          /**
           * A BROWSING surface, sized like one (AGL-2486).
           *
           * ~80% of the viewport so it dominates the screen while still
           * reading as a layer over the page behind it, capped at 1200px so
           * it stops growing on a 4K monitor — past that the grid is scanning
           * distance, not more files.
           *
           * The 4:3 is a PREFERENCE, not a constraint. `aspect-ratio` only
           * decides the height while the height is free; `max-height` clamps
           * it, and the box simply goes wider-than-4:3 on a short viewport
           * rather than pushing Cancel below the fold. A 1200x900 dialog does
           * not fit a 1440x760 laptop, and a dialog you cannot reach the
           * buttons of is worse than a narrow one — so the ratio yields.
           *
           * Lengths and breakpoints only, deliberately: this dialog is opened
           * from the besigner as well as from console chrome, and those are
           * different `cssVariables` surfaces, where a `theme.vars` token
           * resolves on one and silently produces nothing on the other.
           * `breakpoints.down` is a media-query string, which is surface-free.
           */
          sx: (theme) => ({
            width: '80vw',
            maxWidth: 1200,
            aspectRatio: '4 / 3',
            maxHeight: 'calc(100vh - 64px)',
            // Below `sm` the "80% of the viewport" instruction stops making
            // sense: 80% of a phone is a peephole with a margin around it.
            // Full-bleed sheet instead, ratio abandoned.
            [theme.breakpoints.down('sm')]: {
              width: '100%',
              maxWidth: '100%',
              height: '100%',
              maxHeight: '100%',
              margin: 0,
              borderRadius: 0,
              aspectRatio: 'auto',
            },
          }),
        },
      }}
    >
      <DialogTitle>{'Choose media'}</DialogTitle>
      {/*
        `minHeight: 0` is what makes the grid scroll INSIDE the box. As a
        column flex child its `min-height: auto` resolves to min-content, so a
        full library would push the paper taller than its own aspect ratio
        instead of scrolling — the classic flexbox overflow trap. MUI already
        puts `overflow-y: auto` here; this lets it actually take effect.
      */}
      <DialogContent sx={{ minHeight: 0 }}>
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
