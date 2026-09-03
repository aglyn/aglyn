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

import * as Aglyn from '@aglyn/aglyn'
import {
  getMdiIconPath,
  mdiCalendarClock,
  mdiCalendarEdit,
  mdiChevronDown,
  mdiClose,
  mdiCogOutline,
  mdiDeleteOutline,
  mdiFileDocumentMultipleOutline,
  mdiOpenInNew,
  mdiPencilOutline,
  mdiPublish,
  mdiPublishOff,
} from '@aglyn/shared-data-mdi'
import { IconSelectControl } from '@aglyn/shared-ui-jsx-forms'
import { IconButton } from '@mui/material'
import {
  CardDisplay,
  Container,
  HelpTip,
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { deleteDoc, deleteField, doc, updateDoc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useHostResourceApi,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useDeclareDocumentSubject } from '../document-subject'
import HostDisplayNameComponent from '../host-display-name.component'
import HubTabs from '../hub-tabs.component'
import DashboardLayout from '../layouts/dashboard.layout'
import MediaPickerDialog from '../media/media-picker-dialog.component'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { docsHelp } from '../../constants/docs-links'
import { buildRoute, Route } from '../../constants/route-links'
import CreateArtifactDrawer from '../create-artifact-drawer.component'
import { AVATAR_HINT } from '../../constants/media-size-hints'
import {
  collectionCreateBody,
  collectionTemplateBodies,
} from './collection-create-requests'
import {
  CONTENT_MAX_WIDTH,
  TABLE_HEAD_HEIGHT,
  TABLE_PAGE_SIZE_OPTIONS,
  TABLE_ROWS_PER_PAGE_LABEL,
} from '../../constants/shared'
import useBranding from '../../hooks/use-branding'
import useHostActivityLogger from '../../hooks/use-host-activity-logger'
import {
  collectionKey,
  formatStampFull,
  formatStampShort,
  slugify,
  useContentScope,
} from './content-scope.context'

/**
 * Entries tab id (AGL-2486); `?tab=entries` deep links land here. The value
 * the collection deep-link has always assumed.
 */
const ENTRIES_TAB_ID = 'entries'
/** Authors tab id (AGL-2486); `?tab=authors` deep links here. */
const AUTHORS_TAB_ID = 'authors'

/**
 * Every toolbar control is locked to one height (AGL-2486).
 *
 * A `TextField size="small"` is 40px and a `Button size="small"` is 30.8px, so
 * a select and a button placed on the same row with `alignItems: center` agree
 * about nothing: measured, the six controls came out 40 / 83.8 / 83.8 / 30.8 /
 * 53.5 / 53.5px tall with their tops spread over 26.5px. Both control kinds now
 * read their height from THIS constant, so the row cannot drift apart again
 * without someone editing one number.
 */
const TOOLBAR_CONTROL_HEIGHT = 40

/**
 * The collections list and one collection's entries (AGL-2498).
 *
 * Its OWN route component, served at both `…/content` and
 * `…/content/{collectionSlug}`. Sharing a component with the entry editor
 * flashes the wrong screen: on a cold load of an entry URL, a component that
 * renders both has nothing else to show while the entry arrives, so it paints
 * the list first. This file cannot do that — it does not know the entry
 * editor exists.
 *
 * Everything it reads comes from `useContentScope()`, resolved in the layout
 * above both routes, so the split did not duplicate the data layer.
 */
export function CollectionEntriesPage() {
  const scope = useContentScope()
  const {
    hostId,
    orgSlug,
    host,
    siteBase,
    collections,
    selected,
    entries,
    entriesStatus,
    entriesHasMore,
    entryPage,
    setEntryPage,
    entriesPerPage,
    setEntriesPerPage,
    authors,
    hostDoc,
    screenOptions,
    screensById,
    isSiteAdmin,
    contentHref,
    collectionHref,
    entryHref,
    claimNavigation,
    togglePublish,
    deleteEntry,
    openScheduler,
    openPublishDate,
    openCategories,
  } = scope

  const router = useRouter()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const logActivity = useHostActivityLogger(hostId)
  const { data: user } = useUser()
  const createResource = useHostResourceApi()
  // Help copy on this page names the product, and a white-label org must see
  // its own name rather than ours (AGL-2153).
  const { branding } = useBranding()

  /* ── template screens (AGL-105/551) ────────────────────────────────── */

  /**
   * Written through the API rather than with `updateDoc` (AGL-1390), and the
   * rules now deny the direct write. These three fields are the last exclusion
   * `countBillableScreens` makes that an editor can both apply and reverse:
   * pointing at a live screen drops it from the plan's screen allowance,
   * creating a screen spends the freed slot, and clearing the pointer leaves
   * the screen counted — one free page per cycle, and a create-time gate never
   * sees it. The route checks the cap against the state the write would leave,
   * so a clear that would put the site over is refused with the screen named.
   */
  const handleTemplateChange = useCallback(
    (collectionId: string, kind: 'list' | 'entry') =>
      async (event: { target: { value: string } }) => {
        const value = event.target.value
        try {
          const response = await authorizedFetch(
            user,
            '/api/hosts/collections',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                hostId,
                action: 'templates',
                id: collectionId,
                // `null` is the clear — `deleteField()` does not survive
                // JSON, and an empty string has meant cleared in older
                // documents too.
                data:
                  kind === 'list'
                    ? { listScreenId: value || null }
                    : {
                        entryScreenId: value || null,
                        // Superseded AGL-105 pointer; clear it so the entry
                        // select stays the single source of truth.
                        templateScreenId: null,
                      },
              }),
            },
          )
          const result = await response.json().catch(() => ({}))
          if (!response.ok) {
            throw new Error(result?.error ?? 'Template assignment failed')
          }
        } catch (error: any) {
          return void enqueueSnackbar(
            error?.message ?? 'Template assignment failed',
            { variant: 'error' },
          )
        }
        enqueueSnackbar(
          value
            ? `${kind === 'list' ? 'List' : 'Entry'} template assigned — ` +
                'the page renders through that screen'
            : `${kind === 'list' ? 'List' : 'Entry'} template cleared — ` +
                'the built-in themed page renders instead',
          { variant: 'success', persist: false },
        )
      },
    [user, hostId, enqueueSnackbar],
  )

  /* ── create / delete a collection ──────────────────────────────────── */

  const [newCollectionOpen, setNewCollectionOpen] = useState(false)
  /**
   * Creating a collection is a DRAWER, like every other artifact (AGL-2498).
   *
   * The house rule the drawer itself states: creating is a drawer, picking is
   * a dialog (AGL-699). Screens, layouts and components all create this way.
   *
   * So the fields live in the drawer's schema and this component keeps only
   * what the drawer cannot: the error to show, because uniqueness is a
   * question about the OTHER collections and the server settles it in a
   * transaction (AGL-978).
   */
  const [createError, setCreateError] = useState<unknown>(null)

  /**
   * The rest of what a collection IS, as drawer fields (AGL-2498).
   *
   * A collection is defined by four things — its name, the ADDRESS it serves,
   * and the two screens that render its list and its entries. Offering only
   * the name here means every new collection is created and then immediately
   * reopened in settings to finish defining it.
   *
   * The address is the one that mattered: it is a live URL, it was silently
   * derived from the name with no way to say otherwise, and changing it later
   * moves every entry beneath it. Left blank it still derives from the name,
   * so the common case is still one field.
   *
   * The template screens are OFFERED, not required. Both fall back to a
   * built-in themed page, which is what lets a collection render on the day it
   * is made, and the docs teach that order: create, write entries, then design
   * the pages. An empty pair is the expected answer here, not a gap.
   */
  const collectionCreateFields = useMemo(
    () => [
      {
        component: 'text-field',
        name: 'slug',
        // SLUG, the word every other address field in the console uses —
        // screens create, screen detail, the besigner, entry detail, and this
        // collection's own settings editor. It was the only "Address" among
        // them, which makes the same concept read as two.
        label: 'Slug',
        type: 'text',
        helperText:
          'The path entries publish under, e.g. blog → /blog/{entry}. ' +
          'Leave blank to use the name.',
      },
      {
        component: 'select',
        name: 'listScreenId',
        label: 'List screen',
        helperText: 'Lists every entry. Leave on the built-in themed list.',
        options: [
          { label: 'Built-in themed list', value: '' },
          ...screenOptions.map((screen: any) => ({
            label: String(screen.displayName ?? screen.$id),
            value: String(screen.$id),
          })),
        ],
      },
      {
        component: 'select',
        name: 'entryScreenId',
        label: 'Entry screen',
        helperText:
          'Renders one entry. Leave on the built-in themed article.',
        options: [
          { label: 'Built-in themed article', value: '' },
          ...screenOptions.map((screen: any) => ({
            label: String(screen.displayName ?? screen.$id),
            value: String(screen.$id),
          })),
        ],
      },
    ],
    [screenOptions],
  )

  const handleCreateCollection = useCallback(
    async (values: Record<string, any>) => {
    const displayName = String(values?.displayName ?? '').trim()
    /*
      A blank address means "use the name", which is what it has always
      silently done — said out loud now, and overridable, because the slug is
      a LIVE URL and moving it later moves every entry beneath it.
    */
    const slug = slugify(String(values?.slug ?? '').trim() || displayName)
    const listScreenId = String(values?.listScreenId ?? '')
    const entryScreenId = String(values?.entryScreenId ?? '')
    if (!displayName || !slug) return
    setCreateError(null)
    /*
      The fast check, in front of the server's. Uniqueness is claimed in a
      transaction server-side because two people can create /blog at the same
      moment; this is only so the common mistake answers instantly.
    */
    if (Aglyn.findCollectionSlugOwner(slug, 'content', collections) !== null) {
      return void setCreateError(
        new Error(`Another collection already serves /${slug}`),
      )
    }
    // The slug is the collection's public address, so uniqueness is claimed in
    // a transaction server-side (AGL-978) — the check above is only the fast
    // feedback in this dialog. Rules deny a client create.
    let id: string
    try {
      const response = await authorizedFetch(user, '/api/hosts/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          collectionCreateBody({ hostId, displayName, slug }),
        ),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(result?.error ?? 'Collection create failed')
      }
      id = String(result.id)
    } catch (error: any) {
      // Into the drawer, not a snackbar: the drawer is still open with the
      // author's typing in it, and that is where the answer belongs.
      return void setCreateError(error)
    }
    /*
      The template pointers are a SECOND request, and deliberately so: the
      route's `create` allowlist is `displayName` + `slug`, and the pointers
      are written by its `templates` action, which exists because assigning a
      screen to a collection is a different permission question from naming
      one. Skipped entirely when both are the built-in default, which is the
      common case.

      After the create, never before: there is no document to point at yet.
      Best-effort — a failed pointer leaves a collection that renders on the
      built-in pages, which is a working collection, so it must not undo a
      create that succeeded.
    */
    const templateBodies = collectionTemplateBodies({
      hostId,
      id,
      displayName,
      slug,
      listScreenId,
      entryScreenId,
    })
    if (templateBodies.length) {
      try {
        await Promise.all(
          templateBodies.map((body) =>
            authorizedFetch(user, '/api/hosts/collections', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
          ),
        )
      } catch {
        enqueueSnackbar(
          'Collection created, but its template screens were not saved — set them in Collection settings.',
          { variant: 'warning' },
        )
      }
    }
    setNewCollectionOpen(false)
    // The new collection IS the page now, so the address says so (AGL-2498).
    //
    // Claimed FIRST: the listener has not delivered the new document yet, and
    // the scope's address rewrite treats a collection it cannot see as one that
    // no longer exists — without the claim this bounces straight back off.
    const key = slug
    claimNavigation(key)
    router.push(collectionHref(key))
    enqueueSnackbar(`Collection "${displayName}" created`, {
      variant: 'success',
      persist: false,
    })
    },
  [
    collections,
    user,
    hostId,
    enqueueSnackbar,
    claimNavigation,
    router,
    collectionHref,
  ])

  /**
   * EDITING a collection (AGL-2498).
   *
   * A collection's name and slug are editable from this page, and that is the
   * only place they are editable from.
   *
   * The server half has existed since AGL-978: `/api/hosts/collections`
   * answers `action: 'update'` with `displayName` and `slug` on its allow-list
   * and the same transactional slug claim the create uses — its own docblock
   * says "Collection create/RENAME". With nothing calling the rename half, a
   * collection created as "Blg" stays "Blg" forever, and the only way to fix a
   * slug is to delete the collection and every entry under it.
   *
   * Through the API rather than `updateDoc`, and that is the substantive part:
   * the slug is the collection's public address, and two collections at
   * `/blog` means the tenant's resolver — which takes the first match of the
   * right kind — serves whichever Firestore returns and the other becomes
   * unreachable with nothing to say so. Only the transaction can refuse that.
   */
  const [editor, setEditor] = useState<{
    displayName: string
    slug: string
  } | null>(null)
  const [editorBusy, setEditorBusy] = useState(false)
  const editorSlug = slugify(editor?.slug ?? '')
  const editorSlugOwner = editor
    ? Aglyn.findCollectionSlugOwner(
        editorSlug,
        'content',
        collections,
        selected?.$id,
      )
    : null

  const handleSaveCollection = useCallback(async () => {
    if (!editor || !selected || editorBusy) return
    const displayName = editor.displayName.trim()
    const slug = slugify(editor.slug)
    if (!displayName || !slug || editorSlugOwner !== null) return
    setEditorBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/hosts/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          action: 'update',
          id: selected.$id,
          kind: 'content',
          data: { displayName, slug },
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(result?.error ?? 'Collection update failed')
      }
    } catch (error: any) {
      setEditorBusy(false)
      return void enqueueSnackbar(error?.message ?? 'Collection update failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
    setEditorBusy(false)
    setEditor(null)
    /*
      The slug IS the address, so changing it moves the page the author is
      standing on. Claimed and replaced together: the listener has not
      delivered the renamed document yet, and without the claim the scope's
      rewrite would read the new slug as a collection that does not exist and
      bounce back to the first one. `replace`, because the old slug is not a
      place to return to — it no longer resolves.
    */
    if (slug !== selected.slug) {
      claimNavigation(slug)
      router.replace(collectionHref(slug))
    }
    enqueueSnackbar(`Collection saved — entries publish at /${slug}`, {
      variant: 'success',
      persist: false,
    })
  }, [
    editor,
    editorBusy,
    editorSlugOwner,
    selected,
    user,
    hostId,
    enqueueSnackbar,
    claimNavigation,
    router,
    collectionHref,
  ])

  /**
   * Delete collection (AGL-1324). "New collection" existed and no delete
   * affordance did anywhere, so a mis-created collection was permanent.
   *
   * Admin-only like the site delete — removing a collection removes the
   * /{slug} routes the site publishes, which is not a content edit.
   */
  /**
   * Entry pagination, where the page IS the query (AGL-2501).
   *
   * The window belongs to the SCOPE: the footer below and the Firestore read
   * behind it are one control, so `page` and `pageSize` are the query's own —
   * `usePagedCollection`, opened at `TABLE_PAGE_SIZE_DEFAULT`, the smallest
   * option the console offers, by the rule that every paginated list defaults
   * to its minimum. Paging a slice of an array the provider already read
   * would leave this footer in charge of nothing: the rows past that read
   * would still be unreachable, and every one of them still billed.
   *
   * A different collection is a different list, and the hook resets the page
   * with the subject — page 3 of the last collection means nothing here.
   */
  /*
    Deleting the last entry on the last page strands the reader past the end:
    an empty table under a footer that says there is nothing further. Step
    back one, and only once the read has SETTLED — an in-flight page is empty
    too, and clamping on it would walk the reader home while their page
    loads.
  */
  useEffect(() => {
    if (
      entryPage > 0 &&
      entries.length === 0 &&
      !entriesHasMore &&
      entriesStatus === 'success'
    ) {
      setEntryPage(entryPage - 1)
    }
  }, [
    entryPage,
    entries.length,
    entriesHasMore,
    entriesStatus,
    setEntryPage,
  ])

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  /**
   * The same rule the route enforces, run here for fast feedback — so the
   * dialog can NAME what still depends on the collection instead of arming a
   * button that 409s. The server owns the truth: `entries` is ONE PAGE of the
   * collection, so this understates a long one, while the route counts them
   * for real. It cannot understate the only thing the gate turns on — a
   * collection with any entries at all has them on its first page.
   */
  const deleteDenial = selected
    ? Aglyn.collectionDeleteDenial({
        displayName: selected.displayName ?? '',
        entryCount: entries.length,
        bindings: Aglyn.collectionTemplateBindings(selected, screensById),
      })
    : null
  const handleDeleteCollection = useCallback(async () => {
    if (!selected || deleteBusy) return
    const name = selected.displayName ?? ''
    const deletedId = selected.$id
    setDeleteBusy(true)
    try {
      // RecursiveDelete is Admin-SDK-only and the rules deny a client delete of
      // a collection doc (AGL-947), so this goes through the shared erase route
      // — never a hand-rolled loop over `entries`.
      const response = await authorizedFetch(user, '/api/resources/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'hosts',
          scopeId: hostId,
          kind: 'collections',
          id: deletedId,
          // Re-checked server-side (AGL-954): this surface must never be able
          // to erase a catalog collection, however stale its list is.
          collectionKind: 'content',
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(result?.error ?? 'Collection delete failed')
      }
    } catch (error: any) {
      setDeleteBusy(false)
      return void enqueueSnackbar(error?.message ?? 'Collection delete failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
    setDeleteBusy(false)
    setDeleteOpen(false)
    setDeleteConfirm('')
    /*
      Back to the bare `/content`, which the scope's rewrite then resolves to
      whatever collection is left — or leaves alone, on a site whose last
      collection this was, so the zero state can show. `replace` because the
      address just deleted must not be reachable with Back.
    */
    router.replace(contentHref)
    enqueueSnackbar(`Collection "${name}" deleted`, {
      variant: 'success',
      persist: false,
    })
    logActivity('Deleted collection', { type: 'content', id: deletedId, name })
  }, [
    selected,
    deleteBusy,
    user,
    hostId,
    enqueueSnackbar,
    logActivity,
    router,
    contentHref,
  ])

  /* ── authors (AGL-2486) ────────────────────────────────────────────── */

  /**
   * The screen every author page renders through (AGL-2518).
   *
   * A plain client write, unlike the collection template pointers above,
   * because this one carries no billing consequence to defend. Those three
   * fields DEMOTE a screen — it stops being billable, so the write had to move
   * server-side (AGL-1390). An author template stays a page of the site in
   * exactly the sense a collection's LIST template does (AGL-1387): the site
   * designed it and keeps paying for it; it simply serves at `/author/{slug}`
   * instead of at its own slug. A pointer with nothing to excuse is an
   * ordinary host field (AGL-1400).
   */
  const handleAuthorScreenChange = useCallback(
    async (value: string) => {
      try {
        await updateDoc(doc(firestore, 'hosts', hostId), {
          authorScreenId: value || deleteField(),
          updatedAt: Timestamp.now(),
        })
      } catch (error: any) {
        return void enqueueSnackbar(
          error?.message ?? 'Could not set the author page template',
          { variant: 'error' },
        )
      }
      enqueueSnackbar(
        value
          ? 'Author pages render through that screen — it no longer serves ' +
              'at its own address'
          : 'Author pages render through the built-in themed page',
        { variant: 'success', persist: false },
      )
    },
    [firestore, hostId, enqueueSnackbar],
  )

  /**
   * The author being edited, or null. `sameAs` stays a NEWLINE-SEPARATED
   * string while editing (one profile per line reads better than a comma soup
   * of URLs) and is saved as `string[]`.
   */
  const [authorEditor, setAuthorEditor] = useState<{
    id: string | null
    type: string
    name: string
    slug: string
    url: string
    image: string
    jobTitle: string
    worksFor: string
    sameAs: string
    links: Aglyn.ContentAuthorLink[]
    bio: string
  } | null>(null)
  const [authorBusy, setAuthorBusy] = useState(false)
  const [authorPickerOpen, setAuthorPickerOpen] = useState(false)

  /**
   * The address this author's page will actually have (AGL-2518) — shown
   * rather than described, because the field is slugified on save and a
   * helper that only SAYS so leaves the author to discover what happened to
   * their spaces and capitals after they publish.
   *
   * Falls back to the name, which is exactly what `contentAuthorSlug` does.
   */
  const authorSlugPreview = authorEditor
    ? Aglyn.contentAuthorPageUrl({
        author: {
          slug: Aglyn.urlSlugSegment(authorEditor.slug),
          name: authorEditor.name,
        },
      })
    : ''

  const openAuthor = useCallback((author?: Aglyn.ContentAuthorRecord) => {
    setAuthorEditor({
      id: author?.$id ?? null,
      // Stored as the numeric `HostEntityType`; held as a string here only
      // because a MUI Select value is one. `contentAuthorSchemaType` coerces on
      // the way back, which is the same helper that forgives the string form
      // the Setup → SEO → Entity form has always written.
      type: String(
        Aglyn.contentAuthorSchemaType(author?.type) === 'Person'
          ? Aglyn.HostEntityType.PERSON
          : Aglyn.HostEntityType.ORGANIZATION,
      ),
      name: author?.name ?? '',
      slug: author?.slug ?? '',
      url: author?.url ?? '',
      image: author?.image ?? '',
      jobTitle: author?.jobTitle ?? '',
      worksFor: author?.worksFor ?? '',
      sameAs: (author?.sameAs ?? []).join('\n'),
      // Rows, not text: each carries a platform or a picked icon, so there is
      // no line-per-URL form of them to edit (AGL-2516).
      links: Aglyn.normalizeContentAuthorLinks(author?.links),
      bio: author?.bio ?? '',
    })
  }, [])

  const handleSaveAuthor = useCallback(async () => {
    if (!authorEditor || authorBusy) return
    const name = authorEditor.name.trim()
    if (!name) {
      return void enqueueSnackbar('An author needs a name', {
        variant: 'warning',
        persist: false,
      })
    }
    const isPerson = Number(authorEditor.type) === Aglyn.HostEntityType.PERSON
    const sameAs = authorEditor.sameAs
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, Aglyn.AUTHOR_SAME_AS_MAX)
    /**
     * The Person-only fields are dropped rather than stored when the author is
     * an Organization, and this is the branch rather than a cosmetic one:
     * `jobTitle` and `worksFor` are not defined on `schema.org/Organization`,
     * so carrying them would either publish invalid structured data or leave a
     * value that reappears the moment somebody flips the type back — a field
     * the editor cannot see and cannot clear.
     */
    const data = {
      type: isPerson
        ? Aglyn.HostEntityType.PERSON
        : Aglyn.HostEntityType.ORGANIZATION,
      name,
      // Slugified on the way out, because it is a PATH SEGMENT: a stored
      // `Chris Taylor` would build `/author/Chris Taylor` while every request
      // arrived slugified and matched nothing (AGL-2518). Blank derives it
      // from the name.
      slug: Aglyn.urlSlugSegment(authorEditor.slug),
      url: authorEditor.url.trim(),
      image: authorEditor.image.trim(),
      jobTitle: isPerson ? authorEditor.jobTitle.trim() : '',
      worksFor: isPerson ? authorEditor.worksFor.trim() : '',
      sameAs,
      // Normalized on the way out as well as the way in: the editor lets a row
      // exist while it is being filled, and a half-typed row is not something
      // to store (AGL-2516).
      links: Aglyn.normalizeContentAuthorLinks(authorEditor.links),
      bio: authorEditor.bio.trim(),
    }
    setAuthorBusy(true)
    try {
      if (authorEditor.id) {
        // Update stays client-direct: it creates no document, so it consumes
        // no slot under `AUTHORS_MAX_PER_HOST` — the `actions` split.
        await updateDoc(
          doc(firestore, 'hosts', hostId, 'authors', authorEditor.id),
          { ...data, updatedAt: Timestamp.now() },
        )
      } else {
        /**
         * A NEW author is created by the server (AGL-2486), like an entry
         * (AGL-2266): `hosts/{hostId}/authors` is a client-creatable host
         * subcollection, and one with no cap is unbounded Firestore documents
         * mintable from the browser against a $0 subscription.
         */
        await createResource({ hostId, resource: 'author', data })
      }
    } catch (error: any) {
      setAuthorBusy(false)
      return void enqueueSnackbar(error?.message ?? 'Could not save the author', {
        variant: 'error',
      })
    }
    setAuthorBusy(false)
    setAuthorEditor(null)
    enqueueSnackbar(authorEditor.id ? 'Author saved' : 'Author created', {
      variant: 'success',
      persist: false,
    })
    // Updates only — the create rides /api/hosts/resources and is logged
    // there from a verified uid (AGL-118). See the same split on the entry
    // editor.
    if (authorEditor.id) {
      logActivity('Updated author', {
        type: 'content',
        id: authorEditor.id,
        name,
      })
    }
  }, [
    authorEditor,
    authorBusy,
    firestore,
    hostId,
    createResource,
    enqueueSnackbar,
    logActivity,
  ])

  const handleDeleteAuthor = useCallback(
    (author: Aglyn.ContentAuthorRecord) => async () => {
      const ok = await confirm({
        title: `Delete "${author.name}"?`,
        // Said plainly because it is the question an editor actually has.
        // Entries keep their byline: the resolved name is stored on the entry
        // beside the reference, and `resolveEntryAuthor` falls through a
        // dangling id to it and then to the site.
        description:
          'Entries published under this author keep their byline as plain ' +
          'text, but lose the link, portrait and profile links in their ' +
          'structured data. This cannot be undone.',
      })
      if (!ok) return
      await deleteDoc(doc(firestore, 'hosts', hostId, 'authors', String(author.$id)))
      enqueueSnackbar('Author deleted', { variant: 'success', persist: false })
      logActivity('Deleted author', {
        type: 'content',
        id: String(author.$id),
        name: String(author.name),
      })
    },
    [confirm, firestore, hostId, enqueueSnackbar, logActivity],
  )

  /**
   * WHICH collection this tab is about (AGL-2486). `[collectionSlug]/layout.tsx`
   * paints the id from the server; this swaps it for the collection's name.
   */
  //
  // The SLUG, not the document id: the server painted the URL segment, and the
  // rename is a prefix match against exactly that string. Declaring the id
  // here matches nothing, and the tab silently keeps reading `legal` instead
  // of `Legal`.
  useDeclareDocumentSubject(
    selected ? collectionKey(selected) : undefined,
    selected?.displayName,
  )

  /** Opening a stored entry — a row click and the Edit row action. */
  const openEntry = useCallback(
    (entry: any) => router.push(entryHref(String(entry.$id))),
    [router, entryHref],
  )

  return (
    <>
      <DashboardLayout
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
          },
          { children: 'Content', href: contentHref },
          ...(selected
            ? [
                {
                  children: selected.displayName ?? selected.$id,
                  href: collectionHref(collectionKey(selected)),
                },
              ]
            : []),
        ]}
        help="content"
        header={{
          children: 'Content',
          icon: { path: mdiFileDocumentMultipleOutline.path },
        }}
        headerRight={
          <Button
            size="small"
            variant="contained"
            onClick={() => setNewCollectionOpen(true)}
          >
            {'New collection'}
          </Button>
        }
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {/* Tabs, not a second route (AGL-2486): an author is managed
              ALONGSIDE the entries that reference it, and `HubTabs` is the
              strip the settings hub, the marketplace and every plugin console
              page already use — it owns the `?tab=` mirroring, the deep-linking
              and the small-screen collapse. */}
          <HubTabs
            navHeader="Content"
            /*
             * Mount the tab being read, and not the other (AGL-2501).
             *
             * `HubTabs` keeps every panel mounted unless told otherwise, so an
             * author browsing entries also subscribed the Authors list. Both
             * panels stay mounted once visited, so switching between them is
             * still instant — the deferral only covers the tab nobody opened.
             *
             * A route rather than a tab would make this structural, and this
             * pair is the case where a tab is right: an author is managed
             * ALONGSIDE the entries that reference it, and the collection and
             * entry already own the path segments here.
             */
            lazy
            tabs={[
              {
                id: ENTRIES_TAB_ID,
                label: 'Collections & Entries',
                content: (
                  <CardDisplay
                    header={'Collections & Entries'}
                    help={docsHelp('buildABlog')}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    {collections.length === 0 ? (
                      /*
                        Deliberately not `EmptyState` — that component brings
                        its own `CardDisplay`, and this one already sits inside
                        one. The framing differs; the language (icon, h6 title,
                        capped secondary copy, one call to action) is the same
                        on purpose.
                      */
                      <Stack
                        spacing={1.5}
                        sx={{ alignItems: 'center', textAlign: 'center', py: 6 }}
                      >
                        <MdiIcon
                          path={mdiFileDocumentMultipleOutline.path}
                          color="primary"
                          fontSize="large"
                        />
                        <Typography variant="h6">
                          {'No collections yet'}
                        </Typography>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ maxWidth: 440 }}
                        >
                          {'A collection is a set of pages that share a shape ' +
                            '— a blog, a news feed, a case-study library. ' +
                            'Create one and its entries publish at ' +
                            '/{collection} and /{collection}/{entry} on your ' +
                            'site.'}
                        </Typography>
                        <Button
                          variant="contained"
                          color="primary"
                          onClick={() => setNewCollectionOpen(true)}
                        >
                          {'New collection'}
                        </Button>
                      </Stack>
                    ) : (
                      <Stack spacing={2.5}>
                        {/*
                          Toolbar: which collection, and what to do with it. It
                          WRAPS rather than overflowing, and every control is
                          pinned to `TOOLBAR_CONTROL_HEIGHT`, so the row holds
                          its baseline at any width.
                        */}
                        <Stack
                          direction="row"
                          useFlexGap
                          sx={{
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 1.5,
                          }}
                        >
                          <TextField
                            select
                            size="small"
                            label="Collection"
                            value={
                              selected ? collectionKey(selected) : ''
                            }
                            // A NAVIGATION control since AGL-2498, not a piece
                            // of component state: which collection is open is
                            // the page's address, so choosing one goes through
                            // the router and can be linked, bookmarked,
                            // reloaded and gone Back out of.
                            onChange={(event) =>
                              router.push(collectionHref(event.target.value))
                            }
                            sx={{
                              minWidth: 200,
                              maxWidth: 340,
                              flexGrow: 1,
                              '& .MuiInputBase-root': {
                                height: TOOLBAR_CONTROL_HEIGHT,
                              },
                            }}
                          >
                            {collections.map((item) => (
                              <MenuItem
                                key={item.$id}
                                value={collectionKey(item)}
                              >
                                {`${item.displayName} (/${item.slug})`}
                              </MenuItem>
                            ))}
                          </TextField>
                          {/* Pushes the actions to the trailing edge without
                              letting the select swallow the whole row. */}
                          <Box sx={{ flexGrow: 1 }} />
                          <Button
                            variant="outlined"
                            color="primary"
                            onClick={openCategories}
                            sx={{
                              height: TOOLBAR_CONTROL_HEIGHT,
                              flexShrink: 0,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {'Categories'}
                          </Button>
                          {/* The one primary action on this tab, and now the
                              only contained button in the row. */}
                          <Button
                            variant="contained"
                            color="primary"
                            onClick={() => router.push(entryHref('new'))}
                            sx={{
                              height: TOOLBAR_CONTROL_HEIGHT,
                              flexShrink: 0,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {'New entry'}
                          </Button>
                        </Stack>
                        {/*
                          Collection settings: the two template screens and the
                          collection's own deletion. Both are things you set up
                          once and then leave alone, so they sit behind a
                          disclosure instead of competing with `New entry` for
                          the toolbar.
                        */}
                        <Accordion
                          disableGutters
                          elevation={0}
                          sx={{
                            border: 1,
                            borderColor: 'divider',
                            borderRadius: 1,
                            '&::before': { display: 'none' },
                          }}
                        >
                          <AccordionSummary
                            expandIcon={
                              <MdiIcon path={mdiChevronDown.path} size={0.9} />
                            }
                          >
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{ alignItems: 'center' }}
                            >
                              <MdiIcon path={mdiCogOutline.path} size={0.8} />
                              <Typography variant="subtitle2">
                                {'Collection settings'}
                              </Typography>
                            </Stack>
                          </AccordionSummary>
                          <AccordionDetails>
                            <Stack spacing={3}>
                              {/*
                                Name and address, FIRST in the disclosure — the
                                two things about a collection an author is most
                                likely to want to change, and the two the
                                console never let them change at all
                                (AGL-2498). Editing is staged behind a button
                                rather than saved on blur: the slug is the
                                collection's public address, and a live route
                                must not move because a field lost focus.
                              */}
                              {selected ? (
                                <Stack spacing={1.5}>
                                  <Stack
                                    direction="row"
                                    useFlexGap
                                    sx={{
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      flexWrap: 'wrap',
                                      gap: 1,
                                    }}
                                  >
                                    <Typography variant="subtitle2">
                                      {'Name and address'}
                                    </Typography>
                                    {editor ? null : (
                                      <Button
                                        size="small"
                                        onClick={() =>
                                          setEditor({
                                            displayName:
                                              selected.displayName ?? '',
                                            slug: selected.slug ?? '',
                                          })
                                        }
                                      >
                                        {'Edit'}
                                      </Button>
                                    )}
                                  </Stack>
                                  {editor ? (
                                    <>
                                      <Box
                                        sx={{
                                          display: 'grid',
                                          gap: 2,
                                          gridTemplateColumns: {
                                            xs: '1fr',
                                            sm: '1fr 1fr',
                                          },
                                        }}
                                      >
                                        <TextField
                                          size="small"
                                          label="Name"
                                          value={editor.displayName}
                                          onChange={(event) =>
                                            setEditor((prev) =>
                                              prev
                                                ? {
                                                    ...prev,
                                                    displayName:
                                                      event.target.value,
                                                  }
                                                : prev,
                                            )
                                          }
                                          helperText="Shown in the console; not published"
                                        />
                                        <TextField
                                          size="small"
                                          label="Slug"
                                          value={editor.slug}
                                          onChange={(event) =>
                                            setEditor((prev) =>
                                              prev
                                                ? {
                                                    ...prev,
                                                    slug: event.target.value,
                                                  }
                                                : prev,
                                            )
                                          }
                                          error={editorSlugOwner !== null}
                                          helperText={
                                            editorSlugOwner !== null
                                              ? `Another collection already serves /${editorSlug}`
                                              : `Entries publish at /${editorSlug || '…'}/{entry}`
                                          }
                                        />
                                      </Box>
                                      {/*
                                        Said plainly, because it is the part
                                        an author cannot see: the slug is a
                                        LIVE address, and every entry beneath
                                        it moves with it.
                                      */}
                                      {editorSlug &&
                                      editorSlug !== selected.slug ? (
                                        <Alert severity="warning">
                                          {`Every entry in this collection moves from /${selected.slug}/… to /${editorSlug}/…. Links already pointing at the old address will 404.`}
                                        </Alert>
                                      ) : null}
                                      <Stack
                                        direction="row"
                                        spacing={1}
                                        useFlexGap
                                        sx={{ flexWrap: 'wrap' }}
                                      >
                                        <Button
                                          size="small"
                                          variant="contained"
                                          color="primary"
                                          disabled={
                                            editorBusy ||
                                            !editor.displayName.trim() ||
                                            !editorSlug ||
                                            editorSlugOwner !== null
                                          }
                                          onClick={() =>
                                            void handleSaveCollection()
                                          }
                                        >
                                          {editorBusy ? 'Saving…' : 'Save'}
                                        </Button>
                                        <Button
                                          size="small"
                                          disabled={editorBusy}
                                          onClick={() => setEditor(null)}
                                        >
                                          {'Cancel'}
                                        </Button>
                                      </Stack>
                                    </>
                                  ) : (
                                    <Typography
                                      variant="body2"
                                      color="text.secondary"
                                    >
                                      {`${selected.displayName} — entries publish at /${selected.slug}/{entry}`}
                                    </Typography>
                                  )}
                                </Stack>
                              ) : null}
                              <Divider />
                              <Stack spacing={1.5}>
                                <Stack
                                  direction="row"
                                  spacing={0.5}
                                  sx={{ alignItems: 'center' }}
                                >
                                  <Typography variant="subtitle2">
                                    {'Template screens'}
                                  </Typography>
                                  {/*
                                    The captions under these two selects used to
                                    read "drop a Collection Entries block" and
                                    "use {{entry.title}}, Entry Body" — true,
                                    but written for whoever built the feature.
                                    The detail is kept, in the console's own
                                    `HelpTip`; the helper text below each select
                                    now answers the question an editor actually
                                    has, which is which URL the screen serves.
                                  */}
                                  <HelpTip
                                    title="Template screens"
                                    href={docsHelp('buildABlog').href}
                                    excerpt={
                                      'Leave either on the built-in themed ' +
                                      `page and ${branding.productName} ` +
                                      'renders it for you. To design your own: ' +
                                      'the list screen needs a Collection ' +
                                      'Entries block, and the entry screen can ' +
                                      'use {{entry.title}}, Entry Body and the ' +
                                      'entry’s other fields.'
                                    }
                                  />
                                </Stack>
                                <Box
                                  sx={{
                                    display: 'grid',
                                    gap: 2,
                                    gridTemplateColumns: {
                                      xs: '1fr',
                                      sm: '1fr 1fr',
                                    },
                                  }}
                                >
                                  <TextField
                                    select
                                    size="small"
                                    label="List screen"
                                    value={selected?.listScreenId ?? ''}
                                    onChange={handleTemplateChange(
                                      selected?.$id ?? '',
                                      'list',
                                    )}
                                    helperText={`Lists every entry at /${
                                      selected?.slug ?? '…'
                                    }`}
                                  >
                                    <MenuItem value="">
                                      {'Built-in themed list'}
                                    </MenuItem>
                                    {screenOptions.map((screen: any) => (
                                      <MenuItem
                                        key={screen.$id}
                                        value={screen.$id}
                                      >
                                        {screen.displayName ?? screen.$id}
                                      </MenuItem>
                                    ))}
                                  </TextField>
                                  <TextField
                                    select
                                    size="small"
                                    label="Entry screen"
                                    value={
                                      selected?.entryScreenId ??
                                      selected?.templateScreenId ??
                                      ''
                                    }
                                    onChange={handleTemplateChange(
                                      selected?.$id ?? '',
                                      'entry',
                                    )}
                                    helperText={`Renders one entry under /${
                                      selected?.slug ?? '…'
                                    }`}
                                  >
                                    <MenuItem value="">
                                      {'Built-in themed article'}
                                    </MenuItem>
                                    {screenOptions.map((screen: any) => (
                                      <MenuItem
                                        key={screen.$id}
                                        value={screen.$id}
                                      >
                                        {screen.displayName ?? screen.$id}
                                      </MenuItem>
                                    ))}
                                  </TextField>
                                </Box>
                              </Stack>
                              {/*
                                AGL-1324 gave the collection shell a delete;
                                AGL-2486 gives it somewhere to live. It was
                                sitting next to `New entry` at the same size and
                                the same outlined weight, which is the one
                                arrangement guaranteed to make the destructive
                                action the easiest to hit by accident.
                              */}
                              {isSiteAdmin && selected ? (
                                <>
                                  <Divider />
                                  <Stack
                                    direction="row"
                                    useFlexGap
                                    sx={{
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      flexWrap: 'wrap',
                                      gap: 1.5,
                                    }}
                                  >
                                    <Stack
                                      spacing={0.25}
                                      sx={{ flexGrow: 1, minWidth: 220 }}
                                    >
                                      <Typography variant="subtitle2">
                                        {'Delete this collection'}
                                      </Typography>
                                      <Typography
                                        variant="caption"
                                        color="text.secondary"
                                      >
                                        {`Permanently removes ${selected.displayName}, its /${selected.slug} route and every entry in it.`}
                                      </Typography>
                                    </Stack>
                                    <Button
                                      size="small"
                                      variant="text"
                                      color="error"
                                      onClick={() => {
                                        setDeleteConfirm('')
                                        setDeleteOpen(true)
                                      }}
                                      sx={{
                                        flexShrink: 0,
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {'Delete collection'}
                                    </Button>
                                  </Stack>
                                </>
                              ) : null}
                            </Stack>
                          </AccordionDetails>
                        </Accordion>
                        {/* An empty FIRST page is an empty collection. An
                            empty later one is a page that has been emptied
                            underneath the reader, and the effect above walks
                            them back rather than telling them they have never
                            written anything. */}
                        {entries.length === 0 && entryPage === 0 ? (
                          <Stack
                            spacing={1.5}
                            sx={{
                              alignItems: 'center',
                              textAlign: 'center',
                              py: 5,
                            }}
                          >
                            <MdiIcon
                              path={mdiFileDocumentMultipleOutline.path}
                              color="primary"
                              fontSize="large"
                            />
                            <Typography variant="h6">
                              {'No entries yet'}
                            </Typography>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ maxWidth: 420 }}
                            >
                              {`Entries you publish here appear at /${
                                selected?.slug ?? ''
                              } on your site.`}
                            </Typography>
                            <Button
                              variant="contained"
                              color="primary"
                              onClick={() => router.push(entryHref('new'))}
                            >
                              {'New entry'}
                            </Button>
                          </Stack>
                        ) : (
                          <Table size="small">
                            <TableHead
                              sx={{
                                '& .MuiTableCell-head': {
                                  height: TABLE_HEAD_HEIGHT,
                                },
                              }}
                            >
                              <TableRow>
                                {/*
                                  Title takes every spare pixel; the rest are
                                  sized by their own content. Before this the
                                  action cluster held a FIXED 381.5px — 43% of
                                  the table at 1280px and 48.5% at 900px, more
                                  than the title column ever got.
                                */}
                                <TableCell sx={{ width: '100%' }}>
                                  {'Title'}
                                </TableCell>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                  {'Status'}
                                </TableCell>
                                <TableCell
                                  sx={{
                                    whiteSpace: 'nowrap',
                                    display: { xs: 'none', md: 'table-cell' },
                                  }}
                                >
                                  {'Updated'}
                                </TableCell>
                                <TableCell
                                  sx={{
                                    whiteSpace: 'nowrap',
                                    display: { xs: 'none', md: 'table-cell' },
                                  }}
                                >
                                  {'Published'}
                                </TableCell>
                                <TableCell align="right" sx={{ width: 56 }}>
                                  {'Actions'}
                                </TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {entries.map((entry: any) => {
                                const published = entry.status === 'published'
                                /*
                                  Five equal text links (EDIT · UNPUBLISH ·
                                  SCHEDULE · VIEW · DELETE) put the one
                                  irreversible action a few pixels from the four
                                  routine ones. The console settled this in
                                  AGL-701: secondary and destructive row actions
                                  go in the overflow menu, which tints the
                                  destructive item and cannot be hit without
                                  opening it first.
                                */
                                const actions: RowActionsMenuItem[] = [
                                  {
                                    key: 'edit',
                                    label: 'Edit',
                                    icon: (
                                      <MdiIcon
                                        path={mdiPencilOutline.path}
                                        size={0.8}
                                      />
                                    ),
                                    onClick: () => openEntry(entry),
                                  },
                                  {
                                    key: 'publish',
                                    label: published ? 'Unpublish' : 'Publish',
                                    icon: (
                                      <MdiIcon
                                        path={
                                          published
                                            ? mdiPublishOff.path
                                            : mdiPublish.path
                                        }
                                        size={0.8}
                                      />
                                    ),
                                    onClick: () => void togglePublish(entry),
                                  },
                                  {
                                    key: 'published-date',
                                    /*
                                      Named in the PAST TENSE, and the whole
                                      point of the wording. `publishedAt` (when
                                      it went out) and `publishAt` (when it is
                                      due to) are one letter apart, and a
                                      "Publish date…" sitting beside "Schedule…"
                                      would be read as the same feature by
                                      anybody who had not written both.
                                    */
                                    label: 'Edit published date…',
                                    icon: (
                                      <MdiIcon
                                        path={mdiCalendarEdit.path}
                                        size={0.8}
                                      />
                                    ),
                                    onClick: () => openPublishDate(entry),
                                  },
                                  {
                                    key: 'schedule',
                                    label: 'Schedule…',
                                    icon: (
                                      <MdiIcon
                                        path={mdiCalendarClock.path}
                                        size={0.8}
                                      />
                                    ),
                                    onClick: () => openScheduler(entry),
                                  },
                                ]
                                if (published && siteBase) {
                                  actions.push({
                                    key: 'view',
                                    label: 'View on site',
                                    icon: (
                                      <MdiIcon
                                        path={mdiOpenInNew.path}
                                        size={0.8}
                                      />
                                    ),
                                    onClick: () =>
                                      void window.open(
                                        `${siteBase}/${selected?.slug}/${entry.slug}`,
                                        '_blank',
                                        'noreferrer',
                                      ),
                                  })
                                }
                                actions.push({
                                  key: 'delete',
                                  label: 'Delete',
                                  destructive: true,
                                  icon: (
                                    <MdiIcon
                                      path={mdiDeleteOutline.path}
                                      size={0.8}
                                    />
                                  ),
                                  onClick: () => void deleteEntry(entry),
                                })
                                return (
                                  <TableRow
                                    key={entry.$id}
                                    hover
                                    onClick={() => openEntry(entry)}
                                    sx={{ cursor: 'pointer' }}
                                  >
                                    <TableCell sx={{ width: '100%' }}>
                                      {/*
                                        `anywhere` rather than a truncation: a
                                        slug is one long unbroken token and the
                                        default break rules cut it mid-word
                                        instead of wrapping it.
                                      */}
                                      <Typography
                                        variant="body2"
                                        sx={{
                                          fontWeight: 500,
                                          overflowWrap: 'anywhere',
                                        }}
                                      >
                                        {entry.title}
                                      </Typography>
                                      <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        component="div"
                                        sx={{ overflowWrap: 'anywhere' }}
                                      >
                                        {`/${selected?.slug}/${entry.slug}`}
                                      </Typography>
                                    </TableCell>
                                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                      {/*
                                        Outlined, and the label is the status
                                        word alone. A filled chip carrying a
                                        full timestamp was the heaviest thing on
                                        a page of otherwise quiet rows, and it
                                        repeated identically down every one.
                                      */}
                                      <Chip
                                        label={entry.status ?? 'draft'}
                                        variant="outlined"
                                        color={
                                          published
                                            ? 'success'
                                            : entry.status === 'scheduled'
                                              ? 'info'
                                              : 'default'
                                        }
                                        size="small"
                                      />
                                    </TableCell>
                                    <TableCell
                                      title={formatStampFull(entry.updatedAt)}
                                      sx={{
                                        whiteSpace: 'nowrap',
                                        display: {
                                          xs: 'none',
                                          md: 'table-cell',
                                        },
                                      }}
                                    >
                                      {formatStampShort(entry.updatedAt)}
                                    </TableCell>
                                    <TableCell
                                      title={
                                        formatStampFull(entry.publishedAt) ??
                                        formatStampFull(entry.publishAt)
                                      }
                                      sx={{
                                        whiteSpace: 'nowrap',
                                        display: {
                                          xs: 'none',
                                          md: 'table-cell',
                                        },
                                      }}
                                    >
                                      {entry.publishedAt ? (
                                        formatStampShort(entry.publishedAt)
                                      ) : entry.status === 'scheduled' &&
                                        entry.publishAt ? (
                                        <Typography
                                          variant="body2"
                                          color="info.main"
                                          component="span"
                                        >
                                          {formatStampShort(entry.publishAt)}
                                        </Typography>
                                      ) : (
                                        '—'
                                      )}
                                    </TableCell>
                                    <TableCell
                                      align="right"
                                      sx={{ width: 56 }}
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                    >
                                      <RowActionsMenu
                                        label={entry.title}
                                        items={actions}
                                      />
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                        )}
                        {entries.length > 0 || entryPage > 0 ? (
                          <TablePagination
                            component="div"
                            /*
                              Nobody has paid to learn how many entries the
                              collection holds, and counting them is the cost
                              paging exists to avoid. MUI models that: `-1`
                              renders "1–10 of more than 10" and leaves Next
                              live. On the LAST page the total stops being
                              unknown — `page × size + rows` IS it — and
                              handing MUI the real number there is what
                              disables Next and stops the count line saying
                              "more than" at the moment that would be false.
                            */
                            count={
                              entriesHasMore
                                ? -1
                                : entryPage * entriesPerPage + entries.length
                            }
                            page={entryPage}
                            onPageChange={(_event, next) =>
                              setEntryPage(next)
                            }
                            rowsPerPage={entriesPerPage}
                            // Back to the first page with it: the hook does
                            // that, because page four of a ten-row list does
                            // not exist once fifty at a time are asked for.
                            onRowsPerPageChange={(event) =>
                              setEntriesPerPage(parseInt(event.target.value, 10))
                            }
                            rowsPerPageOptions={TABLE_PAGE_SIZE_OPTIONS}
                            labelRowsPerPage={TABLE_ROWS_PER_PAGE_LABEL}
                          />
                        ) : null}
                      </Stack>
                    )}
                  </CardDisplay>
                ),
              },
              {
                id: AUTHORS_TAB_ID,
                label: 'Authors',
                content: (
                  <CardDisplay
                    header={'Authors'}
                    help={docsHelp('buildABlog', {
                      anchor: '#authors',
                      excerpt:
                        'Publish entries under a pen name, a guest ' +
                        'contributor or the company — a Person or an ' +
                        'Organization, emitted as JSON-LD structured data.',
                    })}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <Stack spacing={2}>
                      <Stack
                        direction="row"
                        spacing={2}
                        sx={{ alignItems: 'center' }}
                      >
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ flexGrow: 1 }}
                        >
                          {'Bylines your entries can be published under — they ' +
                            'need not match the account that wrote the post. ' +
                            'Each one becomes the Article’s schema.org author.'}
                        </Typography>
                        <Button
                          variant="contained"
                          color="primary"
                          onClick={() => openAuthor()}
                          sx={{
                            height: TOOLBAR_CONTROL_HEIGHT,
                            flexShrink: 0,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {'New author'}
                        </Button>
                      </Stack>
                      {/*
                        The template for EVERY author page (AGL-2518), which
                        is why it sits above the roster rather than inside a
                        row: there is one author page shape per site, not one
                        per person. Letting each record name its own screen
                        would give a reader a masthead whose design changes as
                        they click between colleagues.
                      */}
                      <TextField
                        select
                        size="small"
                        label="Author page screen"
                        value={hostDoc?.authorScreenId ?? ''}
                        onChange={(event) =>
                          void handleAuthorScreenChange(event.target.value)
                        }
                        helperText={
                          'Renders every author’s page at /author/…. Design ' +
                          'it with an Author Profile block and a Collection ' +
                          'Entries block; {{author.name}}, {{author.bio}} and ' +
                          '{{author.entryCountLabel}} resolve per author. The ' +
                          'screen you pick stops serving at its own address.'
                        }
                        sx={{ maxWidth: 420 }}
                      >
                        <MenuItem value="">
                          {'Built-in themed author page'}
                        </MenuItem>
                        {screenOptions.map((screen: any) => (
                          <MenuItem key={screen.$id} value={screen.$id}>
                            {screen.displayName ?? screen.$id}
                          </MenuItem>
                        ))}
                      </TextField>
                      {authors.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {'No authors yet. Entries fall back to a one-off ' +
                            'byline, or to the site’s publisher entity from ' +
                            'Setup → SEO.'}
                        </Typography>
                      ) : (
                        <Table size="small">
                          <TableHead
                            sx={{
                              '& .MuiTableCell-head': {
                                height: TABLE_HEAD_HEIGHT,
                              },
                            }}
                          >
                            <TableRow>
                              <TableCell>{'Author'}</TableCell>
                              <TableCell>{'Type'}</TableCell>
                              <TableCell>{'Entries'}</TableCell>
                              <TableCell align="right" sx={{ width: 56 }}>
                                {'Actions'}
                              </TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {authors.map((author) => (
                              <TableRow
                                key={author.$id}
                                hover
                                onClick={() => openAuthor(author)}
                                sx={{ cursor: 'pointer' }}
                              >
                                <TableCell>
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    sx={{ alignItems: 'center' }}
                                  >
                                    <Avatar
                                      src={
                                        Aglyn.resolveMediaSrc(author.image, {
                                          hostId,
                                        }) || undefined
                                      }
                                      sx={{ width: 28, height: 28 }}
                                    >
                                      {String(author.name ?? '?').slice(0, 1)}
                                    </Avatar>
                                    <span>{author.name}</span>
                                  </Stack>
                                  {author.jobTitle ? (
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                      component="div"
                                    >
                                      {author.jobTitle}
                                    </Typography>
                                  ) : null}
                                </TableCell>
                                <TableCell>
                                  <Chip
                                    size="small"
                                    label={Aglyn.contentAuthorSchemaType(
                                      author.type,
                                    )}
                                  />
                                </TableCell>
                                <TableCell>
                                  {/* Counted off the entries ON THE PAGE the
                                      Entries tab is showing — one page of one
                                      collection. A hint about where a byline
                                      is in use, not a site-wide total it
                                      cannot know without reading for it. */}
                                  {
                                    entries.filter(
                                      (entry: any) =>
                                        entry.authorId === author.$id,
                                    ).length
                                  }
                                </TableCell>
                                <TableCell
                                  align="right"
                                  sx={{ width: 56 }}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <RowActionsMenu
                                    label={author.name}
                                    items={[
                                      {
                                        key: 'edit',
                                        label: 'Edit',
                                        icon: (
                                          <MdiIcon
                                            path={mdiPencilOutline.path}
                                            size={0.8}
                                          />
                                        ),
                                        onClick: () => openAuthor(author),
                                      },
                                      {
                                        key: 'delete',
                                        label: 'Delete',
                                        destructive: true,
                                        icon: (
                                          <MdiIcon
                                            path={mdiDeleteOutline.path}
                                            size={0.8}
                                          />
                                        ),
                                        onClick: () =>
                                          void handleDeleteAuthor(author)(),
                                      },
                                    ]}
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </Stack>
                  </CardDisplay>
                ),
              },
            ]}
          />
        </Container>
      </DashboardLayout>
      {/*
        CREATING IS A DRAWER (AGL-699/AGL-2498). Screens, layouts, components
        and templates all create through `CreateArtifactDrawer`; this was the
        last modal, and it asked for a name where the others ask for a name and
        the things that define the artifact.

        No Description: the collections route's content allowlist is
        `displayName` + `slug`, so one typed here would be dropped in silence.
      */}
      <CreateArtifactDrawer
        open={newCollectionOpen}
        onClose={() => {
          setNewCollectionOpen(false)
          setCreateError(null)
        }}
        title="New collection"
        onSubmit={handleCreateCollection}
        error={createError}
        includeDescription={false}
        extraFields={collectionCreateFields}
      />
      {/* Delete collection (AGL-1324). Type-the-name confirmation, matching the
          site delete. Refuses while a template screen still renders it or
          entries still live under it — naming which — because deleting a
          collection must never be the act that removes a published page. */}
      <Dialog
        open={deleteOpen}
        onClose={() => (deleteBusy ? undefined : setDeleteOpen(false))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{`Delete "${selected?.displayName ?? ''}"?`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {deleteDenial ? (
              <Alert severity="warning">{deleteDenial.error}</Alert>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {`The collection and its /${selected?.slug ?? ''} route are ` +
                  'permanently deleted. This cannot be undone.'}
              </Typography>
            )}
            <TextField
              label={`Type "${selected?.displayName ?? ''}" to confirm`}
              value={deleteConfirm}
              disabled={deleteBusy || deleteDenial !== null}
              onChange={(event) => setDeleteConfirm(event.target.value)}
              size="small"
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={deleteBusy} onClick={() => setDeleteOpen(false)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={
              deleteBusy ||
              deleteDenial !== null ||
              deleteConfirm.trim() !== (selected?.displayName ?? '')
            }
            onClick={() => void handleDeleteCollection()}
          >
            {'Delete collection'}
          </Button>
        </DialogActions>
      </Dialog>
      {/* Author editor (AGL-2486). The Person/Organization Select is a real
          branch: the fields below it change with it, because `jobTitle` and
          `worksFor` are not defined on `schema.org/Organization` and a form
          that offers them for one is a form that invites invalid markup. */}
      <Dialog
        open={Boolean(authorEditor)}
        onClose={() => setAuthorEditor(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {authorEditor?.id ? 'Edit author' : 'New author'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            select
            label="Type"
            size="small"
            value={
              authorEditor?.type ?? String(Aglyn.HostEntityType.ORGANIZATION)
            }
            onChange={(event) =>
              setAuthorEditor((prev) =>
                prev ? { ...prev, type: event.target.value } : prev,
              )
            }
            helperText={
              'Person or Organization — they are different schema.org types ' +
              'with different fields, not a label.'
            }
          >
            <MenuItem value={String(Aglyn.HostEntityType.PERSON)}>
              {'Person'}
            </MenuItem>
            <MenuItem value={String(Aglyn.HostEntityType.ORGANIZATION)}>
              {'Organization'}
            </MenuItem>
          </TextField>
          <TextField
            label="Name"
            size="small"
            required
            value={authorEditor?.name ?? ''}
            onChange={(event) =>
              setAuthorEditor((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            helperText="The byline, exactly as it should read"
          />
          <TextField
            label="Page address"
            size="small"
            value={authorEditor?.slug ?? ''}
            onChange={(event) =>
              setAuthorEditor((prev) =>
                prev ? { ...prev, slug: event.target.value } : prev,
              )
            }
            helperText={
              authorSlugPreview
                ? `Their page: ${authorSlugPreview}`
                : 'Their page on this site. Blank uses the name.'
            }
          />
          <TextField
            label="URL"
            size="small"
            value={authorEditor?.url ?? ''}
            onChange={(event) =>
              setAuthorEditor((prev) =>
                prev ? { ...prev, url: event.target.value } : prev,
              )
            }
            helperText="Their OWN site, if they have one — not their page here"
          />
          <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
            <TextField
              label={
                Number(authorEditor?.type) === Aglyn.HostEntityType.PERSON
                  ? 'Portrait'
                  : 'Logo'
              }
              size="small"
              sx={{ flexGrow: 1 }}
              value={authorEditor?.image ?? ''}
              onChange={(event) =>
                setAuthorEditor((prev) =>
                  prev ? { ...prev, image: event.target.value } : prev,
                )
              }
              helperText={
                'Pick from the media library, or paste a URL — an external ' +
                `avatar is a legitimate answer. ${AVATAR_HINT}`
              }
            />
            <Button
              size="small"
              variant="outlined"
              sx={{ mt: 0.5 }}
              onClick={() => setAuthorPickerOpen(true)}
            >
              {'Choose…'}
            </Button>
          </Stack>
          {Number(authorEditor?.type) === Aglyn.HostEntityType.PERSON ? (
            <>
              <TextField
                label="Job title"
                size="small"
                value={authorEditor?.jobTitle ?? ''}
                onChange={(event) =>
                  setAuthorEditor((prev) =>
                    prev ? { ...prev, jobTitle: event.target.value } : prev,
                  )
                }
                helperText="schema.org/Person jobTitle, e.g. Staff Writer"
              />
              <TextField
                label="Works for"
                size="small"
                value={authorEditor?.worksFor ?? ''}
                onChange={(event) =>
                  setAuthorEditor((prev) =>
                    prev ? { ...prev, worksFor: event.target.value } : prev,
                  )
                }
                helperText="The organization they write for"
              />
            </>
          ) : null}
          {/*
            The links this author's card PRINTS (AGL-2516).

            Separate from `Profile links` below, and the split is the point:
            that field is `sameAs`, which exists for crawlers and renders
            nowhere. These are the rows a reader clicks, so each one has to say
            what it is before the click — which a known platform does with its
            own mark, and anything else does with a label the author writes.
          */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {'Links'}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', display: 'block', mb: 1 }}
            >
              {'Shown on the author card. A known platform brings its own ' +
                'icon; anything else takes a label and an icon you pick. ' +
                `Up to ${Aglyn.AUTHOR_LINKS_MAX}.`}
            </Typography>
            <Stack spacing={1.5}>
              {(authorEditor?.links ?? []).map((link, index) => {
                const known = Aglyn.authorLinkPlatform(link.platform)
                const patch = (next: Partial<Aglyn.ContentAuthorLink>) =>
                  setAuthorEditor((prev) =>
                    prev
                      ? {
                          ...prev,
                          links: prev.links.map((row, i) =>
                            i === index ? { ...row, ...next } : row,
                          ),
                        }
                      : prev,
                  )
                return (
                  <Stack key={index} spacing={1}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <TextField
                        select
                        size="small"
                        label="Kind"
                        sx={{ minWidth: 148 }}
                        value={known?.id ?? ''}
                        onChange={(event) =>
                          // Switching to a platform DROPS the custom label and
                          // icon rather than keeping them hidden: the registry
                          // owns both for a known platform, and a value the
                          // editor stops showing is one nobody can clear.
                          patch(
                            event.target.value
                              ? {
                                  platform: event.target.value,
                                  label: '',
                                  icon: '',
                                  iconPath: '',
                                }
                              : { platform: '' },
                          )
                        }
                      >
                        <MenuItem value="">{'Custom link'}</MenuItem>
                        {Aglyn.AUTHOR_SOCIAL_PLATFORMS.map((platform) => (
                          <MenuItem key={platform.id} value={platform.id}>
                            {platform.label}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        size="small"
                        fullWidth
                        label="URL"
                        value={link.url ?? ''}
                        onChange={(event) => patch({ url: event.target.value })}
                        placeholder={
                          known?.id === 'email'
                            ? 'mailto:hello@example.com'
                            : 'https://…'
                        }
                      />
                      <IconButton
                        aria-label={`Remove ${Aglyn.authorLinkLabel(link)}`}
                        size="small"
                        onClick={() =>
                          setAuthorEditor((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  links: prev.links.filter(
                                    (_, i) => i !== index,
                                  ),
                                }
                              : prev,
                          )
                        }
                      >
                        <MdiIcon path={mdiClose.path} size={0.8} />
                      </IconButton>
                    </Stack>
                    {known ? null : (
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                        <TextField
                          size="small"
                          fullWidth
                          label="Label"
                          value={link.label ?? ''}
                          onChange={(event) =>
                            patch({ label: event.target.value })
                          }
                          helperText="What this link is called, e.g. Newsletter"
                        />
                        <IconSelectControl
                          value={link.icon ?? ''}
                          label="Icon"
                          // The id AND its path (AGL-1212): the catalog is
                          // loaded HERE and nowhere the card renders, so a
                          // renderer handed an id alone draws a help glyph.
                          onChange={(iconId) =>
                            patch({
                              icon: iconId,
                              iconPath: iconId ? getMdiIconPath(iconId) : '',
                            })
                          }
                        />
                      </Stack>
                    )}
                  </Stack>
                )
              })}
            </Stack>
            <Button
              size="small"
              sx={{ mt: 1 }}
              disabled={
                (authorEditor?.links?.length ?? 0) >= Aglyn.AUTHOR_LINKS_MAX
              }
              onClick={() =>
                setAuthorEditor((prev) =>
                  prev
                    ? { ...prev, links: [...prev.links, { url: '' }] }
                    : prev,
                )
              }
            >
              {'Add link'}
            </Button>
          </Box>
          <TextField
            label="Profile links"
            size="small"
            multiline
            minRows={2}
            value={authorEditor?.sameAs ?? ''}
            onChange={(event) =>
              setAuthorEditor((prev) =>
                prev ? { ...prev, sameAs: event.target.value } : prev,
              )
            }
            helperText={
              `One URL per line — emitted as schema.org sameAs, up to ` +
              `${Aglyn.AUTHOR_SAME_AS_MAX}.`
            }
          />
          <TextField
            label="Bio"
            size="small"
            multiline
            minRows={2}
            value={authorEditor?.bio ?? ''}
            onChange={(event) =>
              setAuthorEditor((prev) =>
                prev ? { ...prev, bio: event.target.value } : prev,
              )
            }
            helperText={
              'Shown beside the byline. Not structured data — a marketing ' +
              'sentence is not a schema.org description of a person.'
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAuthorEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            disabled={authorBusy || !authorEditor?.name?.trim()}
            onClick={handleSaveAuthor}
          >
            {authorBusy ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
      <MediaPickerDialog
        hostId={hostId}
        open={authorPickerOpen}
        onClose={() => setAuthorPickerOpen(false)}
        onPick={(media) => {
          // The author's portrait / logo (AGL-2486), stored as a `media:`
          // REFERENCE rather than the object's current location — an AGL-1215
          // folder move would 404 a raw URL permanently. The tenant resolves it
          // to an absolute URL for the JSON-LD with the same helper `og:image`
          // uses.
          const src = Aglyn.mediaNodeSrc(media)
          if (src) {
            setAuthorEditor((prev) => (prev ? { ...prev, image: src } : prev))
          }
          setAuthorPickerOpen(false)
        }}
      />
    </>
  )
}
CollectionEntriesPage.displayName = 'CollectionEntriesPage'

export default CollectionEntriesPage
