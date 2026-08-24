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
import { MEDIA_ALT_MAX_LENGTH } from '@aglyn/aglyn/app-utils/media-metadata'
import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn'
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
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
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
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { Box } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  useFirestore,
  useHostResourceApi,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import { useHostId, useHostSubdomain } from '../../../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'
import { hasEntitlement } from '../../../../../../constants/entitlements'
import useBranding from '../../../../../../hooks/use-branding'
import useCurrentOrg from '../../../../../../hooks/use-current-org'
import {
  CONTENT_MAX_WIDTH,
  TABLE_HEAD_HEIGHT,
} from '../../../../../../constants/shared'
import useFirestoreCollection from '../../../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../../../hooks/use-firestore-doc'
import useHostActivityLogger from '../../../../../../hooks/use-host-activity-logger'
import HubTabs from '../../../../../../components/hub-tabs.component'
import MediaPickerDialog from '../../../../../../components/media/media-picker-dialog.component'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '../../../../../../components/row-actions-menu.component'
import {
  applyCommandToSource,
  MARKDOWN_SOURCE_HINT,
  MarkdownEditorToolbar,
  MarkdownVisualEditor,
  type MarkdownEditorCommand,
  type MarkdownEditorContext,
  type MarkdownVisualEditorHandle,
} from '@aglyn/aglyn-markdown-editor'

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')

/**
 * Sentinel option in the entry editor's category Select (AGL-582) that
 * opens the Manage categories dialog instead of assigning a value.
 */
const MANAGE_CATEGORIES_VALUE = '__manage__'

/**
 * Entries tab id (AGL-2486); `/content?tab=entries` deep links land here.
 * The value the collection deep-link (`?collection=`) has always assumed.
 */
const ENTRIES_TAB_ID = 'entries'
/** Authors tab id (AGL-2486); `/content?tab=authors` deep links here. */
const AUTHORS_TAB_ID = 'authors'

/**
 * Sentinel option in the entry editor's Author Select (AGL-2486): publish
 * under a one-off byline typed on the entry instead of an author record.
 *
 * It exists for two reasons and both are back-compat. Every entry written
 * before this feature carries a free-typed `authorName` and nothing else, and
 * the Select has to be able to REPRESENT that state rather than silently
 * re-attributing the post the first time someone opens it. And a guest byline
 * used once is a legitimate thing not to want a record for.
 */
const CUSTOM_BYLINE_VALUE = '__custom__'


/**
 * Content collections manager (AGL-81): collections (e.g. Blog) with
 * entries the org serves at /{collectionSlug} and
 * /{collectionSlug}/{entrySlug}.
 */
/**
 * Every toolbar control is locked to one height (AGL-2486).
 *
 * A `TextField size="small"` is 40px and a `Button size="small"` is 30.8px,
 * so a select and a button placed on the same row with `alignItems: center`
 * agree about nothing: measured on `/content` the six controls came out
 * 40 / 83.8 / 83.8 / 30.8 / 53.5 / 53.5px tall with their tops spread over
 * 26.5px. Both control kinds now read their height from THIS constant, so
 * the row cannot drift apart again without someone editing one number.
 */
const TOOLBAR_CONTROL_HEIGHT = 40

/**
 * A row timestamp short enough to hold one line (AGL-2486).
 *
 * `toLocaleString()` renders `8/8/2026, 11:48:47 PM`, which wrapped to three
 * line boxes inside the ~100px column the table actually gave it and made
 * every row a different height. The exact instant is not lost — it moves to
 * the cell's `title`, which is where a precise value belongs when the column
 * is scanned for recency rather than read.
 */
const formatStampShort = (value: any): string => {
  const date = value?.toDate?.()
  if (!date) return '\u2014'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** The full instant behind `formatStampShort`, for the cell's tooltip. */
const formatStampFull = (value: any): string | undefined => {
  const date = value?.toDate?.()
  if (!date) return undefined
  return date.toLocaleString()
}

/**
 * A `Date` in the value shape `<input type="datetime-local">` accepts
 * (AGL-2497): LOCAL wall-clock, minute precision, no zone suffix.
 *
 * `toISOString()` is the obvious wrong answer — it converts to UTC, so the
 * input would open showing a different instant than the one it was seeded
 * with anywhere but Greenwich, and the editor would "correct" a date that was
 * already right.
 */
const toDateTimeLocalValue = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

const HostContent: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const firestore = useFirestore()
  // Help copy on this page names the product, and a white-label org must see
  // its own name rather than ours (AGL-2153).
  const { branding } = useBranding()
  // Entry creation is server-owned since AGL-2266 (the cap); every other
  // entry write on this page stays client-direct.
  const createResource = useHostResourceApi()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const logActivity = useHostActivityLogger(hostId)
  // Shared by the collection-create call (AGL-978) and AI assist below.
  const { data: user } = useUser()

  const { data: collectionDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'collections'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: hostDoc } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  /**
   * Custom content authors (AGL-2486): `hosts/{hostId}/authors`.
   *
   * Host-scoped for the reason the collections above are — the byline belongs
   * to the SITE that publishes it, resolves inside the same document tree the
   * entry lives in, and serialises alongside `host.seo.entity`, which is a
   * field of the host document. See `content-authors.ts`.
   *
   * Read unpaginated: `AUTHORS_MAX_PER_HOST` is the ceiling, and a masthead
   * that needs paging is not a masthead.
   */
  const { data: authorDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'authors'),
        limit(Aglyn.AUTHORS_MAX_PER_HOST),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const authors = useMemo<Aglyn.ContentAuthorRecord[]>(
    () =>
      (authorDocs ?? [])
        .map((item: any) => Aglyn.normalizeContentAuthor(item, item.$id))
        .filter((item): item is Aglyn.ContentAuthorRecord => Boolean(item))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [authorDocs],
  )
  // Entry-template screens (AGL-105): assignable per collection.
  const { data: screenDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const screenOptions = useMemo(
    () =>
      [...(screenDocs ?? [])]
        .filter((screen: any) => !screen.deletedAt)
        .sort((a: any, b: any) =>
          String(a.displayName ?? '').localeCompare(
            String(b.displayName ?? ''),
          ),
        ),
    [screenDocs],
  )
  // Template screens (AGL-105/551): /{collection} renders through the list
  // template, /{collection}/{entry} through the entry template; both go
  // through the normal published pipeline (theme + shared layout + tokens).
  //
  // Written through the API rather than with `updateDoc` (AGL-1390), and the
  // rules now deny the direct write. These three fields are the last exclusion
  // `countBillableScreens` makes that an editor can both apply and reverse:
  // pointing at a live screen drops it from the plan's screen allowance,
  // creating a screen spends the freed slot, and clearing the pointer leaves
  // the screen counted — one free page per cycle, and a create-time gate never
  // sees it. The route checks the cap against the state the write would leave,
  // so a clear that would put the site over is refused with the screen named.
  // Assigning and moving are unaffected: neither raises the count.
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
  // Live-entry links (AGL-123): custom domain first, subdomain fallback.
  const siteBase = Aglyn.hostPublicOrigin(hostDoc) ?? null
  // `collections` is shared with commerce's product collections (AGL-954) —
  // list only the content ones, or the catalog's rows show up here and
  // entries published under them are unreachable.
  const collections = useMemo(
    () =>
      (collectionDocs ?? [])
        .filter(Aglyn.isHostCollectionKind('content'))
        .sort((a, b) =>
          String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
        ),
    [collectionDocs],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Deep-link preselect (AGL-845): a `?collection=` param (e.g. from the DAM
  // "Used on" list) opens the content manager on that collection. Applied once,
  // only while nothing has been picked yet, so it never fights a later click.
  const searchParams = useSearchParams()
  const deepLinkCollection = searchParams?.get('collection') ?? null
  useEffect(() => {
    if (selectedId || !deepLinkCollection) return
    if (collections.some((item) => item.$id === deepLinkCollection)) {
      setSelectedId(deepLinkCollection)
    }
  }, [selectedId, deepLinkCollection, collections])
  const selected =
    collections.find((item) => item.$id === selectedId) ?? collections[0]

  const {
    data: entryDocs,
    /**
     * The seed the entry editor is populated from (AGL-1449). Both are fed
     * to `writeGuardedBySeed` in `handleSaveEntry` — read and dropped is how
     * a guard becomes decoration.
     */
    status: entriesStatus,
    fromCache: entriesFromCache,
  } = useFirestoreCollection<any>(
    () =>
      query(
        collection(
          firestore,
          'hosts',
          hostId,
          'collections',
          selected?.$id ?? '-none-',
          'entries',
        ),
        limit(200),
      ),
    [firestore, hostId, selected?.$id],
    { idField: '$id' },
  )
  const entries = useMemo(
    () =>
      [...(entryDocs ?? [])].sort(
        (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
      ),
    [entryDocs],
  )

  // Category taxonomy (AGL-582): `{ id, name }` pairs on the COLLECTION
  // doc. Entries reference the stable id, so renaming a category here
  // updates every post at render time without touching any entry.
  const categories = useMemo<Array<{ id: string; name: string }>>(
    () =>
      Array.isArray(selected?.categories)
        ? selected.categories.filter(
            (item: any) =>
              typeof item?.id === 'string' &&
              item.id.trim() !== '' &&
              typeof item?.name === 'string' &&
              item.name.trim() !== '',
          )
        : [],
    [selected],
  )
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  // Inline rename drafts keyed by category id; committed on blur.
  const [categoryDrafts, setCategoryDrafts] = useState<
    Record<string, string>
  >({})
  const persistCategories = useCallback(
    async (next: Array<{ id: string; name: string }>) => {
      if (!selected) return
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'collections', selected.$id),
        { categories: next },
      )
    },
    [selected, firestore, hostId],
  )
  const handleAddCategory = useCallback(async () => {
    const name = newCategoryName.trim()
    if (!name || categories.length >= Aglyn.COLLECTION_CATEGORIES_MAX) return
    // Stable id (AGL-582): slugified ONCE from the initial name and
    // uniqued; later renames never change it — that is the whole point.
    const base = slugify(name) || 'category'
    let categoryId = base
    for (
      let suffix = 2;
      categories.some((category) => category.id === categoryId);
      suffix += 1
    ) {
      categoryId = `${base}-${suffix}`
    }
    await persistCategories([...categories, { id: categoryId, name }])
    setNewCategoryName('')
  }, [newCategoryName, categories, persistCategories])
  const handleRenameCategory = useCallback(
    (categoryId: string) => async () => {
      const draft = (categoryDrafts[categoryId] ?? '').trim()
      setCategoryDrafts((prev) => {
        const rest = { ...prev }
        delete rest[categoryId]
        return rest
      })
      const current = categories.find(
        (category) => category.id === categoryId,
      )
      if (!current || !draft || draft === current.name) return
      // Rename updates the COLLECTION doc only — entries keep their ids.
      await persistCategories(
        categories.map((category) =>
          category.id === categoryId ? { ...category, name: draft } : category,
        ),
      )
    },
    [categoryDrafts, categories, persistCategories],
  )
  const handleDeleteCategory = useCallback(
    (category: { id: string; name: string }) => async () => {
      const confirmed = await confirm({
        title: `Delete "${category.name}"?`,
        description:
          'Entries assigned to this category keep their reference but ' +
          'will show no category until they are reassigned.',
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await persistCategories(
        categories.filter((item) => item.id !== category.id),
      )
    },
    [confirm, categories, persistCategories],
  )

  const [newCollectionOpen, setNewCollectionOpen] = useState(false)
  const [collectionName, setCollectionName] = useState('')
  // The slug is the collection's public address and nothing enforced
  // uniqueness (AGL-957): a second /blog made the first unreachable, silently.
  const collectionSlugOwner = useMemo(
    () =>
      Aglyn.findCollectionSlugOwner(
        slugify(collectionName),
        'content',
        collections,
      ),
    [collectionName, collections],
  )
  const handleCreateCollection = useCallback(async () => {
    const displayName = collectionName.trim()
    if (!displayName || collectionSlugOwner !== null) return
    // The slug is the collection's public address, so uniqueness is claimed
    // in a transaction server-side (AGL-978) — the check above is only the
    // fast feedback in this dialog. Rules deny a client create.
    let id: string
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
          action: 'create',
          kind: 'content',
          data: { displayName, slug: slugify(displayName) },
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.error ?? 'Collection create failed')
      id = String(result.id)
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'Collection create failed', {
        variant: 'error',
      })
    }
    setNewCollectionOpen(false)
    setCollectionName('')
    setSelectedId(id)
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
    collectionSlugOwner,
    user,
    hostId,
    enqueueSnackbar,
    logActivity,
  ])

  // Entry editor dialog state; null id = creating.
  const [editor, setEditor] = useState<{
    id: string | null
    title: string
    excerpt: string
    body: string
    coverImage: string
    /**
     * `og:image:alt` for the entry's share card (AGL-2417). Defaulted from
     * the chosen asset's own alt at pick time; blank stores nothing.
     */
    coverImageAlt: string
    // Entry model v2 (AGL-582): SEO overrides + taxonomy. Tags stay a
    // comma-separated STRING while editing; saved as string[].
    seoTitle: string
    seoDescription: string
    /**
     * Byline for THIS entry (AGL-686). Without it every post attributes to
     * the site itself, so `Article.author` was the same entity on every
     * entry — which is not what a byline means, and not what
     * Article/BlogPosting wants.
     */
    authorName: string
    /**
     * The author RECORD this entry publishes under (AGL-2486), or `''` for
     * the one-off byline in `authorName`. Empty with an empty `authorName`
     * means "the site", which is what `Article.author` falls back to.
     */
    authorId: string
    // Category taxonomy (AGL-582): entries reference the collection's
    // categories by stable id (lookup, not typed) so renames never touch
    // entries. `legacyCategory` is the old free-typed string, shown
    // read-only until a category is picked (which clears it on save).
    categoryId: string
    legacyCategory: string
    tags: string
  } | null>(null)
  // Media picker target: entry cover image or an inline body image.
  const [pickerTarget, setPickerTarget] = useState<
    'cover' | 'body' | 'authorImage' | null
  >(null)
  // Body editing mode (AGL-582): the WYSIWYG surface is the default; the
  // raw markdown textarea (with live preview) stays one tab away. Both
  // edit the same markdown-lite string, so switching re-parses/serializes.
  const [bodyTab, setBodyTab] = useState<'visual' | 'markdown'>('visual')
  const visualEditorRef = useRef<MarkdownVisualEditorHandle | null>(null)
  // Markdown toolbar (AGL-582): wraps the CURRENT SELECTION of the body
  // textarea instead of appending at the end.
  const bodyInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [bodyContext, setBodyContext] =
    useState<MarkdownEditorContext | null>(null)
  const applyMarkdown = useCallback((command: MarkdownEditorCommand) => {
    const input = bodyInputRef.current
    setEditor((prev) => {
      if (!prev) return prev
      const edit = applyCommandToSource(
        prev.body,
        input?.selectionStart ?? prev.body.length,
        input?.selectionEnd ?? prev.body.length,
        command,
      )
      requestAnimationFrame(() => {
        input?.focus()
        input?.setSelectionRange(edit.start, edit.end)
      })
      return { ...prev, body: edit.body }
    })
  }, [])
  // One toolbar, two surfaces (AGL-582): in the Visual tab commands mutate
  // the editor's block model; in the Markdown tab they wrap the textarea
  // selection as before.
  const handleToolbar = useCallback(
    (kind: MarkdownEditorCommand) => {
      if (bodyTab === 'visual') visualEditorRef.current?.exec(kind)
      else applyMarkdown(kind)
    },
    [bodyTab, applyMarkdown],
  )
  // AI assist (AGL-130): write or improve the markdown-lite body.
  const { org, orgId, ready: orgReady } = useCurrentOrg()
  const [aiInstruction, setAiInstruction] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const handleAiConfirm = useCallback(async () => {
    if (aiInstruction == null || !aiInstruction.trim() || aiBusy || !editor) {
      return
    }
    setAiBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          // The request NAMES the org it is metered against (AGL-2073) — the
          // route no longer resolves it from the signed-in user, because a
          // multi-org user's spend was landing on whichever org came back.
          orgId,
          hostId,
          mode: 'blog',
          title: editor.title,
          excerpt: editor.excerpt,
          text: editor.body,
          instruction: aiInstruction.trim(),
        }),
      })
      const payload = await response.json()
      // The blog editor's AI door, same pause notice as the designer
      // drawer (AGL-1532).
      const locked = parseLockdownRefusal(response.status, payload)
      if (locked) {
        return void enqueueSnackbar(lockdownRefusalText(locked), {
          variant: 'warning',
          persist: true,
        })
      }
      if (response.status === 501) {
        return void enqueueSnackbar(
          'AI assist is not configured on this deployment',
          { variant: 'info', persist: false },
        )
      }
      if (!response.ok || !payload?.text) {
        return void enqueueSnackbar(payload?.error ?? 'AI request failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      setEditor((prev) => (prev ? { ...prev, body: payload.text } : prev))
      setAiInstruction(null)
      enqueueSnackbar('Body updated — review before saving', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setAiBusy(false)
    }
  }, [aiInstruction, aiBusy, editor, user, enqueueSnackbar])
  // Scheduled publishing (AGL-123): entry id being scheduled + datetime.
  const [scheduler, setScheduler] = useState<{
    entry: any
    at: string
  } | null>(null)
  /**
   * Backdating (AGL-2497): the entry being re-dated + its datetime-local
   * value. Its own state beside `scheduler`, not a mode on it — see
   * `handleSetPublishDate` for why the two must not merge.
   */
  const [publishDate, setPublishDate] = useState<{
    entry: any
    at: string
  } | null>(null)

  /**
   * Opening the two date dialogs — ONE definition each, because AGL-2498
   * gave both a second caller.
   *
   * Scheduling used to be reachable only from the list row's overflow menu,
   * so somebody writing an entry had to close the editor, find the row and
   * open a different menu to decide when it went live. These controls now
   * appear in the editor as well, and the seeding is the part that must not
   * be copied: `publishAt` opens an hour out (a schedule is a FUTURE
   * instant), `publishedAt` opens on the entry's own date (a publication
   * date is a PAST one), and a hand-copied twin is how those two swap over
   * without anything failing loudly.
   */
  const openScheduler = useCallback((entry: any) => {
    const initial = new Date(Date.now() + 60 * 60 * 1000)
    initial.setMinutes(0, 0, 0)
    setScheduler({ entry, at: toDateTimeLocalValue(initial) })
  }, [])

  const openPublishDate = useCallback((entry: any) => {
    // The entry's OWN date when it has one, now when it does not — never a
    // zero. `publishedAt` is absent on a draft and `strictNullChecks` is off
    // repo-wide, so `(x?.seconds ?? 0) * 1000` would open on 1 Jan 1970 and
    // offer to store it (AGL-2497).
    const current = entry.publishedAt?.toDate?.() ?? new Date()
    setPublishDate({ entry, at: toDateTimeLocalValue(current) })
  }, [])

  const handleSaveEntry = useCallback(async () => {
    if (!editor || !selected) return
    const title = editor.title.trim()
    if (!title) return
    const id = editor.id ?? Aglyn.createResourceUid()
    const timestamp = Timestamp.now()
    /**
     * A NEW entry is created by the server (AGL-2266).
     *
     * `hosts/{h}/collections/{c}/entries/{e}` was the last client-direct
     * create with no cap on any plan — a free org could mint unbounded
     * Firestore documents from the browser — so the rules now deny client
     * `create` and /api/hosts/resources counts live rows against
     * `ENTRIES_MAX_PER_COLLECTION` inside the transaction that writes.
     *
     * Only the CREATE moves. The `setDoc(…, { merge: true })` below is
     * unchanged and still carries the whole payload; for a new entry it is now
     * an UPDATE of the draft the server just made, which the entries rule
     * block still grants an author. Splitting it that way is what keeps every
     * field the editor writes — including the `deleteField()` sentinels, which
     * do not survive a JSON hop to a route — on the one write that has always
     * owned them.
     *
     * `status`/`createdAt` are consequently NOT in the payload below any more:
     * the server stamps both, and an author (who may write but not publish) is
     * refused an update naming `status` at all.
     */
    if (!editor.id) {
      try {
        await createResource({
          hostId,
          resource: 'entry',
          parentId: selected.$id,
          id,
          data: { title, slug: slugify(title) },
        })
      } catch (error: any) {
        return void enqueueSnackbar(
          error?.message ?? 'Could not create the entry',
          { variant: 'error' },
        )
      }
    }
    /**
     * Never write an entry seeded from a read we cannot trust (AGL-1066,
     * AGL-1358, AGL-1449).
     *
     * The editor is populated from the entries LISTENER, and this write
     * carries every editor field — title, slug, excerpt, body, cover image,
     * both SEO fields, author, category and tags — so `merge: true` protects
     * none of them: they are all in the payload. A seed the server never
     * confirmed therefore does not lose one edit, it reverts the whole post
     * to whatever IndexedDB last held, over an author who fixed a typo.
     *
     * This used to be one inline `if` on the console's own `staleSession`
     * verdict, which is why AGL-1449 exists. It is the weakest of the three
     * signals and the wrong one to hand-roll: it needs two DISTINCT
     * collections denied inside 60s before it says anything, while
     * `fromCache` — the signal that actually catches a cache-served editor,
     * and the only one that is per-listener ground truth about the very read
     * this form was seeded from — was never consulted at all. That is the
     * AGL-1356 finding, repeated.
     */
    const verdict = await writeGuardedBySeed(
      {
        subject: 'entry',
        unreadable: entriesStatus === 'error',
        fromCache: entriesFromCache,
      },
      async () => {
        await setDoc(
          doc(
            firestore,
            'hosts',
            hostId,
            'collections',
            selected.$id,
            'entries',
            id,
          ),
          {
            title,
            slug: slugify(title),
            excerpt: editor.excerpt.trim(),
            body: editor.body,
            coverImage: editor.coverImage.trim(),
            // Removed rather than stored blank, and removed outright when the
            // cover is: an alt beside no image describes nothing, and an
            // `og:image:alt=""` asserts the image conveys nothing, which is
            // not what "nobody has described it" means (AGL-2417).
            ...(editor.coverImage.trim() && editor.coverImageAlt.trim()
              ? { coverImageAlt: editor.coverImageAlt.trim() }
              : { coverImageAlt: deleteField() }),
            // Entry model v2 (AGL-582): SEO overrides + taxonomy.
            seoTitle: editor.seoTitle.trim(),
            seoDescription: editor.seoDescription.trim(),
            /**
             * Byline, in BOTH shapes (AGL-2486).
             *
             * `authorId` is the reference and wins at render; `authorName` is
             * written beside it as the resolved name, and that denormalization
             * is deliberate rather than redundant. It is what keeps a byline
             * on the page when the author record is later deleted, when an
             * entry is restored from a bundle whose authors did not come with
             * it, and on any reader that has the entry but not the masthead —
             * `resolveEntryAuthor` falls through a dangling id to exactly this
             * field. The RECORD still wins whenever it exists, so renaming an
             * author updates every post at render time, unchanged.
             *
             * Choosing the custom byline clears the id rather than leaving a
             * stale one to win over what was just typed.
             */
            ...(editor.authorId
              ? { authorId: editor.authorId }
              : { authorId: deleteField() }),
            authorName: editor.authorName.trim(),
            // Category lookup (AGL-582): the entry stores the STABLE
            // categoryId; picking one clears the legacy free-typed field.
            // "None" only clears the id — the legacy value stays untouched so
            // simply re-saving an old entry never wipes its category.
            ...(editor.categoryId
              ? { categoryId: editor.categoryId, category: deleteField() }
              : { categoryId: deleteField() }),
            tags: editor.tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
            updatedAt: timestamp,
          },
          { merge: true },
        )
      },
    )
    if (!verdict.ok) {
      // The dialog stays open with what was typed, and nothing is logged as
      // an edit that did not happen.
      return void enqueueSnackbar(verdict.message, { variant: 'warning' })
    }
    setEditor(null)
    enqueueSnackbar(editor.id ? 'Entry saved' : 'Draft created', {
      variant: 'success',
      persist: false,
    })
    logActivity(editor.id ? 'Updated entry' : 'Created entry draft', {
      type: 'content',
      id,
      name: title,
    })
  }, [
    editor,
    selected,
    firestore,
    hostId,
    createResource,
    entriesStatus,
    entriesFromCache,
    enqueueSnackbar,
    logActivity,
  ])

  const handleTogglePublish = useCallback(
    (entry: any) => async () => {
      if (!selected) return
      const publish = entry.status !== 'published'
      await updateDoc(
        doc(
          firestore,
          'hosts',
          hostId,
          'collections',
          selected.$id,
          'entries',
          entry.$id,
        ),
        /**
         * Publishing stamps the instant only when the entry does not already
         * carry a date of its own (AGL-2497).
         *
         * `Timestamp.now()` used to be unconditional, so an entry's publish
         * date was always the moment somebody clicked this — which is what
         * made an imported archive tell Google every post in it went out on
         * migration day. `publishedAt` is the field `Article.datePublished`
         * is wired to, and this was one of the two writers that could reach
         * it; the other is the backdating dialog below.
         *
         * `??`, not a truthy test: an entry with no publish date has the
         * field ABSENT, and `strictNullChecks` is off repo-wide, so any
         * arithmetic fallback (`(x?.seconds ?? 0) * 1000`) would compile
         * clean and date the post to 1 Jan 1970. Three states stay distinct —
         * a real Timestamp, absent, and unpublished.
         *
         * There is no stale value to resurrect: unpublishing DELETES the
         * field, so publish → unpublish → publish stamps now, exactly as it
         * did before.
         */
        publish
          ? {
              status: 'published',
              publishedAt: entry.publishedAt ?? Timestamp.now(),
            }
          : { status: 'draft', publishedAt: deleteField() },
      )
      enqueueSnackbar(publish ? 'Entry published' : 'Entry unpublished', {
        variant: 'success',
        persist: false,
      })
      logActivity(publish ? 'Published entry' : 'Unpublished entry', {
        type: 'content',
        id: entry.$id,
        name: entry.title,
      })
    },
    [selected, firestore, hostId, enqueueSnackbar, logActivity],
  )

  const handleScheduleEntry = useCallback(async () => {
    if (!scheduler || !selected) return
    const publishAt = new Date(scheduler.at)
    if (Number.isNaN(publishAt.getTime()) || publishAt <= new Date()) {
      return enqueueSnackbar('Pick a future date/time', {
        variant: 'warning',
        persist: false,
      })
    }
    await updateDoc(
      doc(
        firestore,
        'hosts',
        hostId,
        'collections',
        selected.$id,
        'entries',
        scheduler.entry.$id,
      ),
      {
        status: 'scheduled',
        publishAt: Timestamp.fromDate(publishAt),
      },
    )
    enqueueSnackbar(`Scheduled for ${publishAt.toLocaleString()}`, {
      variant: 'success',
      persist: false,
    })
    logActivity('Scheduled entry', {
      type: 'content',
      id: scheduler.entry.$id,
      name: scheduler.entry.title,
    })
    setScheduler(null)
  }, [scheduler, selected, firestore, hostId, enqueueSnackbar, logActivity])

  /**
   * Setting an entry's publish date, in the PAST (AGL-2497).
   *
   * ## Why this is a second affordance and not a mode on the scheduler
   *
   * Backdating and scheduling are different features that happen to share a
   * concept. Folding them together means relaxing `handleScheduleEntry`'s
   * `<= new Date()` refusal, and after that "Schedule" silently accepts a
   * past instant that nothing will ever act on — the scheduler breaks and
   * says nothing. So the two guards here are COMPLEMENTARY and between them
   * tile the line with no gap and no overlap: this one refuses the future and
   * names where the future lives, `handleScheduleEntry` refuses the past,
   * unchanged.
   *
   * ## Why this needs no change to any tamper guard
   *
   * This is the ordinary client-direct entry update. The Firestore rules
   * already admit a `publishedAt` write on `canPublishHostContent(hostId)` —
   * admin or editor — and already refuse it to an `author`, and
   * /api/hosts/collections still refuses a client-supplied
   * `status`/`publishedAt`/`publishAt` because that route governs the
   * COLLECTION document and never touches an entry. Nothing here widens what
   * an arbitrary client may write. The field was always writable by an
   * authorised editor; what did not exist was a control that wrote it.
   *
   * ## What the write deliberately does NOT say
   *
   * It names exactly one field. Not `status` — re-dating is not publishing,
   * and a draft keeps its date to itself until somebody publishes it. Not
   * `updatedAt` — that is what `Article.dateModified` reads, and it has to go
   * on meaning "last edited" rather than "last re-dated". A one-field
   * `updateDoc` also cannot lose a sibling the way a defaulted converter over
   * a partial write can; entries carry no converter, and this keeps it true
   * regardless.
   */
  const handleSetPublishDate = useCallback(async () => {
    if (!publishDate || !selected) return
    const at = new Date(publishDate.at)
    // `new Date('')` is Invalid Date, not the epoch — and the NaN check is
    // what keeps it that way. An emptied input must reach no write at all.
    if (Number.isNaN(at.getTime())) {
      return enqueueSnackbar('Pick a date and time', {
        variant: 'warning',
        persist: false,
      })
    }
    if (at > new Date()) {
      return enqueueSnackbar(
        'A published date cannot be in the future — use Schedule for that',
        { variant: 'warning', persist: false },
      )
    }
    await updateDoc(
      doc(
        firestore,
        'hosts',
        hostId,
        'collections',
        selected.$id,
        'entries',
        publishDate.entry.$id,
      ),
      { publishedAt: Timestamp.fromDate(at) },
    )
    enqueueSnackbar(`Published date set to ${at.toLocaleString()}`, {
      variant: 'success',
      persist: false,
    })
    logActivity('Edited entry published date', {
      type: 'content',
      id: publishDate.entry.$id,
      name: publishDate.entry.title,
    })
    setPublishDate(null)
  }, [publishDate, selected, firestore, hostId, enqueueSnackbar, logActivity])

  const handleDeleteEntry = useCallback(
    (entry: any) => async () => {
      if (!selected) return
      const confirmed = await confirm({
        title: 'Delete this entry?',
        description: `"${entry.title}" will be permanently deleted.`,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await deleteDoc(
        doc(
          firestore,
          'hosts',
          hostId,
          'collections',
          selected.$id,
          'entries',
          entry.$id,
        ),
      )
      enqueueSnackbar('Entry deleted', { variant: 'success', persist: false })
      logActivity('Deleted entry', {
        type: 'content',
        id: entry.$id,
        name: entry.title,
      })
    },
    [selected, confirm, firestore, hostId, enqueueSnackbar, logActivity],
  )

  /**
   * Delete collection (AGL-1324). "New collection" existed and no delete
   * affordance did anywhere, so a mis-created collection was permanent.
   *
   * Admin-only like the site delete (`DeleteSiteCard`) — removing a
   * collection removes the /{slug} routes the site publishes, which is not
   * a content edit. The route re-checks the role; this only hides a control
   * that would 403.
   */
  const isSiteAdmin =
    hostDoc?.memberRoles?.[(user as any)?.uid] === 'admin'
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const screensById = useMemo(() => {
    const map: Record<string, Aglyn.CollectionTemplateScreen> = {}
    for (const screen of screenDocs ?? []) {
      map[(screen as any).$id] = {
        displayName: (screen as any).displayName,
        deletedAt: (screen as any).deletedAt,
      }
    }
    return map
  }, [screenDocs])
  /**
   * The same rule the route enforces, run here for fast feedback — so the
   * dialog can NAME what still depends on the collection instead of arming
   * a button that 409s. The server owns the truth: `entries` is capped at
   * 200 by the listener above, while the route counts them for real.
   */
  const deleteDenial = useMemo(
    () =>
      selected
        ? Aglyn.collectionDeleteDenial({
            displayName: selected.displayName ?? '',
            entryCount: entries.length,
            bindings: Aglyn.collectionTemplateBindings(selected, screensById),
          })
        : null,
    [selected, entries.length, screensById],
  )
  const handleDeleteCollection = useCallback(async () => {
    if (!selected || deleteBusy) return
    const name = selected.displayName ?? ''
    const deletedId = selected.$id
    setDeleteBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      // recursiveDelete is Admin-SDK-only and the rules deny a client delete
      // of a collection doc (AGL-947), so this goes through the shared erase
      // route — never a hand-rolled loop over `entries`.
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
          // Re-checked server-side (AGL-954): this surface must never be
          // able to erase a catalog collection, however stale its list is.
          collectionKind: 'content',
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(result?.error ?? 'Collection delete failed')
      }
    } catch (error: any) {
      setDeleteBusy(false)
      return void enqueueSnackbar(
        error?.message ?? 'Collection delete failed',
        { variant: 'error', allowDuplicate: true },
      )
    }
    setDeleteBusy(false)
    setDeleteOpen(false)
    setDeleteConfirm('')
    // Fall back to whatever the listener leaves behind, or the empty state.
    setSelectedId(null)
    enqueueSnackbar(`Collection "${name}" deleted`, {
      variant: 'success',
      persist: false,
    })
    logActivity('Deleted collection', {
      type: 'content',
      id: deletedId,
      name,
    })
  }, [selected, deleteBusy, user, hostId, enqueueSnackbar, logActivity])

  /* ── Authors (AGL-2486) ───────────────────────────────────────────────── */

  /**
   * The author being edited, or null. Mirrors the entry editor's shape: the
   * dialog owns a draft, `sameAs` stays a NEWLINE-SEPARATED string while
   * editing (one profile per line reads better than a comma soup of URLs) and
   * is saved as `string[]`.
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

  const openAuthor = useCallback((author?: Aglyn.ContentAuthorRecord) => {
    setAuthorEditor({
      id: author?.$id ?? null,
      // Stored as the numeric `HostEntityType`; held as a string here only
      // because a MUI Select value is one. `contentAuthorSchemaType` coerces
      // on the way back, which is the same helper that forgives the string
      // form the Setup → SEO → Entity form has always written.
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
    const isPerson =
      Number(authorEditor.type) === Aglyn.HostEntityType.PERSON
    const sameAs = authorEditor.sameAs
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, Aglyn.AUTHOR_SAME_AS_MAX)
    /**
     * The Person-only fields are dropped rather than stored when the author
     * is an Organization, and this is the branch rather than a cosmetic one:
     * `jobTitle` and `worksFor` are not defined on `schema.org/Organization`,
     * so carrying them would either publish invalid structured data or leave
     * a value that reappears the moment somebody flips the type back — a
     * field the editor cannot see and cannot clear.
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
         * mintable from the browser against a $0 subscription. The rules deny
         * the client create and /api/hosts/resources counts live rows against
         * `AUTHORS_MAX_PER_HOST` before writing.
         *
         * Unlike the entry there is no second write: an author carries no
         * `deleteField()` sentinels, so the route's field allow-list can hold
         * the whole payload.
         */
        await createResource({
          hostId,
          resource: 'author',
          data,
        })
      }
    } catch (error: any) {
      setAuthorBusy(false)
      return void enqueueSnackbar(
        error?.message ?? 'Could not save the author',
        { variant: 'error' },
      )
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
      await deleteDoc(
        doc(firestore, 'hosts', hostId, 'authors', String(author.$id)),
      )
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
   * Opening a blank entry editor, shared by the toolbar's primary button and
   * the zero-state's call to action (AGL-2486). It was inlined on the button
   * when there was only one way in.
   */
  const openNewEntry = useCallback(() => {
    setBodyTab('visual')
    setEditor({
      id: null,
      title: '',
      excerpt: '',
      body: '',
      coverImage: '',
      coverImageAlt: '',
      seoTitle: '',
      seoDescription: '',
      authorName: '',
      authorId: '',
      categoryId: '',
      legacyCategory: '',
      tags: '',
    })
  }, [])

  return (
    <>
      <DashboardLayout
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug,  host }),
          },
          {
            children: 'Content',
            href: buildRoute(Route.HOST_CONTENT, { orgSlug,  host }),
          },
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
              page already use — it owns the `?tab=` mirroring, the
              deep-linking and the small-screen collapse, so there is nothing
              here to get subtly different. */}
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
                    {/*
                      The control row used to do three unrelated jobs at once
                      (AGL-2486): pick a collection, configure that
                      collection's two template screens, and act on it. That
                      is why nothing lined up — a settings control carries
                      helper text and a button does not, so putting them on
                      one `alignItems: center` row guaranteed three different
                      heights and three different baselines. Measured: the six
                      controls were 40 / 83.8 / 83.8 / 30.8 / 53.5 / 53.5px
                      tall, and `New entry` and `Delete collection` wrapped
                      their own labels onto two lines at EVERY width down from
                      1800px, while `Categories` did not.

                      Split by job instead: a toolbar that chooses and acts,
                      and a disclosure that configures. Nothing was removed.
                    */}
                    {collections.length === 0 ? (
                      /*
                        Deliberately not `EmptyState` — that component brings
                        its own `CardDisplay`, and this one already sits
                        inside one. The framing differs; the language (icon,
                        h6 title, capped secondary copy, one call to action)
                        is the same on purpose.
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
                            '\u2014 a blog, a news feed, a case-study library. ' +
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
                          Toolbar: which collection, and what to do with it.
                          It WRAPS rather than overflowing, and every control
                          is pinned to `TOOLBAR_CONTROL_HEIGHT`, so the row
                          holds its baseline at any width.
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
                            value={selected?.$id ?? ''}
                            onChange={(event) =>
                              setSelectedId(event.target.value)
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
                              <MenuItem key={item.$id} value={item.$id}>
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
                            onClick={() => setCategoriesOpen(true)}
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
                            onClick={openNewEntry}
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
                          Collection settings: the two template screens and
                          the collection's own deletion. Both are things you
                          set up once and then leave alone, so they sit behind
                          a disclosure instead of competing with `New entry`
                          for the toolbar.
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
                                    The captions under these two selects used
                                    to read "drop a Collection Entries block"
                                    and "use {{entry.title}}, Entry Body" —
                                    true, but written for whoever built the
                                    feature, and long enough to wrap and shove
                                    the row's baseline around. The detail is
                                    kept, in the console's own `HelpTip`; the
                                    helper text below each select now answers
                                    the question an editor actually has, which
                                    is which URL the screen serves.
                                  */}
                                  <HelpTip
                                    title="Template screens"
                                    href={docsHelp('buildABlog').href}
                                    excerpt={
                                      'Leave either on the built-in themed ' +
                                      `page and ${branding.productName} ` +
                                      'renders it for you. To ' +
                                      'design your own: the list screen needs ' +
                                      'a Collection Entries block, and the ' +
                                      'entry screen can use {{entry.title}}, ' +
                                      'Entry Body and the entry\u2019s other ' +
                                      'fields.'
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
                                      selected?.slug ?? '\u2026'
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
                                      selected?.slug ?? '\u2026'
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
                                sitting next to `New entry` at the same size
                                and the same outlined weight, which is the one
                                arrangement guaranteed to make the destructive
                                action the easiest to hit by accident. It is
                                now behind this disclosure, below a rule, in
                                the lightest button variant there is, and it
                                still opens the type-the-name dialog.
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
                                        {`Permanently removes ${
                                          selected.displayName
                                        }, its /${
                                          selected.slug
                                        } route and every entry in it.`}
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
                              onClick={openNewEntry}
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
                                  than the title column ever got — and the
                                  table overflowed its container by 298px at
                                  900px and 448px at 700px.
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
                              {entries.map((entry) => {
                                // Row click opens the same editor the Edit
                                // action does, matching the artifact listings
                                // (AGL-698).
                                const openEntry = () => {
                                  setBodyTab('visual')
                                  setEditor({
                                    id: entry.$id,
                                    title: entry.title ?? '',
                                    excerpt: entry.excerpt ?? '',
                                    body: entry.body ?? '',
                                    coverImage: entry.coverImage ?? '',
                                    coverImageAlt: entry.coverImageAlt ?? '',
                                    seoTitle: entry.seoTitle ?? '',
                                    seoDescription: entry.seoDescription ?? '',
                                    authorName: entry.authorName ?? '',
                                    authorId: entry.authorId ?? '',
                                    categoryId: entry.categoryId ?? '',
                                    legacyCategory: entry.category ?? '',
                                    tags: Array.isArray(entry.tags)
                                      ? entry.tags.join(', ')
                                      : '',
                                  })
                                }
                                const published =
                                  entry.status === 'published'
                                /*
                                  Five equal text links (EDIT · UNPUBLISH ·
                                  SCHEDULE · VIEW · DELETE) put the one
                                  irreversible action a few pixels from the
                                  four routine ones. The console settled this
                                  in AGL-701: secondary and destructive row
                                  actions go in the overflow menu, which tints
                                  the destructive item and cannot be hit
                                  without opening it first.
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
                                    onClick: openEntry,
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
                                    onClick: () =>
                                      void handleTogglePublish(entry)(),
                                  },
                                  {
                                    key: 'published-date',
                                    /*
                                      Named in the PAST TENSE, and the whole
                                      point of the wording. `publishedAt`
                                      (when it went out) and `publishAt` (when
                                      it is due to) are one letter apart, and a
                                      "Publish date…" sitting beside
                                      "Schedule…" would be read as the same
                                      feature by anybody who had not written
                                      both. Every label in this dialog says
                                      PUBLISHED, every label in the scheduler
                                      says PUBLISH AT.
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
                                    label: 'Schedule\u2026',
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
                                  onClick: () =>
                                    void handleDeleteEntry(entry)(),
                                })
                                return (
                                  <TableRow
                                    key={entry.$id}
                                    hover
                                    onClick={openEntry}
                                    sx={{ cursor: 'pointer' }}
                                  >
                                    <TableCell sx={{ width: '100%' }}>
                                      {/*
                                        `anywhere` rather than a truncation:
                                        a slug is one long unbroken token and
                                        the default break rules cut it
                                        mid-word instead of wrapping it.
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
                                        full timestamp was the heaviest thing
                                        on a page of otherwise quiet rows, and
                                        it repeated identically down every
                                        one. The scheduled instant moves to
                                        the Published column, which is the
                                        column about when a thing goes live.
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
                                        '\u2014'
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
                        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
                          {'Bylines your entries can be published under — ' +
                            'they need not match the account that wrote the ' +
                            'post. Each one becomes the Article’s ' +
                            'schema.org author.'}
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
                                      hint about where a byline is in use, not
                                      a site-wide total it cannot know. */}
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
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'New collection'}</DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            value={collectionName}
            onChange={(event) => setCollectionName(event.target.value)}
            size="small"
            fullWidth
            autoFocus
            error={collectionSlugOwner !== null}
            helperText={
              collectionSlugOwner !== null
                ? `Another collection already serves /${slugify(collectionName)}`
                : collectionName.trim()
                  ? `Served at /${slugify(collectionName)}`
                  : 'e.g. Blog, News, Projects'
            }
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewCollectionOpen(false)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!collectionName.trim() || collectionSlugOwner !== null}
            onClick={handleCreateCollection}
          >
            {'Create'}
          </Button>
        </DialogActions>
      </Dialog>
      {/* Delete collection (AGL-1324). Type-the-name confirmation, matching
          the site delete. Refuses while a template screen still renders it
          or entries still live under it — naming which — because deleting a
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
          <Button
            disabled={deleteBusy}
            onClick={() => setDeleteOpen(false)}
          >
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
      {/* Category taxonomy manager (AGL-582): add / inline-rename /
          delete the collection's categories. Renames only touch the
          collection doc — entries keep their stable ids. */}
      <Dialog
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {`Categories${selected ? ` — ${selected.displayName}` : ''}`}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <Typography variant="body2" color="text.secondary">
            {'Entries reference categories by a stable id, so renaming ' +
              'one here updates every post — no entry is ever touched.'}
          </Typography>
          {categories.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No categories yet — add the first one below.'}
            </Typography>
          ) : (
            categories.map((category) => (
              <Stack
                key={category.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'flex-start' }}
              >
                <TextField
                  size="small"
                  fullWidth
                  value={categoryDrafts[category.id] ?? category.name}
                  onChange={(event) =>
                    setCategoryDrafts((prev) => ({
                      ...prev,
                      [category.id]: event.target.value,
                    }))
                  }
                  onBlur={handleRenameCategory(category.id)}
                  helperText={`id: ${category.id}`}
                />
                <Button
                  size="small"
                  color="error"
                  onClick={handleDeleteCategory(category)}
                >
                  {'Delete'}
                </Button>
              </Stack>
            ))
          )}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              size="small"
              fullWidth
              label="New category"
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleAddCategory()
                }
              }}
              helperText={
                categories.length >= Aglyn.COLLECTION_CATEGORIES_MAX
                  ? `Limit of ${Aglyn.COLLECTION_CATEGORIES_MAX} reached`
                  : newCategoryName.trim()
                    ? `id: ${slugify(newCategoryName) || 'category'}`
                    : 'e.g. Guides'
              }
            />
            <Button
              size="small"
              variant="contained"
              color="primary"
              disabled={
                !newCategoryName.trim() ||
                categories.length >= Aglyn.COLLECTION_CATEGORIES_MAX
              }
              onClick={handleAddCategory}
            >
              {'Add'}
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCategoriesOpen(false)}>{'Done'}</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>{editor?.id ? 'Edit entry' : 'New entry'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <TextField
            label="Title"
            value={editor?.title ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, title: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
            helperText={
              editor?.title.trim()
                ? `/${selected?.slug}/${slugify(editor.title)}`
                : undefined
            }
          />
          <TextField
            label="Excerpt"
            value={editor?.excerpt ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, excerpt: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              label="Cover image URL"
              value={editor?.coverImage ?? ''}
              onChange={(event) =>
                setEditor((prev) =>
                  prev ? { ...prev, coverImage: event.target.value } : prev,
                )
              }
              size="small"
              sx={{ flexGrow: 1 }}
            />
            <Button size="small" onClick={() => setPickerTarget('cover')}>
              {'Choose'}
            </Button>
          </Stack>
          {/*
            `og:image:alt` (AGL-2417). Shown only beside a cover, because a
            description with nothing to describe is a field nobody can
            answer. Pre-filled from the chosen asset's own alt and editable —
            this is the surface a customer shares most deliberately.
          */}
          {editor?.coverImage?.trim() ? (
            <TextField
              label="Cover image description"
              placeholder="What the picture shows"
              value={editor?.coverImageAlt ?? ''}
              onChange={(event) =>
                setEditor((prev) =>
                  prev
                    ? {
                        ...prev,
                        coverImageAlt: event.target.value.slice(
                          0,
                          MEDIA_ALT_MAX_LENGTH,
                        ),
                      }
                    : prev,
                )
              }
              size="small"
              helperText={
                'Read aloud by screen readers when this entry is shared.'
              }
            />
          ) : null}
          <Stack direction="row" spacing={1}>
            {/* Category is a LOOKUP (AGL-582): entries store the stable
                categoryId, names resolve at render — renames never touch
                posts. The legacy free-typed value shows until migrated. */}
            <TextField
              select
              label="Category"
              value={editor?.categoryId ?? ''}
              onChange={(event) => {
                const value = event.target.value
                if (value === MANAGE_CATEGORIES_VALUE) {
                  return void setCategoriesOpen(true)
                }
                setEditor((prev) =>
                  prev ? { ...prev, categoryId: value } : prev,
                )
              }}
              size="small"
              sx={{ flexGrow: 1 }}
              helperText={
                editor?.legacyCategory && !editor.categoryId
                  ? `Typed category "${editor.legacyCategory}" — pick one ` +
                    'to migrate this entry'
                  : 'Pick from this collection’s categories'
              }
            >
              <MenuItem value="">{'None'}</MenuItem>
              {categories.map((category) => (
                <MenuItem key={category.id} value={category.id}>
                  {category.name}
                </MenuItem>
              ))}
              {editor?.categoryId &&
              !categories.some(
                (category) => category.id === editor.categoryId,
              ) ? (
                // The referenced category was deleted: keep the Select
                // valid and let the author see (and move off) the id.
                <MenuItem value={editor.categoryId}>
                  {`${editor.categoryId} (deleted)`}
                </MenuItem>
              ) : null}
              <MenuItem value={MANAGE_CATEGORIES_VALUE}>
                {'Manage categories…'}
              </MenuItem>
            </TextField>
            <TextField
              label="Tags"
              value={editor?.tags ?? ''}
              onChange={(event) =>
                setEditor((prev) =>
                  prev ? { ...prev, tags: event.target.value } : prev,
                )
              }
              size="small"
              sx={{ flexGrow: 2 }}
              helperText="Comma-separated, e.g. nextjs, seo"
            />
          </Stack>
          {/* Byline (AGL-2486). A record, a one-off string, or the site —
              and the Select has to be able to say all three, because an
              entry written before this feature is in the middle state and
              opening its editor must not re-attribute it. */}
          <TextField
            select
            label="Author"
            value={
              editor?.authorId
                ? editor.authorId
                : editor?.authorName
                  ? CUSTOM_BYLINE_VALUE
                  : ''
            }
            onChange={(event) => {
              const value = event.target.value
              setEditor((prev) => {
                if (!prev) return prev
                if (value === CUSTOM_BYLINE_VALUE) {
                  // Keep whatever was typed; only drop the record reference.
                  return { ...prev, authorId: '' }
                }
                if (!value) return { ...prev, authorId: '', authorName: '' }
                return {
                  ...prev,
                  authorId: value,
                  // The resolved name travels with the id — see the save.
                  authorName:
                    authors.find((author) => author.$id === value)?.name ??
                    prev.authorName,
                }
              })
            }}
            size="small"
            helperText="Byline for this entry — falls back to the site entity"
          >
            <MenuItem value="">{'The site (publisher entity)'}</MenuItem>
            {authors.map((author) => (
              <MenuItem key={author.$id} value={author.$id}>
                {`${author.name} · ${Aglyn.contentAuthorSchemaType(author.type)}`}
              </MenuItem>
            ))}
            {editor?.authorId &&
            !authors.some((author) => author.$id === editor.authorId) ? (
              // The referenced author was deleted. Keep the Select valid and
              // show the id, exactly as the category Select does — the post
              // still renders (the stored name is the fallback), and the
              // editor can see what to move it off.
              <MenuItem value={editor.authorId}>
                {`${editor.authorId} (deleted)`}
              </MenuItem>
            ) : null}
            <MenuItem value={CUSTOM_BYLINE_VALUE}>
              {'Custom byline…'}
            </MenuItem>
          </TextField>
          {!editor?.authorId ? (
            <TextField
              label="Custom byline"
              value={editor?.authorName ?? ''}
              onChange={(event) =>
                setEditor((prev) =>
                  prev ? { ...prev, authorName: event.target.value } : prev,
                )
              }
              size="small"
              helperText={
                'A one-off name for this entry — published as a Person. ' +
                'Leave blank to attribute the piece to the site.'
              }
            />
          ) : null}
          <TextField
            label="SEO title"
            value={editor?.seoTitle ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, seoTitle: event.target.value } : prev,
              )
            }
            size="small"
            helperText="Search/social title — falls back to the title"
          />
          <TextField
            label="SEO description"
            value={editor?.seoDescription ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, seoDescription: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
            helperText="Meta description — falls back to the excerpt"
          />
          {/* One toolbar for both surfaces (AGL-984), including the
              Visual / Markdown switch. */}
          <MarkdownEditorToolbar
            onCommand={handleToolbar}
            context={bodyTab === 'visual' ? bodyContext : null}
            mode={bodyTab}
            onModeChange={setBodyTab}
          >
            <Button
              size="small"
              color="primary"
              onClick={() => {
                // The handler half of AGL-1380: `org` is undefined both in
                // flight and on a failed read, and `hasEntitlement` on an
                // undefined org answers NO — so clicking inside the loading
                // window told a Pro org the feature it pays for is not on
                // its plan. Pending declines and says so; only a loaded plan
                // may make the claim.
                if (!orgReady) {
                  return void enqueueSnackbar(
                    'Checking your plan — try again in a moment',
                    { variant: 'info', persist: false },
                  )
                }
                if (!hasEntitlement('aiAssist', org)) {
                  return void enqueueSnackbar(
                    'AI assist requires a Pro plan — see Billing to upgrade',
                    { variant: 'warning', persist: false },
                  )
                }
                setAiInstruction('')
              }}
            >
              {editor?.body?.trim() ? 'Improve with AI' : 'Write with AI'}
            </Button>
          </MarkdownEditorToolbar>
          <Box>
            {bodyTab === 'visual' ? (
              // WYSIWYG surface (AGL-582): the editor IS the preview — it
              // round-trips through the same markdown-lite parser/serializer
              // the tenant renders with. Raw markdown is an advanced escape
              // hatch behind the "Edit markdown" button, not a co-equal tab.
              <Box>
                <MarkdownVisualEditor
                  ref={visualEditorRef}
                  value={editor?.body ?? ''}
                  onChange={(body) =>
                    setEditor((prev) => (prev ? { ...prev, body } : prev))
                  }
                  // The editor's Insert image dialog hands off to the same
                  // media picker the "Insert image" button uses (AGL-596).
                  onPickImageFromMedia={() => setPickerTarget('body')}
                  onContextChange={setBodyContext}
                />
                <Stack
                  direction="row"
                  sx={{
                    mt: 0.5,
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                  }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="div"
                  >
                    {'Cmd/Ctrl+B bold · Cmd/Ctrl+I italic · Cmd/Ctrl+Z undo · ' +
                      'type "## ", "### " or "- " at a line start to convert'}
                  </Typography>
                </Stack>
              </Box>
            ) : (
              <Box>
                <TextField
                  label="Markdown source"
                  value={editor?.body ?? ''}
                  onChange={(event) =>
                    setEditor((prev) =>
                      prev ? { ...prev, body: event.target.value } : prev,
                    )
                  }
                  size="small"
                  multiline
                  minRows={14}
                  fullWidth
                  inputRef={bodyInputRef}
                  helperText={MARKDOWN_SOURCE_HINT}
                />
              </Box>
            )}
          </Box>
          {/*
            Publication controls, where the writing happens (AGL-2498).

            Zach: "We are also missing the ability schedule publishing on the
            content collections, only via the expanded menu on the list." All
            three controls existed and all three lived on the LIST row, so
            deciding when a post went live meant closing the editor, finding
            the row and opening a different menu.

            They are the SAME actions the row menu runs — `handleTogglePublish`,
            `openScheduler`, `openPublishDate`, shared rather than copied — so
            there is one behaviour with two doors, not two implementations to
            drift apart. They are deliberately NOT folded into the draft save
            below: publishing is an explicit act, and a Save button that also
            published would make every typo fix a publication event.

            Shown only for an entry that EXISTS. There is nothing to publish,
            schedule or date until the draft has been created, and offering it
            would write to an id no document answers to.

            ## The one-letter hazard, in the one place both dates are visible

            `publishedAt` (when it WENT live) and `publishAt` (when it is DUE
            to) differ by a single letter, and this is the first surface that
            shows both at once. So each row states its own tense — "Published"
            against a past instant, "Scheduled for" against a future one — and
            the two buttons are worded apart ("Edit published date" vs
            "Schedule"). They remain separate fields, separate dialogs and
            separate guards; only the doorway is shared.
          */}
          {editor?.id
            ? (() => {
                const current = entries.find(
                  (item: any) => item.$id === editor.id,
                )
                if (!current) return null
                const isPublished = current.status === 'published'
                const isScheduled =
                  current.status === 'scheduled' && current.publishAt
                return (
                  <>
                    <Divider sx={{ mt: 1 }} />
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                      }}
                    >
                      <Typography variant="subtitle2">
                        {'Publication'}
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Chip
                          size="small"
                          label={
                            isPublished
                              ? 'Published'
                              : isScheduled
                                ? 'Scheduled'
                                : 'Draft'
                          }
                          color={
                            isPublished
                              ? 'success'
                              : isScheduled
                                ? 'info'
                                : 'default'
                          }
                        />
                        <Typography variant="body2" color="text.secondary">
                          {isPublished
                            ? // PAST tense against `publishedAt` — the date
                              // the article claims, and what
                              // `Article.datePublished` carries (AGL-2497).
                              `Published ${formatStampFull(current.publishedAt) ?? '—'}`
                            : isScheduled
                              ? // FUTURE tense against `publishAt`. Naming
                                // the field's tense in the sentence is what
                                // keeps the two apart on screen.
                                `Scheduled for ${formatStampFull(current.publishAt) ?? '—'}`
                              : 'Not published yet'}
                        </Typography>
                      </Stack>
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ flexWrap: 'wrap' }}
                      >
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={
                            <MdiIcon
                              path={
                                isPublished
                                  ? mdiPublishOff.path
                                  : mdiPublish.path
                              }
                              size={0.8}
                            />
                          }
                          onClick={() => void handleTogglePublish(current)()}
                        >
                          {isPublished ? 'Unpublish' : 'Publish'}
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={
                            <MdiIcon path={mdiCalendarEdit.path} size={0.8} />
                          }
                          onClick={() => openPublishDate(current)}
                        >
                          {'Edit published date…'}
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={
                            <MdiIcon path={mdiCalendarClock.path} size={0.8} />
                          }
                          onClick={() => openScheduler(current)}
                        >
                          {'Schedule…'}
                        </Button>
                      </Stack>
                    </Box>
                  </>
                )
              })()
            : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!editor?.title.trim()}
            onClick={handleSaveEntry}
          >
            {editor?.id ? 'Save' : 'Create draft'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={aiInstruction != null}
        onClose={() => (aiBusy ? null : setAiInstruction(null))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {editor?.body?.trim() ? 'Improve with AI' : 'Write with AI'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <Typography variant="body2" color="text.secondary">
            {editor?.body?.trim()
              ? 'Describe how the body should change — tone, structure, length.'
              : 'Describe the post — the title and excerpt are included automatically.'}
          </Typography>
          <TextField
            label="Instruction"
            placeholder={
              editor?.body?.trim()
                ? 'e.g. Tighten it up and add a closing call to action'
                : 'e.g. A 500-word how-to with three practical tips'
            }
            value={aiInstruction ?? ''}
            onChange={(event) => setAiInstruction(event.target.value)}
            size="small"
            autoFocus
            multiline
            minRows={2}
            disabled={aiBusy}
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={aiBusy} onClick={() => setAiInstruction(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!aiInstruction?.trim() || aiBusy}
            onClick={handleAiConfirm}
          >
            {aiBusy ? 'Working…' : editor?.body?.trim() ? 'Improve' : 'Write'}
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
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
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
              onClick={() => setPickerTarget('authorImage')}
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
        open={pickerTarget != null}
        onClose={() => setPickerTarget(null)}
        onPick={(media) => {
          // ONE writer for the cover and the body (AGL-1705). The body used
          // to take the raw storage URL, and the comment here justified it:
          // the cover's readers resolve a reference and the body's renderers
          // did not. AGL-1686 taught all five markdown-lite renderers to
          // resolve, so the premise is gone and the exception with it.
          //
          // What the exception cost is exactly what AGL-1215 exists to stop:
          // `media.url` names the object's CURRENT LOCATION, so an AGL-1215
          // folder move — which copies the object, rewrites `url` and deletes
          // the original — 404s every body image permanently, and a replace
          // regenerates the embedded `&token=` and does it again.
          //
          // `mediaNodeSrc` keeps the free-tier behaviour unchanged: the
          // reference is derived from `cdnPath`, a paid `mediaCdn`
          // entitlement, and an org without one still degrades to `url`.
          const src = Aglyn.mediaNodeSrc(media)
          if (src) {
            // The asset's alt, through the one shared rule (AGL-1896).
            //
            // The `?? fileName` fallback that used to sit here is GONE, and
            // its removal is the point rather than a side effect. A file
            // name is not a description: "IMG_4021.jpg" announced by a
            // screen reader is worse than the silence it replaced, and this
            // editor is one of the surfaces where an image row's alt is
            // fixed at insert time and cannot be edited afterwards — so the
            // fabricated value was the one hardest to get rid of later.
            // An asset with no alt now inserts `![](src)`, which is the
            // honest "nobody has described this yet".
            const alt = Aglyn.inheritedMediaAlt({
              assetAlt: (media as any).alt,
            }) ?? ''
            if (pickerTarget === 'authorImage') {
              // The author's portrait / logo (AGL-2486). Through
              // `mediaNodeSrc` like every other pick on this page, so it is
              // stored as a `media:` REFERENCE rather than the object's
              // current location — an AGL-1215 folder move would 404 a raw
              // URL permanently. The tenant resolves it to an absolute URL
              // for the JSON-LD with the same helper `og:image` uses.
              setAuthorEditor((prev) => (prev ? { ...prev, image: src } : prev))
            } else if (pickerTarget === 'cover') {
              setEditor((prev) =>
                prev
                  ? {
                      ...prev,
                      coverImage: src,
                      // The asset's own alt, through the same shared rule the
                      // body insert above uses (AGL-1896/AGL-2417). An alt
                      // the author already wrote wins; an asset with no alt
                      // leaves the field empty and honest.
                      coverImageAlt:
                        Aglyn.inheritedMediaAlt({
                          placementAlt: prev.coverImageAlt,
                          assetAlt: (media as { alt?: unknown }).alt,
                        }) ?? prev.coverImageAlt,
                    }
                  : prev,
              )
            } else if (bodyTab === 'visual') {
              // Visual tab (AGL-582): insert as an image block at the caret
              // row; the editor serializes it back to ![alt](src).
              visualEditorRef.current?.insertImage(alt, src)
            } else {
              setEditor((prev) =>
                prev
                  ? { ...prev, body: `${prev.body}\n\n![${alt}](${src})` }
                  : prev,
              )
            }
          }
          setPickerTarget(null)
        }}
      />
      <Dialog
        open={Boolean(scheduler)}
        onClose={() => setScheduler(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Schedule entry'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Typography variant="body2" color="text.secondary">
            {'The entry goes live once the time passes (applied on the ' +
              'next site refresh).'}
          </Typography>
          <TextField
            size="small"
            type="datetime-local"
            label="Publish at"
            value={scheduler?.at ?? ''}
            onChange={(event) =>
              setScheduler((prev) =>
                prev ? { ...prev, at: event.target.value } : prev,
              )
            }
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScheduler(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!scheduler?.at}
            onClick={handleScheduleEntry}
          >
            {'Schedule'}
          </Button>
        </DialogActions>
      </Dialog>
      {/*
        Backdating (AGL-2497) — a SEPARATE dialog from Schedule above, and
        worded so the two cannot be mistaken for each other. Schedule is about
        a moment that has not happened; this is about what the entry claims
        about a moment that has.
      */}
      <Dialog
        open={Boolean(publishDate)}
        onClose={() => setPublishDate(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Edit published date'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Typography variant="body2" color="text.secondary">
            {'The date this entry says it WAS published — what search ' +
              'engines read as its publication date. Set it in the past to ' +
              'date posts brought over from another site correctly.'}
          </Typography>
          <TextField
            size="small"
            type="datetime-local"
            label="Published on"
            value={publishDate?.at ?? ''}
            onChange={(event) =>
              setPublishDate((prev) =>
                prev ? { ...prev, at: event.target.value } : prev,
              )
            }
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="To publish at a future time, use Schedule instead."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPublishDate(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!publishDate?.at}
            onClick={handleSetPublishDate}
          >
            {'Save published date'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
HostContent.displayName = 'Page:HostContent'

export default HostContent
