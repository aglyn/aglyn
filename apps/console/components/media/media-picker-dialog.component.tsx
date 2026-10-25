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
import type {
  StockPhotoPickerClient,
  StockPhotoPickerHit,
} from '@aglyn/aglyn/app-utils/stock-photos/stock-photo-picker'
import { StockPhotoDetails } from '@aglyn/shared-ui-jsx/components/stock-photo-search.component'
import { useHostOrgId } from '@aglyn/tenant-feature-instance'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tab,
  Tabs,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useSnackbar } from 'notistack'
import { useEffect, useMemo, useState } from 'react'
import MediaLibraryComponent from './media-library.component'
import MediaPickerDetails from './media-picker-details.component'
import StockPhotosPane from './stock-photos-pane.component'

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
  /**
   * Accept a private asset instead of refusing it (AGL-2814), for a caller
   * that delivers the file through a signed link rather than placing it on a
   * page — a product's members video.
   */
  allowPrivate?: boolean
  /**
   * Offer only this kind of file (AGL-2953), for a field that can hold
   * nothing else. Both libraries the dialog shows are narrowed to it, and so
   * are their uploads. Absent, every file is offered.
   */
  kind?: Aglyn.MediaPickerKind
  /**
   * Receives the chosen media (use `media.url`/`media.cdnPath` for src) and
   * the CDN scope segment of the library it was chosen from. The scope is the
   * only way to name a private asset, which carries no `cdnPath`.
   */
  onPick: (media: Aglyn.AglynHostMedia, context: { cdnScope: string }) => void
}

/** Why a private file cannot be placed on a page, and how to change that. */
const PRIVATE_FILE_REASON =
  'That file is private, so it cannot be placed on a page. ' +
  'Turn off Private in the media library to use it here.'

/** The confirm button, named for the file it places. */
export function mediaPickerConfirmLabel(
  contentType: string | undefined,
  kind?: Aglyn.MediaPickerKind,
): string {
  const type = String(contentType ?? '')
  if (type.startsWith('image/') || (!type && kind === 'image')) return 'Use this image'
  if (type.startsWith('video/') || (!type && kind === 'video')) return 'Use this video'
  if (type.startsWith('audio/') || (!type && kind === 'audio')) return 'Use this audio'
  if (type === 'application/pdf' || (!type && kind === 'pdf')) return 'Use this PDF'
  return 'Use this file'
}

/** The dialog's title when it offers one kind of file (AGL-2953). */
const KIND_TITLES: Readonly<Record<Aglyn.MediaPickerKind, string>> = {
  image: 'Choose an image',
  video: 'Choose a video',
  pdf: 'Choose a PDF',
  audio: 'Choose audio',
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
  const { hostId, orgId, open, onClose, onPick, allowPrivate, kind } = props
  const derivedOrgId = useHostOrgId(hostId)
  const orgScope = orgId ?? derivedOrgId
  // Stock photos (AGL-4066) wherever an image can be placed: a picker for a
  // film, a PDF or audio has nothing to search there. A photo used is saved
  // to the site's library when a site is open, else the workspace's.
  const stockTarget = useMemo(
    () => (hostId ? { hostId } : orgScope ? { orgId: orgScope } : null),
    [hostId, orgScope],
  )
  const offerStock = Boolean(stockTarget) && (!kind || kind === 'image')
  const showTabs = (Boolean(hostId) && Boolean(orgScope)) || offerStock
  const [chosenTab, setTab] = useState<'site' | 'org' | 'stock'>(hostId ? 'site' : 'org')
  // A picker opened again for a film keeps no Stock photos tab to be on.
  const tab = chosenTab === 'stock' && !offerStock ? (hostId ? 'site' : 'org') : chosenTab
  /**
   * The file clicked, and the library it was clicked in. Clicking shows its
   * details; only the confirm button places it, so a file is never used on
   * the strength of a thumbnail alone.
   */
  const [pending, setPending] = useState<{
    media: Aglyn.AglynHostMedia
    cdnScope: string
  } | null>(null)
  /** The stock photo clicked, and its thumbnail; used only once the confirm button copies it. */
  const [stockPending, setStockPending] = useState<{
    hit: StockPhotoPickerHit
    previewUrl: string | null
    libraryLabel: string
  } | null>(null)
  const [stockImport, setStockImport] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  // The Stock photos tab's client, bound to the member while the tab is open.
  const [stockClient, setStockClient] = useState<StockPhotoPickerClient | null>(null)
  const stockLibraryName = hostId ? "this site's library" : "your workspace's shared library"
  // A dialog kept mounted while closed opens again with nothing chosen.
  useEffect(() => {
    if (!open) {
      setPending(null)
      setStockPending(null)
      setStockImport({ busy: false, error: null })
    }
  }, [open])
  // Below `sm` the dialog is a full-screen sheet with no room beside the
  // files, so the details take its place and say how to get back.
  const narrow = useMediaQuery(useTheme().breakpoints.down('sm'))
  const blockedReason =
    pending?.media.private && !allowPrivate ? PRIVATE_FILE_REASON : null

  const { enqueueSnackbar } = useSnackbar()

  const pick = (media: Aglyn.AglynHostMedia, cdnScope: string) => {
    /**
     * A private asset can never be placed into page content (AGL-1051).
     * It has no `cdnPath`, so picking one would put an empty `src` on the
     * page — a broken image on a published site, with nothing saying why.
     * Refusing at the pick, with the reason, is the difference between a
     * rule people can follow and a mystery they file a ticket about.
     *
     * This is a usability guard, not the boundary: the boundary is that
     * the bytes need a signature, which no page node carries. A caller that
     * mints that signature itself (`allowPrivate`, AGL-2814) is the one
     * caller for which a private asset is the right answer.
     */
    if (media.private && !allowPrivate) {
      enqueueSnackbar(PRIVATE_FILE_REASON, { variant: 'warning', persist: false })
      return
    }
    // Hand back a CDN path that names the site using the asset (AGL-1043).
    // `cdnPath` is one stored string and a restricted asset can be visible
    // to N sites, so the qualified form has to be built at pick time — the
    // doc cannot store a URL that works for all of them. A no-op for
    // org-wide assets, which is every asset unless someone restricted one.
    const qualified = hostQualifiedCdnPath(media.cdnPath, media.visibleTo, hostId)
    onPick(
      qualified === media.cdnPath ? media : { ...media, cdnPath: qualified },
      { cdnScope },
    )
    onClose()
  }

  /**
   * Copies the stock photo into the library, or finds the copy it holds,
   * and places that asset as a library pick is placed: the page never names
   * an address at the stock library.
   */
  const placeStockPhoto = async () => {
    if (!stockPending || !stockClient || !stockTarget) return
    setStockImport({ busy: true, error: null })
    const answer = await stockClient.importPhoto(stockPending.hit.ref)
    if (answer.status !== 'ok') {
      setStockImport({ busy: false, error: answer.message })
      return
    }
    setStockImport({ busy: false, error: null })
    pick(answer.media as Aglyn.AglynHostMedia, stockTarget.hostId ?? `org:${stockTarget.orgId}`)
  }

  const showStock = offerStock && tab === 'stock'
  const showSite = Boolean(hostId) && !showStock && (!showTabs || tab === 'site')
  const showOrg = Boolean(orgScope) && !showStock && (hostId ? tab === 'org' : true)
  const chosen = showStock ? stockPending : pending

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
      <DialogTitle>{kind ? KIND_TITLES[kind] : 'Choose media'}</DialogTitle>
      {/*
        `minHeight: 0` is what lets the files scroll INSIDE the box. As a
        column flex child its `min-height: auto` resolves to min-content, so a
        full library would push the paper taller than its own aspect ratio
        instead of scrolling — the classic flexbox overflow trap. The files
        and the details beside them each scroll on their own, so the details
        of the file clicked stay in view however far down the grid it was.
      */}
      <DialogContent sx={{ minHeight: 0, display: 'flex', gap: 3, overflow: 'hidden' }}>
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            // Hidden rather than unmounted, so the folder and the scroll
            // position are where they were on the way back.
            display: narrow && chosen ? 'none' : 'block',
          }}
        >
          {showTabs ? (
            <Tabs
              value={tab}
              onChange={(_event, value) => {
                setTab(value)
                setPending(null)
                setStockPending(null)
                setStockImport({ busy: false, error: null })
              }}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{ mb: 2 }}
            >
              {hostId ? <Tab value="site" label="This site" /> : null}
              {orgScope ? <Tab value="org" label="Organization (shared)" /> : null}
              {offerStock ? <Tab value="stock" label="Stock photos" /> : null}
            </Tabs>
          ) : null}
          {showSite && hostId ? (
            <MediaLibraryComponent
              hostId={hostId}
              kind={kind}
              pickedId={pending?.media.$id}
              onSelect={(media) => setPending({ media, cdnScope: hostId })}
            />
          ) : null}
          {showOrg && orgScope ? (
            <MediaLibraryComponent
              orgId={orgScope}
              // Show only what THIS site may render (AGL-1045). This is the
              // discovery boundary the project exists for: an agency employee
              // building a client's page cannot find — let alone place — an
              // asset restricted to the agency's internal sites.
              forHostId={hostId}
              kind={kind}
              pickedId={pending?.media.$id}
              onSelect={(media) =>
                setPending({ media, cdnScope: `org:${orgScope}` })
              }
            />
          ) : null}
          {showStock && stockTarget ? (
            <StockPhotosPane
              target={stockTarget}
              libraryName={stockLibraryName}
              onClient={setStockClient}
              selectedKey={stockPending?.hit.sourceKey}
              onSelect={(hit, context) => {
                setStockImport({ busy: false, error: null })
                setStockPending({ hit, ...context })
              }}
            />
          ) : null}
        </Box>
        {showStock && stockPending ? (
          <Box
            component="aside"
            aria-label="Selected photo"
            sx={{
              width: narrow ? '100%' : (theme) => theme.spacing(40),
              flexShrink: 0,
              overflowY: 'auto',
              ...(narrow ? {} : { borderLeft: 1, borderColor: 'divider', pl: 3 }),
            }}
          >
            <StockPhotoDetails
              key={stockPending.hit.sourceKey}
              hit={stockPending.hit}
              previewUrl={stockPending.previewUrl}
              libraryLabel={stockPending.libraryLabel}
              libraryName={stockLibraryName}
              error={stockImport.error}
              onBack={narrow ? () => setStockPending(null) : undefined}
            />
          </Box>
        ) : null}
        {!showStock && pending ? (
          <Box
            component="aside"
            aria-label="Selected file"
            sx={{
              width: narrow ? '100%' : (theme) => theme.spacing(40),
              flexShrink: 0,
              overflowY: 'auto',
              ...(narrow ? {} : { borderLeft: 1, borderColor: 'divider', pl: 3 }),
            }}
          >
            <MediaPickerDetails
              key={pending.media.$id}
              media={pending.media}
              blockedReason={blockedReason}
              onBack={narrow ? () => setPending(null) : undefined}
            />
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        {showStock ? (
          <Button
            variant="contained"
            disabled={!stockPending || stockImport.busy}
            onClick={() => void placeStockPhoto()}
          >
            {stockImport.busy ? 'Adding to library…' : 'Use this image'}
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={!pending || Boolean(blockedReason)}
            onClick={() => {
              if (pending) pick(pending.media, pending.cdnScope)
            }}
          >
            {mediaPickerConfirmLabel(pending?.media.contentType, kind)}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
MediaPickerDialog.displayName = 'MediaPickerDialog'

export default MediaPickerDialog
