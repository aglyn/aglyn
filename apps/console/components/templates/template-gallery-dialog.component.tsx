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

import { MdiIcon, useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Dialog,
  AppBar,
  Collapse,
  IconButton,
  DialogActions,
  DialogContent,
  Divider,
  InputAdornment,
  InputBase,
  Toolbar,
  Grid,
  Typography,
} from '@mui/material'
import { collection, limit, query, where } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useHostResourceApi,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { checkOrgQuota } from '../../constants/entitlements'
import { useRouter } from 'next/navigation'
import { buildRoute, Route } from '../../constants/route-links'
import { useHostSubdomain } from '../host-id-provider'
import { useOrgSlug } from '../../hooks/use-org-scope'
import {
  ICON_VARIANT_CLEAR,
  ICON_VARIANT_CLOSE,
  ICON_VARIANT_FILTER,
  ICON_VARIANT_SEARCH,
} from '@aglyn/shared-data-enums'
import { STARTER_TEMPLATES } from '../../constants/starter-templates'
import createPageFromTemplate from './create-page-from-template'
import UseTemplateDialog from './use-template-dialog.component'
import useCurrentOrg from '../../hooks/use-current-org'
import useFirestoreCollection from '../../hooks/use-firestore-collection'

/** What one item of each kind is called, for the zero-state copy. */
const KIND_NOUN: Record<'page' | 'component' | 'layout', string> = {
  page: 'screen',
  component: 'component',
  layout: 'layout',
}

export interface TemplateGalleryDialogProps {
  hostId: string
  open: boolean
  onClose: () => void
  /** Slugs already used on the host, for collision suffixing. */
  existingSlugs: string[]
  /** Current screen count, for the plan quota check. */
  screenCount: number
  /**
   * Which template kind to offer (AGL-699). Screens pick page templates,
   * the layouts page picks layout templates, the components page picks
   * component templates — one dialog, three filtered views, rather than
   * three near-identical pickers.
   */
  kind?: 'page' | 'component' | 'layout'
  /** Dialog heading; defaults to the screens wording. */
  title?: string
  /** Sub-heading under the search bar. */
  blurb?: string
}

/**
 * Template gallery (AGL-78/79, AGL-687).
 *
 * Two sources, presented identically:
 *
 * - The host's own library — saved templates and marketplace installs.
 * - The first-party starters, rendered VIRTUALLY from the code definitions
 *   (`constants/starter-templates.ts`). Nothing is written for these until
 *   the user uses or edits one, at which point that one starter is copied
 *   into the library and behaves like any other template — versions, editor,
 *   placeholders and all.
 *
 * Keeping untouched starters virtual is what lets us keep improving them:
 * an eagerly-copied starter is a frozen snapshot, and once every host holds
 * one no upstream change reaches anybody.
 *
 * A starter that HAS been materialized is rendered from its documents and
 * suppressed as a virtual entry, so it appears once. `source.starterId` is
 * the join key. Multi-page starters stay one card either way, which keeps
 * the one-click "add all five shop pages" behaviour.
 */
export function TemplateGalleryDialog(props: TemplateGalleryDialogProps) {
  const {
    hostId,
    open,
    onClose,
    existingSlugs,
    screenCount,
    kind = 'page',
    title = 'Start from a template',
    blurb = 'Templates add ready-made, published screens you can restyle in ' +
      'the besigner. Existing screens are never touched.',
  } = props
  // Search over name and description, like the besigner element picker.
  const [filterOpen, setFilterOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { org } = useCurrentOrg()
  const { data: user } = useUser()
  const createHostResource = useHostResourceApi()
  const router = useRouter()
  const orgSlug = useOrgSlug()
  const hostSubdomain = useHostSubdomain()

  // Community site templates (AGL-137): published bundles with previews.
  const { data: templateListings } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'communityListings'),
        where('kind', '==', 'template'),
        limit(30),
      ),
    [firestore],
    { idField: '$id' },
  )
  // Community listings are whole-site page bundles, so — like the starters
  // below — they belong only in the page-kind picker (AGL-699). Offering a
  // five-page site on the components list would install pages nobody asked
  // for.
  const communityAll = useMemo(
    () =>
      kind !== 'page'
        ? []
        : (templateListings ?? []).filter((listing: any) => !listing.deletedAt),
    [templateListings, kind],
  )
  // The host's own library (AGL-672) — saved templates and marketplace
  // installs, the same collection the Templates page renders, narrowed to
  // the kind this surface picks (AGL-699).
  const { data: libraryDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'templates'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  // Memoized rather than rebuilt inline: every downstream `useMemo` keys off
  // these arrays, so a fresh identity each render made the whole filtering
  // chain recompute on every keystroke for nothing.
  const libraryPages = useMemo(
    () =>
      (libraryDocs ?? []).filter(
        (entry: any) => !entry.deletedAt && (entry.kind ?? 'page') === kind,
      ),
    [libraryDocs, kind],
  )
  // Seeded starters are presented as the bundles they were authored as; the
  // rest of the library stays a flat list of individual templates.
  const savedPagesAll = useMemo(
    () =>
      libraryPages.filter((entry: any) => entry.source?.type !== 'starter'),
    [libraryPages],
  )
  const starterGroups = useMemo(() => {
    const groups = new Map<string, { id: string; displayName: string; description?: string; category?: string; screens: any[] }>()
    for (const entry of libraryPages) {
      if (entry.source?.type !== 'starter') continue
      const starterId = String(entry.source.starterId ?? entry.$id)
      const group = groups.get(starterId) ?? {
        id: starterId,
        displayName: entry.source.starterName ?? entry.displayName,
        description: entry.source.starterDescription ?? entry.description,
        category: entry.category,
        screens: [],
      }
      group.screens.push(entry)
      groups.set(starterId, group)
    }
    for (const group of groups.values()) {
      // Authored order, not Firestore's: a starter's pages are written in
      // the order its author intended them to be created.
      group.screens.sort(
        (a: any, b: any) =>
          Number(a.source?.starterOrder ?? 0) - Number(b.source?.starterOrder ?? 0),
      )
    }
    return Array.from(groups.values())
  }, [libraryPages])
  // Starters the host has NOT materialized yet, rendered straight from the
  // code definitions (AGL-687). Anything already in the library is dropped
  // here so a materialized starter shows once, from its documents.
  const materializedStarterIds = useMemo(
    () => new Set(starterGroups.map((group) => group.id)),
    [starterGroups],
  )
  const virtualStarters = useMemo(
    () =>
      // Starters are whole-site page bundles, so they only belong in the
      // page-kind picker (AGL-699).
      (kind !== 'page' ? [] : STARTER_TEMPLATES).filter(
        (starter) => !materializedStarterIds.has(starter.id),
      ).map((starter) => ({
        id: starter.id,
        displayName: starter.displayName,
        description: starter.description,
        category: starter.category,
        virtual: true as const,
        screens: starter.screens.map((screen) => ({
          displayName: screen.displayName,
          description: screen.description,
          slug: screen.slug,
          seo: screen.seo,
          nodes: screen.nodes,
        })),
      })),
    [materializedStarterIds, kind],
  )
  // One list so the grid does not care which side a card came from.
  const allStarterCards = useMemo(
    () => [
      ...starterGroups.map((group) => ({ ...group, virtual: false as const })),
      ...virtualStarters,
    ],
    [starterGroups, virtualStarters],
  )
  const matches = useCallback(
    (name?: string, description?: string, category?: string) => {
      const needle = filter.trim().toLowerCase()
      if (!needle) return true
      return [name, description, category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    },
    [filter],
  )
  const starterCards = useMemo(
    () =>
      allStarterCards.filter((entry: any) =>
        matches(entry.displayName, entry.description, entry.category),
      ),
    [allStarterCards, matches],
  )
  const savedPages = useMemo(
    () =>
      savedPagesAll.filter((entry: any) =>
        matches(entry.displayName, entry.description, entry.category),
      ),
    [savedPagesAll, matches],
  )
  // Search covers every section on screen, not just the two local ones —
  // leaving community cards visible under a query that excluded everything
  // else would read as a broken filter.
  const communityTemplates = useMemo(
    () =>
      communityAll.filter((listing: any) =>
        matches(listing.displayName, listing.description, listing.category),
      ),
    [communityAll, matches],
  )
  const isEmpty =
    !savedPages.length && !starterCards.length && !communityTemplates.length

  const [useTemplate, setUseTemplate] = useState<Record<string, any> | null>(
    null,
  )
  const [installingId, setInstallingId] = useState<string | null>(null)
  const handleInstallTemplate = useCallback(
    (listing: any) => async () => {
      if (installingId) return
      setInstallingId(listing.$id)
      const dequeue = queueLoading()
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/community/install-template', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ listingId: listing.$id, hostId }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(
            payload?.error ?? 'Template install failed',
            {
              variant: response.status === 402 ? 'warning' : 'error',
              allowDuplicate: true,
            },
          )
        }
        // Installing adds to the template library and publishes nothing
        // (AGL-669), so the message must not imply pages appeared.
        const added = Number(payload.templates ?? 0)
        enqueueSnackbar(
          `Saved ${added} template${added === 1 ? '' : 's'} from ` +
            `"${listing.displayName}" to your library — open Templates to ` +
            'create pages from them.',
          { variant: 'success', persist: false },
        )
        onClose()
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setInstallingId(null)
        dequeue()
      }
    },
    [installingId, user, hostId, queueLoading, enqueueSnackbar, onClose],
  )

  /**
   * Copies a starter into the library (AGL-687). Called on use and on edit —
   * the two moments a user commits to a starter — and never before, so an
   * untouched starter keeps tracking the code definitions.
   *
   * Best-effort on the use path: the pages are built from the same
   * definitions either way, so a failed copy costs the library entry, not
   * the user's pages.
   */
  const materializeStarter = useCallback(
    async (starterId: string) => {
      const idToken = await (user as any)?.getIdToken?.()
      if (!idToken) return
      await fetch('/api/hosts/seed-starter-templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ hostId, starterId }),
      })
    },
    [user, hostId],
  )

  /**
   * Editing a starter is the other commitment (AGL-687): copy it in, then
   * send the user to the library where its pages are ordinary templates
   * with an editor, versions and placeholders.
   */
  const handleEditStarter = useCallback(
    (starter: { id: string; virtual?: boolean }) => async () => {
      const dequeue = queueLoading()
      try {
        if (starter.virtual) await materializeStarter(starter.id)
        onClose()
        router.push(
          buildRoute(Route.HOST_TEMPLATES, {
            orgSlug,
            host: hostSubdomain,
          }),
        )
      } catch (error: any) {
        console.error(error)
        enqueueSnackbar(error?.message ?? 'An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        dequeue()
      }
    },
    [
      materializeStarter,
      queueLoading,
      onClose,
      router,
      orgSlug,
      hostSubdomain,
      enqueueSnackbar,
    ],
  )

  const handleUse = useCallback(
    (template: {
      id?: string
      displayName: string
      screens: any[]
      virtual?: boolean
    }) => async () => {
      const quota = checkOrgQuota(
        org,
        'screensPerHost',
        screenCount + template.screens.length - 1,
      )
      if (!quota.allowed) {
        return void enqueueSnackbar(
          `This template needs ${template.screens.length} screens — your ` +
            `plan allows ${quota.limit}. See Billing to upgrade.`,
          { variant: 'warning', persist: false },
        )
      }
      const dequeue = queueLoading()
      try {
        // Using a starter is a commitment to it, so it becomes a real
        // library template now. Never blocks the pages being created.
        if (template.virtual && template.id) {
          await materializeStarter(template.id).catch((error) => {
            console.error('Could not copy starter into the library', error)
          })
        }
        const used = new Set(existingSlugs)
        for (const screen of template.screens) {
          // Same helper the library's Use flow calls (AGL-672) — one
          // implementation of create-screen → write-version → publish-route,
          // including the slug de-confliction that must not overwrite a
          // live page.
          await createPageFromTemplate(firestore, createHostResource as any, {
            hostId,
            displayName: screen.displayName,
            nodes: screen.nodes as Record<string, unknown>,
            description: screen.description,
            seo: screen.seo,
            slug: screen.slug,
            usedSlugs: used,
          })
        }
        enqueueSnackbar(
          `Added ${template.screens.length} screen${
            template.screens.length === 1 ? '' : 's'
          } from "${template.displayName}"`,
          { variant: 'success', persist: false },
        )
        onClose()
      } catch (error: any) {
        console.error(error)
        enqueueSnackbar(error?.message ?? 'An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        dequeue()
      }
    },
    [
      org,
      screenCount,
      existingSlugs,
      firestore,
      hostId,
      createHostResource,
      queueLoading,
      enqueueSnackbar,
      onClose,
      materializeStarter,
    ],
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      {/* Chrome mirrors the besigner's element picker (AGL-699) — app bar
          with a close affordance, a filter toggle and a collapsing search —
          wrapped around the template cards this dialog already had. One
          picker idiom across the product instead of two. */}
      {/* `surface` + enableColorOnDark is the shared app-bar treatment
          (secondary-app-bar, the navigation drawers) — near-white in light
          mode. The default `primary` made this the one slate-grey bar in the
          product (AGL-704). AppBar overrides its own colour in dark mode
          unless enableColorOnDark is set. */}
      <AppBar position="relative" color="surface" enableColorOnDark>
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={onClose}
            aria-label="close"
          >
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
          </IconButton>
          <Typography
            variant="h6"
            component="div"
            noWrap
            sx={{ textOverflow: 'ellipsis', ml: 2, flex: 1 }}
          >
            {title}
          </Typography>
          <IconButton
            type="button"
            color="inherit"
            aria-label="search templates"
            onClick={() => setFilterOpen((prev) => !prev)}
          >
            <MdiIcon path={ICON_VARIANT_FILTER.path} />
          </IconButton>
          <Divider sx={{ height: 28, m: 0.5 }} orientation="vertical" />
          <Button color="inherit" onClick={onClose}>
            {'Close'}
          </Button>
        </Toolbar>
        <Collapse orientation="vertical" in={filterOpen}>
          <Toolbar
            component="form"
            variant="dense"
            onSubmit={(event) => event.preventDefault()}
            sx={{
              display: 'flex',
              alignItems: 'center',
              width: 1,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <InputBase
              sx={{ flex: 1, color: 'inherit' }}
              placeholder="Search templates"
              inputProps={{ 'aria-label': 'search templates' }}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              startAdornment={
                <InputAdornment sx={{ color: 'inherit' }} position="start">
                  <MdiIcon path={ICON_VARIANT_SEARCH.path} />
                </InputAdornment>
              }
              endAdornment={
                filter ? (
                  <InputAdornment sx={{ color: 'inherit' }} position="end">
                    <IconButton
                      type="button"
                      color="inherit"
                      aria-label="clear search"
                      onClick={() => setFilter('')}
                    >
                      <MdiIcon path={ICON_VARIANT_CLEAR.path} />
                    </IconButton>
                  </InputAdornment>
                ) : null
              }
            />
          </Toolbar>
        </Collapse>
      </AppBar>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {blurb}
        </Typography>
        {/* An empty body reads as a broken dialog, and the layout and
            component kinds ship no starters — so say which of the two empties
            this is: nothing matched the search, or there is nothing here yet
            (AGL-699). */}
        {isEmpty ? (
          <Typography variant="body2" color="text.secondary">
            {filter.trim()
              ? 'Nothing matches — try a different search.'
              : `You have no ${KIND_NOUN[kind]} templates yet. Save one from ` +
                `an existing ${KIND_NOUN[kind]}, or start blank.`}
          </Typography>
        ) : null}
        {/* Your own library first (AGL-672): saved and installed templates
            are the ones a returning user is looking for, and they open the
            same Use flow as the Templates page rather than a second
            implementation. */}
        {savedPages.length ? (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {'Your templates'}
            </Typography>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              {savedPages.map((template: any) => (
                <Grid key={template.$id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography variant="h6">
                        {template.displayName}
                      </Typography>
                      <Chip
                        label={
                          template.source?.type === 'marketplace'
                            ? 'Marketplace'
                            : 'Saved here'
                        }
                        size="small"
                        variant="outlined"
                        sx={{ my: 1 }}
                      />
                      {template.description ? (
                        <Typography variant="body2" color="text.secondary">
                          {template.description}
                        </Typography>
                      ) : null}
                    </CardContent>
                    <CardActions>
                      <Button
                        size="small"
                        variant="contained"
                        color="secondary"
                        onClick={() => setUseTemplate(template)}
                      >
                        {'Use'}
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </>
        ) : null}
        {/* Seeded first-party starters (AGL-687), regrouped by the starter
            they came from so a multi-page starter is still one card that
            creates all of its pages — while each of those pages remains an
            ordinary, editable template in the library. */}
        {starterCards.length ? (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {'Starter sites'}
            </Typography>
            <Grid container spacing={2}>
              {starterCards.map((starter) => (
                <Grid key={starter.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography variant="h6">
                        {starter.displayName}
                      </Typography>
                      {starter.category ? (
                        <Chip
                          label={starter.category}
                          size="small"
                          variant="outlined"
                          sx={{ my: 1 }}
                        />
                      ) : null}
                      <Typography variant="body2" color="text.secondary">
                        {starter.description}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="div"
                        sx={{ mt: 1 }}
                      >
                        {`${starter.screens.length} screen${
                          starter.screens.length === 1 ? '' : 's'
                        }`}
                      </Typography>
                    </CardContent>
                    <CardActions>
                      <Button
                        size="small"
                        variant="contained"
                        color="secondary"
                        onClick={handleUse(starter)}
                      >
                        {'Use template'}
                      </Button>
                      <Button
                        size="small"
                        onClick={handleEditStarter(starter)}
                      >
                        {starter.virtual ? 'Edit a copy' : 'Edit'}
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </>
        ) : null}
        {communityTemplates.length ? (
          <>
            <Typography variant="subtitle1" sx={{ mt: 3, mb: 1 }}>
              {'Community templates'}
            </Typography>
            <Grid container spacing={2}>
              {communityTemplates.map((listing: any) => (
                <Grid key={listing.$id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card variant="outlined" sx={{ height: '100%' }}>
                    {listing.previewImageUrl ? (
                      <Box
                        component="img"
                        src={listing.previewImageUrl}
                        alt={`${listing.displayName} preview`}
                        sx={{
                          width: '100%',
                          height: 120,
                          objectFit: 'cover',
                        }}
                      />
                    ) : null}
                    <CardContent>
                      <Typography variant="h6">
                        {listing.displayName}
                      </Typography>
                      {listing.category ? (
                        <Chip
                          label={listing.category}
                          size="small"
                          variant="outlined"
                          sx={{ my: 1 }}
                        />
                      ) : null}
                      <Typography variant="body2" color="text.secondary">
                        {listing.description ?? ''}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="div"
                        sx={{ mt: 1 }}
                      >
                        {`${listing.screenCount ?? '?'} screens · v${
                          listing.latestVersion
                        }` +
                          (Number(listing.priceUsd ?? 0) > 0
                            ? ` · $${listing.priceUsd}`
                            : ' · free')}
                      </Typography>
                    </CardContent>
                    <CardActions>
                      <Button
                        size="small"
                        variant="contained"
                        color="secondary"
                        disabled={installingId === listing.$id}
                        onClick={handleInstallTemplate(listing)}
                      >
                        {installingId === listing.$id
                          ? 'Installing…'
                          : 'Use template'}
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Start blank instead'}</Button>
      </DialogActions>
      <UseTemplateDialog
        hostId={hostId}
        template={useTemplate}
        onClose={() => {
          setUseTemplate(null)
          // The gallery's job is done once a page exists; leaving it open
          // over a fresh page invites a second accidental create.
          onClose()
        }}
      />
    </Dialog>
  )
}
TemplateGalleryDialog.displayName = 'TemplateGalleryDialog'

export default TemplateGalleryDialog
