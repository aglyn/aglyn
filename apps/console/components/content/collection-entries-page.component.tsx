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
  mdiCalendarClock,
  mdiCalendarEdit,
  mdiChevronDown,
  mdiCogOutline,
  mdiDeleteOutline,
  mdiFileDocumentMultipleOutline,
  mdiOpenInNew,
  mdiPencilOutline,
  mdiPublish,
  mdiPublishOff,
} from '@aglyn/shared-data-mdi'
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
import { deleteDoc, doc, updateDoc } from 'firebase/firestore'
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
} from '../row-actions-menu.component'
import { docsHelp } from '../../constants/docs-links'
import { buildRoute, Route } from '../../constants/route-links'
import {
  collectionCreateBody,
  collectionTemplateBodies,
} from './collection-create-requests'
import {
  CONTENT_MAX_WIDTH,
  TABLE_HEAD_HEIGHT,
  TABLE_PAGE_SIZE_DEFAULT,
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
 * `…/content/{collectionSlug}`. It used to be one branch of a component that
 * also rendered the entry editor, which is what produced the flash Zach
 * reported: on a cold load of an entry URL that component had nothing else to
 * show while the entry arrived, so it showed this. It cannot any more — this
 * file does not know the entry editor exists.
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
    authors,
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
          const idToken = await (user as any)?.getIdToken?.()
          const response = await fetch('/api/hosts/collections', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({
              hostId,
              action: 'templates',
              id: collectionId,
              // `null` is the clear — `deleteField()` does not survive JSON,
              // and an empty string has meant cleared in older documents too.
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
          })
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
  const [collectionName, setCollectionName] = useState('')
  /**
   * The rest of what a collection IS, at the moment it is created (AGL-2498).
   *
   * Zach: *"New collections need more details to define when creating the
   * collection."* The dialog asked for a name and nothing else, while a
   * collection is defined by four things — its name, the ADDRESS it serves,
   * and the two screens that render its list and its entries. All three of the
   * others were settings-only, so every new collection was created and then
   * immediately opened to finish defining it.
   *
   * The address is the one that actually mattered. It is a live URL derived
   * from the name, and changing it later moves every entry beneath it — the
   * settings panel warns about exactly that — so the cheapest moment to get it
   * right is before anything is published under it.
   *
   * The template screens are offered, not required: both fall back to a
   * built-in themed page, which is what makes a collection render on the day
   * it is made. The docs teach the same order — create, write, then design the
   * pages — so an empty pair here is the expected answer, not a gap.
   */
  const [collectionSlug, setCollectionSlug] = useState('')
  /**
   * Whether the author has typed an address of their own.
   *
   * Until they do, the slug FOLLOWS the name, which is what makes the common
   * case one field. After they do, the name must never overwrite it — the same
   * rule the entry slug override follows.
   */
  const [collectionSlugTouched, setCollectionSlugTouched] = useState(false)
  const [collectionListScreen, setCollectionListScreen] = useState('')
  const [collectionEntryScreen, setCollectionEntryScreen] = useState('')
  const effectiveCollectionSlug = collectionSlugTouched
    ? slugify(collectionSlug)
    : slugify(collectionName)
  // The slug is the collection's public address and nothing enforced
  // uniqueness (AGL-957): a second /blog made the first unreachable, silently.
  const collectionSlugOwner = Aglyn.findCollectionSlugOwner(
    effectiveCollectionSlug,
    'content',
    collections,
  )
  const handleCreateCollection = useCallback(async () => {
    const displayName = collectionName.trim()
    const slug = effectiveCollectionSlug
    if (!displayName || !slug || collectionSlugOwner !== null) return
    // The slug is the collection's public address, so uniqueness is claimed in
    // a transaction server-side (AGL-978) — the check above is only the fast
    // feedback in this dialog. Rules deny a client create.
    let id: string
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/hosts/collections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
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
      return void enqueueSnackbar(error?.message ?? 'Collection create failed', {
        variant: 'error',
      })
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
      listScreenId: collectionListScreen,
      entryScreenId: collectionEntryScreen,
    })
    if (templateBodies.length) {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        await Promise.all(
          templateBodies.map((body) =>
            fetch('/api/hosts/collections', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
              },
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
    setCollectionName('')
    setCollectionSlug('')
    setCollectionSlugTouched(false)
    setCollectionListScreen('')
    setCollectionEntryScreen('')
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
    logActivity('Created collection', {
      type: 'content',
      id,
      name: displayName,
    })
  }, [
    collectionName,
    effectiveCollectionSlug,
    collectionSlugOwner,
    collectionListScreen,
    collectionEntryScreen,
    user,
    hostId,
    enqueueSnackbar,
    logActivity,
    claimNavigation,
    router,
    collectionHref,
  ])

  /**
   * EDITING a collection (AGL-2498).
   *
   * Zach: *"We seem to be missing the ability to edit the content
   * collections."*
   *
   * It was missing from the CONSOLE only — `/api/hosts/collections` has
   * answered `action: 'update'` since AGL-978, with `displayName` and `slug`
   * on its allow-list and the same transactional slug claim the create uses.
   * The route's own docblock says "Collection create/RENAME". Nothing ever
   * called the rename half, so a collection created as "Blg" stayed "Blg"
   * forever and the only way to fix a slug was to delete the collection and
   * every entry under it.
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
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/hosts/collections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
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
    logActivity('Updated collection', {
      type: 'content',
      id: selected.$id,
      name: displayName,
    })
  }, [
    editor,
    editorBusy,
    editorSlugOwner,
    selected,
    user,
    hostId,
    enqueueSnackbar,
    logActivity,
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
   * Entry pagination (AGL-693).
   *
   * The listener already caps at 200 entries — this is about the READING, not
   * the query: a collection with a hundred posts rendered as one uninterrupted
   * table, so the collection settings above it and the Authors tab beside it
   * were a scroll away from anything. Every other artifact list pages, and
   * this is the list with the most rows on it.
   *
   * Starts at `TABLE_PAGE_SIZE_DEFAULT` — the smallest option the console
   * offers, by the rule that every paginated list defaults to its minimum.
   */
  const [entryPage, setEntryPage] = useState(0)
  const [entriesPerPage, setEntriesPerPage] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const pagedEntries = useMemo(
    () =>
      entries.slice(
        entryPage * entriesPerPage,
        entryPage * entriesPerPage + entriesPerPage,
      ),
    [entries, entryPage, entriesPerPage],
  )
  /*
    Deleting the last entry on the last page, or switching to a shorter
    collection, would otherwise strand the reader past the end — an empty
    table with no control that says so. Clamp rather than reset: staying on
    page 3 of 4 is right; jumping home on every delete is not.
  */
  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(entries.length / entriesPerPage) - 1)
    if (entryPage > lastPage) setEntryPage(lastPage)
  }, [entryPage, entries.length, entriesPerPage])
  // A different collection is a different list; page 3 of the last one means
  // nothing here.
  useEffect(() => {
    setEntryPage(0)
  }, [selected?.$id])

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  /**
   * The same rule the route enforces, run here for fast feedback — so the
   * dialog can NAME what still depends on the collection instead of arming a
   * button that 409s. The server owns the truth: `entries` is capped at 200 by
   * the listener, while the route counts them for real.
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
      const idToken = await (user as any)?.getIdToken?.()
      // recursiveDelete is Admin-SDK-only and the rules deny a client delete of
      // a collection doc (AGL-947), so this goes through the shared erase route
      // — never a hand-rolled loop over `entries`.
      const response = await fetch('/api/resources/erase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
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
   * The author being edited, or null. `sameAs` stays a NEWLINE-SEPARATED
   * string while editing (one profile per line reads better than a comma soup
   * of URLs) and is saved as `string[]`.
   */
  const [authorEditor, setAuthorEditor] = useState<{
    id: string | null
    type: string
    name: string
    url: string
    image: string
    jobTitle: string
    worksFor: string
    sameAs: string
    bio: string
  } | null>(null)
  const [authorBusy, setAuthorBusy] = useState(false)
  const [authorPickerOpen, setAuthorPickerOpen] = useState(false)

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
      url: author?.url ?? '',
      image: author?.image ?? '',
      jobTitle: author?.jobTitle ?? '',
      worksFor: author?.worksFor ?? '',
      sameAs: (author?.sameAs ?? []).join('\n'),
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
      url: authorEditor.url.trim(),
      image: authorEditor.image.trim(),
      jobTitle: isPerson ? authorEditor.jobTitle.trim() : '',
      worksFor: isPerson ? authorEditor.worksFor.trim() : '',
      sameAs,
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
    logActivity(authorEditor.id ? 'Updated author' : 'Created author', {
      type: 'content',
      id: authorEditor.id ?? name,
      name,
    })
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
                        {entries.length === 0 ? (
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
                              {pagedEntries.map((entry) => {
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
                        {entries.length > 0 ? (
                          <TablePagination
                            component="div"
                            count={entries.length}
                            page={entryPage}
                            onPageChange={(_event, next) =>
                              setEntryPage(next)
                            }
                            rowsPerPage={entriesPerPage}
                            onRowsPerPageChange={(event) => {
                              setEntriesPerPage(
                                parseInt(event.target.value, 10),
                              )
                              setEntryPage(0)
                            }}
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
                                  {/* Counted off the SELECTED collection's
                                      loaded entries only — the listener holds
                                      one collection at a time, so this is a
                                      hint about where a byline is in use, not a
                                      site-wide total it cannot know. */}
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
      <Dialog
        open={newCollectionOpen}
        onClose={() => setNewCollectionOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{'New collection'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            label="Name"
            value={collectionName}
            onChange={(event) => setCollectionName(event.target.value)}
            size="small"
            fullWidth
            autoFocus
            helperText="Shown in the console; not published"
          />
          {/*
            The ADDRESS, editable here rather than only in settings
            (AGL-2498). It follows the name until it is typed in, so the
            common case is still one field — and it is worth getting right
            now, because changing it later moves every entry beneath it.
          */}
          <TextField
            label="Address"
            value={effectiveCollectionSlug}
            onChange={(event) => {
              setCollectionSlugTouched(true)
              setCollectionSlug(event.target.value)
            }}
            size="small"
            fullWidth
            error={collectionSlugOwner !== null}
            helperText={
              collectionSlugOwner !== null
                ? `Another collection already serves /${effectiveCollectionSlug}`
                : effectiveCollectionSlug
                  ? `Entries publish at /${effectiveCollectionSlug}/{entry}`
                  : 'e.g. blog, news, projects'
            }
          />
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">{'Template screens'}</Typography>
            <HelpTip
              title="Template screens"
              href={docsHelp('buildABlog').href}
              excerpt={
                'Leave either on the built-in themed page and ' +
                `${branding.productName} renders it for you. You can design ` +
                'your own later — the list screen needs a Collection Entries ' +
                'block, and the entry screen can use {{entry.title}}, Entry ' +
                'Body and the entry’s other fields.'
              }
            />
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            }}
          >
            <TextField
              select
              size="small"
              label="List screen"
              value={collectionListScreen}
              onChange={(event) =>
                setCollectionListScreen(event.target.value)
              }
              helperText={`Lists every entry at /${
                effectiveCollectionSlug || '…'
              }`}
            >
              <MenuItem value="">{'Built-in themed list'}</MenuItem>
              {screenOptions.map((screen: any) => (
                <MenuItem key={screen.$id} value={screen.$id}>
                  {screen.displayName ?? screen.$id}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Entry screen"
              value={collectionEntryScreen}
              onChange={(event) =>
                setCollectionEntryScreen(event.target.value)
              }
              helperText={`Renders one entry under /${
                effectiveCollectionSlug || '…'
              }`}
            >
              <MenuItem value="">{'Built-in themed article'}</MenuItem>
              {screenOptions.map((screen: any) => (
                <MenuItem key={screen.$id} value={screen.$id}>
                  {screen.displayName ?? screen.$id}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewCollectionOpen(false)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={
              !collectionName.trim() ||
              !effectiveCollectionSlug ||
              collectionSlugOwner !== null
            }
            onClick={handleCreateCollection}
          >
            {'Create'}
          </Button>
        </DialogActions>
      </Dialog>
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
            label="URL"
            size="small"
            value={authorEditor?.url ?? ''}
            onChange={(event) =>
              setAuthorEditor((prev) =>
                prev ? { ...prev, url: event.target.value } : prev,
              )
            }
            helperText="Author page or personal site"
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
                'avatar is a legitimate answer.'
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
