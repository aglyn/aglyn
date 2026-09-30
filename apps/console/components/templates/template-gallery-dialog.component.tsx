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
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  formatQuotaLimit,
  type ConsoleTemplateGalleryShelfState,
} from '@aglyn/aglyn'
import {
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
import {
  nameSearchToken,
  nameSearchTokens,
} from '@aglyn/aglyn/app-utils/name-search'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { collection, query, where } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import {
  useFirestore,
  useHostResourceApi,
  useHostVersionApi,
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
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { STARTER_TEMPLATES } from '../../constants/starter-templates'
import createPageFromTemplate, {
  templateScreenAddressRefusal,
  withBundleRootScreen,
} from './create-page-from-template'
import { releaseDefaultHomeRoot } from '../../constants/screen-publishing'
import { SCREEN_ROOT_PATH } from '@aglyn/aglyn/app-utils/screen-route'
import UseTemplateDialog from './use-template-dialog.component'
import useCurrentOrg from '../../hooks/use-current-org'
import useFirestoreCollection from '../../hooks/use-firestore-collection'
import {
  ARTIFACT_LIST_ORDER,
  ARTIFACT_NAME_SEARCH,
  TEMPLATE_LIST_BASE,
} from '../../utils/artifact-list-queries'
import useStarterPages from './use-starter-pages'
import PluginWidgetSlot from '../plugin-widget-slot.component'
import {
  LIBRARY_TEMPLATE_SOURCE_TYPES,
  templateSourceBadge,
} from './template-source-badge'

/**
 * What every shelf asks: no Filters panel, the walk's order, and the name
 * search (AGL-3321).
 */
const SHELF_QUERY: ListQueryDeclaration = {
  fields: [],
  sorts: [ARTIFACT_LIST_ORDER],
  search: ARTIFACT_NAME_SEARCH,
}

/** The code-defined starters, by id — at most thirty, one `in`. */
const STARTER_IDS = STARTER_TEMPLATES.map((starter) => starter.id).slice(0, 30)

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
 * Two sources of its own, presented identically:
 *
 * - The host's own library — saved templates and the ones a plugin installed.
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
 *
 * Templates offered from ELSEWHERE are shelves a plugin draws in the
 * `templateGallery` zone below these two (AGL-3080): what it lists, and the
 * route that installs one, are its own.
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
  // The search box: one word, asked of every shelf's name keys (AGL-3321).
  const [filterOpen, setFilterOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { org, ready: orgReady } = useCurrentOrg()
  const { data: user } = useUser()
  const createHostResource = useHostResourceApi()
  const createHostVersion = useHostVersionApi()
  const router = useRouter()
  const orgSlug = useOrgSlug()
  const hostSubdomain = useHostSubdomain()

  /*
   * THE SHELVES ARE QUERIES (AGL-3321).
   *
   * Each Firestore-backed shelf puts its scope and the search word on its own
   * query and pages what it answers, so a template past the first page is
   * found from the first one. Nothing is matched over the cards a shelf
   * happened to read. The search reads the NAME — the word-prefix tokens
   * every writer stamps (`nameTokens`) — so it finds a template by any word
   * of its name, and no longer by its description or category.
   *
   * The walk is the document name (`ARTIFACT_LIST_ORDER`; `hostArtifactQuery`
   * says why), which the automatic single-field indexes serve under any mix
   * of these equalities and the one array clause: no shelf needs a composite.
   */
  const searchWords = useMemo(() => (filter.trim() ? [filter] : []), [filter])
  const shelfRequest = useCallback(
    (base: ListQueryFilter[]) => ({ clauses: [], search: searchWords, base }),
    [searchWords],
  )
  const templates = open && hostId ? collection(firestore, 'hosts', hostId, 'templates') : null

  /*
   * Your templates: this site's own library rows of the kind this surface
   * picks (AGL-672, AGL-699) — saved here or installed by a plugin,
   * never a starter's pages, which the Starters shelf presents as the
   * bundles they are. `libraryRow` also leaves the deleted ones out.
   */
  const savedBase = useMemo<ListQueryFilter[]>(
    () => [
      ...TEMPLATE_LIST_BASE,
      { path: 'kind', op: '==', value: kind },
      { path: 'source.type', op: 'in', value: [...LIBRARY_TEMPLATE_SOURCE_TYPES] },
    ],
    [kind],
  )
  const saved = useListQuery<any>({
    collection: templates,
    declaration: SHELF_QUERY,
    request: shelfRequest(savedBase),
    deps: [firestore, hostId, open],
    idField: '$id',
  })

  /*
   * Starters this site has MATERIALIZED (AGL-687): their library rows, one
   * per starter, each led by one of its pages and carrying the starter's
   * name keys, so a search for the starter finds its row. Whole-site page
   * bundles, so they belong only in the page-kind picker (AGL-699).
   */
  const starterBase = useMemo<ListQueryFilter[]>(
    () => [
      ...TEMPLATE_LIST_BASE,
      { path: 'kind', op: '==', value: 'page' },
      { path: 'source.type', op: '==', value: 'starter' },
    ],
    [],
  )
  const materialized = useListQuery<any>({
    collection: kind === 'page' ? templates : null,
    declaration: SHELF_QUERY,
    request: shelfRequest(starterBase),
    deps: [firestore, hostId, open, kind],
    idField: '$id',
  })
  const materializedIds = useMemo(
    () =>
      materialized.rows
        .map((row: any) => row.source?.starterId)
        .filter((id: unknown): id is string => typeof id === 'string' && id !== ''),
    [materialized.rows],
  )
  const { pages: starterPages } = useStarterPages(firestore, hostId, materializedIds)
  const starterGroups = useMemo(
    () =>
      materialized.rows
        .filter((lead: any) => !lead.deletedAt)
        .map((lead: any) => {
          const starterId = String(lead.source?.starterId ?? lead.$id)
          return {
            id: starterId,
            displayName: lead.source?.starterName ?? lead.displayName,
            description: lead.source?.starterDescription ?? lead.description,
            category: lead.category,
            screens: starterPages.get(starterId) ?? [lead],
            virtual: false as const,
          }
        }),
    [materialized.rows, starterPages],
  )
  /*
   * Which of the code-defined starters this site has materialized, whatever
   * the search: a starter in the library shows once, from its documents. A
   * bounded read — at most one lead row per starter in
   * `constants/starter-templates.ts`.
   */
  const { data: materializedLeads } = useFirestoreCollection<any>(
    () =>
      open && kind === 'page' && STARTER_IDS.length
        ? query(
            collection(firestore, 'hosts', hostId, 'templates'),
            where('source.starterId', 'in', STARTER_IDS),
            where('libraryRow', '==', true),
          )
        : null,
    [firestore, hostId, open, kind],
    { idField: '$id' },
  )
  const materializedStarterIds = useMemo(
    () =>
      new Set(
        (materializedLeads ?? []).map((lead: any) => String(lead.source?.starterId ?? '')),
      ),
    [materializedLeads],
  )
  /*
   * Starters NOT materialized yet, rendered straight from the code
   * definitions (AGL-687). They are a constant in this bundle, not
   * documents, so the search asks them the question the queries ask: does
   * the typed word begin a word of the name.
   */
  const virtualStarters = useMemo(() => {
    const token = nameSearchToken(filter)
    return (kind !== 'page' ? [] : STARTER_TEMPLATES)
      .filter((starter) => !materializedStarterIds.has(starter.id))
      .filter((starter) => !token || nameSearchTokens(starter.displayName).includes(token))
      .map((starter) => ({
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
      }))
  }, [materializedStarterIds, kind, filter])
  // One list so the grid does not care which side a card came from.
  const starterCards = useMemo(
    () => [...starterGroups, ...virtualStarters],
    [starterGroups, virtualStarters],
  )

  const savedShown = useMemo(
    () => saved.rows.filter((entry: any) => !entry.deletedAt),
    [saved.rows],
  )
  /*
   * The shelves plugins draw (AGL-3080), as each reports itself: the
   * "nothing matches" line below covers them too, and a shelf still loading
   * holds it back as the gallery's own do.
   */
  const [pluginShelves, setPluginShelves] = useState<
    Readonly<Record<string, ConsoleTemplateGalleryShelfState>>
  >({})
  const reportShelf = useCallback(
    (shelfId: string, state: ConsoleTemplateGalleryShelfState) =>
      setPluginShelves((shelves) =>
        shelves[shelfId] === state ? shelves : { ...shelves, [shelfId]: state },
      ),
    [],
  )
  const pluginShelfStates = Object.values(pluginShelves)
  const loading =
    [saved, materialized].some((shelf) => shelf.status === 'loading') ||
    pluginShelfStates.includes('loading')
  const isEmpty =
    !loading &&
    !savedShown.length &&
    !starterCards.length &&
    !pluginShelfStates.includes('shown') &&
    saved.page === 0

  const [useTemplate, setUseTemplate] = useState<Record<string, any> | null>(
    null,
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
      await authorizedFetch(user, '/api/hosts/seed-starter-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      // AGL-1422: an undefined `org` is the FREE tier to `checkOrgQuota`, so
      // applying a template inside the loading window was refused with
      // "your plan allows N" — a number belonging to a plan the workspace
      // may not be on. Only a loaded plan may name a limit.
      if (!orgReady) {
        return void enqueueSnackbar(
          'Checking your plan — try again in a moment',
          { variant: 'info', persist: false },
        )
      }
      const quota = checkOrgQuota(
        org,
        'screensPerHost',
        screenCount + template.screens.length - 1,
      )
      if (!quota.allowed) {
        return void enqueueSnackbar(
          // `formatQuotaLimit`, not the raw number: `UNLIMITED` is
          // `Number.POSITIVE_INFINITY`, so an uncapped plan that ever reached
          // this branch would read "your plan allows Infinity".
          `This template needs ${template.screens.length} screens — your ` +
            `plan allows ${formatQuotaLimit(quota.limit)}. See Billing to ` +
            'upgrade.',
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
        // A new site is born with a placeholder home page on `/` (AGL-3408).
        // A bundle is somebody's whole site, so it takes the root from that
        // placeholder — and only from it; a home page the owner made is never
        // moved. The placeholder stays in Screens as a draft.
        const releasedRoot =
          template.screens.length > 0 &&
          (await releaseDefaultHomeRoot(firestore, { hostId, user }))
        const used = new Set(existingSlugs)
        if (releasedRoot) used.delete(SCREEN_ROOT_PATH)
        // A screen whose address the site cannot serve is left out and named
        // afterwards (AGL-2588). The other two answers are both worse: an
        // abort part-way leaves a half-applied bundle with pages on the site
        // the message never mentions, and a substituted slug puts a screen at
        // an address nobody chose — the exact silence the slug guards exist
        // to end.
        const skipped: string[] = []
        let added = 0
        // A starter is a whole site, so it has to land ON the site's address:
        // if nothing in the bundle asks for the root and this host has no home
        // page yet, the first screen takes it (AGL-1575). Never moves a live
        // home page.
        for (const screen of withBundleRootScreen(template.screens, used)) {
          const refusal = templateScreenAddressRefusal({
            slug: screen.slug,
            displayName: screen.displayName,
          })
          if (refusal) {
            skipped.push(`"${screen.displayName ?? screen.slug}" — ${refusal}`)
            continue
          }
          // Same helper the library's Use flow calls (AGL-672) — one
          // implementation of create-screen → write-version → publish-route,
          // including the slug de-confliction that must not overwrite a
          // live page.
          await createPageFromTemplate(
            firestore,
            createHostResource as any,
            createHostVersion as any,
            {
              hostId,
              displayName: screen.displayName,
              nodes: screen.nodes as Record<string, unknown>,
              description: screen.description,
              seo: screen.seo,
              slug: screen.slug,
              usedSlugs: used,
              user,
            },
          )
          added += 1
        }
        if (added) {
          enqueueSnackbar(
            `Added ${added} screen${added === 1 ? '' : 's'} from "${
              template.displayName
            }"` +
              (releasedRoot
                ? '. The placeholder home page is kept in Screens as a draft.'
                : ''),
            { variant: 'success', persist: false },
          )
        }
        if (skipped.length) {
          // Persistent, because this is the whole point of skipping rather
          // than substituting: a notice that fades is the silent surprise
          // again, one step later.
          enqueueSnackbar(
            `${skipped.length} screen${
              skipped.length === 1 ? '' : 's'
            } could not be added: ${skipped.join('; ')}`,
            { variant: 'warning', persist: true },
          )
        }
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
      orgReady,
      screenCount,
      existingSlugs,
      firestore,
      hostId,
      createHostResource,
      createHostVersion,
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
        {savedShown.length || saved.hasMore || saved.page > 0 ? (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {'Your templates'}
            </Typography>
            <Grid container spacing={2}>
              {savedShown.map((template: any) => (
                <Grid key={template.$id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography variant="h6">
                        {template.displayName}
                      </Typography>
                      <Chip
                        label={templateSourceBadge(template.source).label}
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
                        color="primary"
                        onClick={() => setUseTemplate(template)}
                      >
                        {'Use'}
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
            {/* Paged by its query: whether a further page exists is the
                probe row's fact, and no total is claimed. */}
            <ListPagination
              page={saved.page}
              pageSize={saved.pageSize}
              rowCount={savedShown.length}
              hasMore={saved.hasMore}
              onPageChange={saved.setPage}
              onPageSizeChange={saved.setPageSize}
            />
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
                        color="primary"
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
            {materialized.hasMore || materialized.page > 0 ? (
              <ListPagination
                page={materialized.page}
                pageSize={materialized.pageSize}
                rowCount={starterGroups.length}
                hasMore={materialized.hasMore}
                onPageChange={materialized.setPage}
                onPageSizeChange={materialized.setPageSize}
              />
            ) : null}
          </>
        ) : null}
        {/* Shelves a plugin offers (AGL-3080): templates to install into
            this site's library, searched by the same word as the shelves
            above. */}
        <PluginWidgetSlot
          slot="templateGallery"
          hostId={hostId}
          kind={kind}
          search={filter.trim()}
          onInstalled={onClose}
          reportShelf={reportShelf}
        />
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
