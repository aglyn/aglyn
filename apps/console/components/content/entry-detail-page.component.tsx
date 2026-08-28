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
import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn'
import {
  ICON_VARIANT_DATE_TIME,
  ICON_VARIANT_PRIMARY_KEY,
  ICON_VARIANT_TEXT,
} from '@aglyn/shared-data-enums'
import {
  mdiAccountOutline,
  mdiArrowLeft,
  mdiCalendarClock,
  mdiCalendarEdit,
  mdiChevronDown,
  mdiChevronUp,
  mdiClockOutline,
  mdiDeleteOutline,
  mdiFileDocumentMultipleOutline,
  mdiLinkVariant,
  mdiOpenInNew,
  mdiPublish,
  mdiPublishOff,
  mdiTagOutline,
} from '@aglyn/shared-data-mdi'
import {
  AppLink,
  CardDisplay,
  Container,
  GridItems,
  MdiIcon,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { deleteField, doc, setDoc } from 'firebase/firestore'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useFirestore,
  useHostResourceApi,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import {
  applyCommandToSource,
  MARKDOWN_SOURCE_HINT,
  MarkdownEditorToolbar,
  MarkdownVisualEditor,
  type MarkdownEditorCommand,
  type MarkdownEditorContext,
  type MarkdownVisualEditorHandle,
} from '@aglyn/aglyn-markdown-editor'
import EntryAnalyticsCard from '../analytics/entry-analytics-card.component'
import { useDeclareDocumentSubject } from '../document-subject'
import EntryCoverImageField from './entry-cover-image-field.component'
import HostDisplayNameComponent from '../host-display-name.component'
import DashboardLayout from '../layouts/dashboard.layout'
import MediaPickerDialog from '../media/media-picker-dialog.component'
import PluginWidgetSlot from '../plugin-widget-slot.component'
import { docsHelp } from '../../constants/docs-links'
import { hasEntitlement } from '../../constants/entitlements'
import { buildRoute, Route } from '../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../constants/shared'
import useCurrentOrg from '../../hooks/use-current-org'
import useHostActivityLogger from '../../hooks/use-host-activity-logger'
import {
  MANAGE_CATEGORIES_VALUE,
  collectionKey,
  formatStampFull,
  slugify,
  useContentScope,
} from './content-scope.context'

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
 * The two card widths on this page, as `GridItems masonry` reads them
 * (AGL-2498) — the same two values the screen detail page uses, so the two
 * pages read as one console rather than as two designs.
 *
 * ## Which side the WRITING goes on, and why it is the opposite of the screen
 *
 * On the screen detail page `SEO` is wide and `Basic Details` narrow, because
 * that page is a page ABOUT a document. This page IS the document: the entry
 * is written here, and the body editor is the reason anybody opens it. So
 * `Entry`, `Body` and `SEO` take the wide column and the metadata takes the
 * narrow one.
 *
 * ORDER inside a bucket is source order. The widths collapse with the viewport
 * — two equal columns at `md`, one at `xs` — so nothing ever spans more columns
 * than exist.
 */
/**
 * The PAGE's help affordance, beside the entry's title.
 *
 * It said `help="content"` — the generic "Templates, Blocks & Content"
 * overview — because that is what the collection list carries and the entry
 * editor was a branch of it. On a page that edits ONE post that is the wrong
 * answer twice over: it describes starting from a template gallery, and it is
 * the same tooltip the list already shows one click away.
 *
 * Every help affordance on this page now names its own subject and links to
 * its own section. They are not decoration — a tooltip that repeats its
 * neighbour teaches a reader to stop opening them.
 */
const ENTRY_PAGE_HELP = {
  topic: 'buildABlog',
  anchor: '#2-write-entries',
  title: 'Writing an entry',
  excerpt:
    'Title, address, excerpt, body and byline — and when it goes live. ' +
    'Everything on this page belongs to this one entry.',
} as const

const CARD_WIDE = { xs: 12, md: 6, lg: 8 } as const
const CARD_NARROW = { xs: 12, md: 6, lg: 4 } as const

/**
 * The entry editor's buffer (AGL-2498).
 *
 * Lifted out of the component because it is built in two places — a blank
 * draft and a seed from a stored entry — and it is also the value dirty
 * tracking compares against. A hand-copied twin of a fourteen-field seed is
 * how one door starts opening an editor that is missing a field, which then
 * SAVES that field blank over the stored one.
 */
type EntryEditorState = {
  /** `null` while creating — the entry has no document yet. */
  id: string | null
  title: string
  /**
   * The entry's own address segment (AGL-2498), overridable by the author.
   *
   * Deriving it — `slug: slugify(title)` on EVERY save — is two problems
   * wearing one coat: there is no way to choose an address, and, worse,
   * retitling a published post silently MOVES it. `/blog/our-launch` becomes
   * `/blog/our-launch-2026` because somebody tightened a headline, and every
   * inbound link, share and search result points at a 404 that nothing in the
   * console mentions.
   *
   * Held slugified-on-save rather than slugified-on-keystroke, so typing a
   * space in the middle of a slug does not eat the cursor.
   */
  slug: string
  excerpt: string
  body: string
  coverImage: string
  /**
   * `og:image:alt` for the entry's share card (AGL-2417). Defaulted from the
   * chosen asset's own alt at pick time; blank stores nothing.
   */
  coverImageAlt: string
  // Entry model v2 (AGL-582): SEO overrides + taxonomy. Tags stay a
  // comma-separated STRING while editing; saved as string[].
  seoTitle: string
  seoDescription: string
  /**
   * Byline for THIS entry (AGL-686). Without it every post attributes to the
   * site itself, so `Article.author` was the same entity on every entry.
   */
  authorName: string
  /**
   * The author RECORD this entry publishes under (AGL-2486), or `''` for the
   * one-off byline in `authorName`. Empty with an empty `authorName` means
   * "the site", which is what `Article.author` falls back to.
   */
  authorId: string
  // Category taxonomy (AGL-582): entries reference the collection's
  // categories by stable id (lookup, not typed) so renames never touch
  // entries. `legacyCategory` is the old free-typed string, shown read-only
  // until a category is picked (which clears it on save).
  categoryId: string
  legacyCategory: string
  tags: string
}

/** The buffer a brand-new draft starts from; `id: null` means "not created". */
const BLANK_ENTRY_EDITOR: EntryEditorState = {
  id: null,
  title: '',
  slug: '',
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
}

/**
 * Seeding the buffer from a stored entry — ONE definition.
 *
 * `legacyCategory` reads `entry.category` (the old free-typed string) while
 * `categoryId` reads the stable reference; they are different fields with
 * different names on both sides, which is exactly the pair a second copy gets
 * wrong.
 */
const editorStateForEntry = (entry: any): EntryEditorState => ({
  id: String(entry.$id),
  title: entry.title ?? '',
  // The STORED slug, and only falling back to the title for an entry written
  // before slugs were stored at all. Deriving it here would re-introduce the
  // silent move this field exists to stop.
  slug: entry.slug ?? slugify(entry.title ?? ''),
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
  tags: Array.isArray(entry.tags) ? entry.tags.join(', ') : '',
})

/**
 * Has the buffer diverged from what was loaded?
 *
 * Field-by-field over a known key set rather than a stringify, because the
 * body can be a long document and this runs on every keystroke. `null`
 * pristine (nothing open) is never dirty.
 */
const isEditorDirty = (
  editor: EntryEditorState | null,
  pristine: EntryEditorState | null,
): boolean => {
  if (!editor || !pristine) return false
  return (Object.keys(BLANK_ENTRY_EDITOR) as Array<keyof EntryEditorState>).some(
    (key) => editor[key] !== pristine[key],
  )
}

/**
 * ONE entry — its own route, its own component (AGL-2498).
 *
 * This renders at `…/content/{collectionSlug}/entries/{entryId}` and cannot
 * render the list at all — which is the point. A component that renders both
 * paints the list first on a cold load, because that is the only thing it can
 * paint while the entry is arriving. Here, the entry's own loading state shows
 * inside its own chrome, so the address and the page agree from the first
 * paint.
 *
 * The collection, the entries listener, the categories, the authors and the
 * screens come from `useContentScope()` — resolved once in the layout above
 * both routes, so splitting the pages did not duplicate the data layer.
 */
export function EntryDetailPage() {
  const scope = useContentScope()
  const {
    hostId,
    orgSlug,
    host,
    siteBase,
    selected,
    collectionsLoaded,
    entries,
    entriesStatus,
    entriesFromCache,
    categories,
    authors,
    contentHref,
    collectionHref,
    entryHref,
    togglePublish,
    deleteEntry,
    openScheduler,
    openPublishDate,
    openCategories,
  } = scope

  const params = useParams<{ entryId?: string }>()
  const entryId = (params?.entryId as string) || ''
  const isNewEntry = entryId === 'new'
  const router = useRouter()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const logActivity = useHostActivityLogger(hostId)
  const { data: user } = useUser()
  const { org, orgId, ready: orgReady } = useCurrentOrg()
  // Entry creation is server-owned since AGL-2266 (the cap); every other entry
  // write on this page stays client-direct.
  const createResource = useHostResourceApi()

  /** The STORED entry this page is about, or `null` for a new draft. */
  const stored = useMemo(
    () =>
      isNewEntry
        ? null
        : ((entries.find((item: any) => String(item.$id) === entryId) as any) ??
          null),
    [isNewEntry, entries, entryId],
  )

  /* ── the buffer ────────────────────────────────────────────────────── */

  const [editor, setEditor] = useState<EntryEditorState | null>(null)
  const pristineRef = useRef<EntryEditorState | null>(null)
  /** Which entryId the buffer currently answers to. */
  const seededForRef = useRef<string | null>(null)
  /**
   * Has the author taken the slug off auto (AGL-2498)?
   *
   * Component state rather than a buffer field, deliberately: it is a fact
   * about the SESSION, not about the entry, so it must not count as an unsaved
   * change. Putting it in `EntryEditorState` would make clicking into the slug
   * field mark a pristine post dirty and raise "discard unsaved changes?" on
   * the way out of a page nobody edited.
   */
  const [slugTouched, setSlugTouched] = useState(false)

  /**
   * Seeding, ONCE per entry.
   *
   * Claimed in `seededForRef` so a re-render — or the listener delivering a
   * newer snapshot of the same entry, which it does on every save anywhere —
   * cannot reset the buffer under someone who is typing.
   */
  useEffect(() => {
    if (seededForRef.current === entryId) return
    if (isNewEntry) {
      seededForRef.current = entryId
      pristineRef.current = { ...BLANK_ENTRY_EDITOR }
      setSlugTouched(false)
      setEditor({ ...BLANK_ENTRY_EDITOR })
      return
    }
    /*
      The listener has not answered yet, so the id is left UNCLAIMED and this
      runs again when `entries` arrives. Seeding a blank buffer here is how a
      pasted link opens an editor that then never fills — and an empty buffer
      over a real entry is one Save away from blanking the post.
    */
    if (!stored) return
    const next = editorStateForEntry(stored)
    seededForRef.current = entryId
    pristineRef.current = next
    /*
      The stored slug is already CUSTOM when it does not match what the title
      would produce, and in that case the title must never take it back. This
      is the whole reason the flag is seeded rather than reset: an author who
      set `/blog/launch` on "Announcing our 2026 launch" would otherwise lose
      it the moment they fixed a typo in the headline.
    */
    setSlugTouched(
      Boolean(stored.slug) && stored.slug !== slugify(stored.title ?? ''),
    )
    setEditor(next)
  }, [entryId, isNewEntry, stored])

  const editorDirty = useMemo(
    () => isEditorDirty(editor, pristineRef.current),
    [editor],
  )
  /**
   * Read from inside listeners that must not re-subscribe on every keystroke —
   * `beforeunload` needs the CURRENT answer, not the one captured when it was
   * registered.
   */
  const editorDirtyRef = useRef(false)
  editorDirtyRef.current = editorDirty

  /**
   * The one exit a router cannot mediate: reload, tab close, or a link out of
   * the console. `beforeunload` only counts while there is something to lose,
   * so a clean editor never nags.
   *
   * ⚠️ This is now the ONLY guard on a browser Back, and that is a deliberate
   * trade rather than an oversight. When the editor was a branch inside the
   * list component it could watch the address change and put it back; a real
   * route is unmounted by the router before it can object, and the App Router
   * exposes no navigation-blocking hook to replace that. Re-pushing from a
   * `popstate` listener is the usual workaround and it fights Next's own
   * popstate handling, which is a worse failure than the one it prevents.
   * Leaving deliberately — the button below — still asks.
   */
  useEffect(() => {
    if (!editorDirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [editorDirty])

  /* ── the slug ──────────────────────────────────────────────────────── */

  const publishedAlready = stored?.status === 'published'
  /**
   * The address that will actually be written: what the field holds, or the
   * title when it is empty. Slugified at the boundary so a pasted
   * `Hello World!` becomes `hello-world` rather than reaching Firestore.
   */
  const effectiveSlug = slugify(editor?.slug ?? '') || slugify(editor?.title ?? '')
  /**
   * Another entry in this collection already at that address, or null.
   *
   * The tenant resolves an entry with `where('slug','==',…)` and takes the
   * first match, so a duplicate makes one of the two simply unreachable. This
   * was unreachable-by-construction while the slug was derived; an editable
   * slug makes it reachable on purpose, so it has to be answerable.
   */
  const slugOwner = useMemo(
    () =>
      effectiveSlug
        ? Aglyn.findEntrySlugOwner(effectiveSlug, entries, editor?.id)
        : null,
    [effectiveSlug, entries, editor?.id],
  )
  const slugOwnerTitle = entries.find(
    (item: any) => String(item.$id) === slugOwner,
  )?.title

  /**
   * Typing a title.
   *
   * The slug FOLLOWS the title only while it is still on auto and the entry is
   * not published. Both halves matter: a published post's address is in the
   * wild and must never move because a headline was edited, and an author who
   * has taken the slug off auto has said what they want.
   */
  const handleTitleChange = useCallback(
    (value: string) => {
      setEditor((prev) => {
        if (!prev) return prev
        const follows = !slugTouched && !publishedAlready
        return {
          ...prev,
          title: value,
          ...(follows ? { slug: slugify(value) } : {}),
        }
      })
    },
    [slugTouched, publishedAlready],
  )

  /* ── save ──────────────────────────────────────────────────────────── */

  const handleSaveEntry = useCallback(async () => {
    if (!editor || !selected) return
    const title = editor.title.trim()
    if (!title) return
    if (!effectiveSlug) return
    if (slugOwner) {
      return void enqueueSnackbar(
        `Another entry already publishes at /${selected.slug}/${effectiveSlug}`,
        { variant: 'warning', persist: false },
      )
    }
    const id = editor.id ?? Aglyn.createResourceUid()
    const timestamp = Timestamp.now()
    /**
     * A NEW entry is created by the server (AGL-2266).
     *
     * `hosts/{h}/collections/{c}/entries/{e}` was the last client-direct
     * create with no cap on any plan — a free org could mint unbounded
     * Firestore documents from the browser — so the rules deny client `create`
     * and /api/hosts/resources counts live rows against
     * `ENTRIES_MAX_PER_COLLECTION` inside the transaction that writes.
     *
     * Only the CREATE moves. The `setDoc(…, { merge: true })` below is
     * unchanged and still carries the whole payload; for a new entry it is now
     * an UPDATE of the draft the server just made. Splitting it that way is
     * what keeps every field the editor writes — including the `deleteField()`
     * sentinels, which do not survive a JSON hop to a route — on the one write
     * that has always owned them.
     */
    if (!editor.id) {
      try {
        await createResource({
          hostId,
          resource: 'entry',
          parentId: selected.$id,
          id,
          data: { title, slug: effectiveSlug },
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
     * carries every editor field, so `merge: true` protects none of them: they
     * are all in the payload. A seed the server never confirmed therefore does
     * not lose one edit, it reverts the whole post to whatever IndexedDB last
     * held, over an author who fixed a typo.
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
            // The AUTHORED slug (AGL-2498), not `slugify(title)`. That
            // derivation is what silently moved a published post's address
            // whenever its headline was edited.
            slug: effectiveSlug,
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
             * it, and on any reader that has the entry but not the masthead.
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
      // The editor stays open with what was typed, and nothing is logged as an
      // edit that did not happen.
      return void enqueueSnackbar(verdict.message, { variant: 'warning' })
    }
    /**
     * A SAVED buffer is not a dirty one. Clearing the pristine snapshot before
     * leaving is what stops the guard asking "discard unsaved changes?" about
     * the write that just succeeded — and, worse, stops `beforeunload`
     * blocking the tab over changes already stored.
     */
    pristineRef.current = null
    seededForRef.current = null
    setEditor(null)
    router.push(collectionHref(collectionKey(selected)))
    enqueueSnackbar(editor.id ? 'Entry saved' : 'Draft created', {
      variant: 'success',
      persist: false,
    })
    // Updates only. A new entry's create rides /api/hosts/resources, which
    // logs it server-side from a verified uid (AGL-118); logging it here too
    // would put two rows on one act. The update is a client-direct write with
    // no route in front of it, so this call is still the only record of it.
    if (editor.id) {
      logActivity('Updated entry', { type: 'content', id, name: title })
    }
  }, [
    editor,
    selected,
    effectiveSlug,
    slugOwner,
    firestore,
    hostId,
    createResource,
    entriesStatus,
    entriesFromCache,
    enqueueSnackbar,
    logActivity,
    router,
    collectionHref,
  ])

  /**
   * Leaving the editor — the guard the dialog never had (AGL-2498).
   *
   * `onClose` was a bare `setEditor(null)`: no dirty tracking, no
   * confirmation. On a routed detail page that omission gets WORSE rather than
   * staying neutral, so the conversion had to BUILD the guard; there was
   * nothing to preserve.
   */
  const closeEditor = useCallback(async () => {
    if (editorDirtyRef.current) {
      const ok = await confirm({
        title: 'Discard unsaved changes?',
        description:
          'This entry has edits that have not been saved yet. Leaving now ' +
          'discards them.',
      })
      if (!ok) return
    }
    pristineRef.current = null
    seededForRef.current = null
    setEditor(null)
    router.push(selected ? collectionHref(collectionKey(selected)) : contentHref)
  }, [confirm, router, selected, collectionHref, contentHref])

  /**
   * Deleting from this page.
   *
   * `deleteEntry` is the scope's — shared with the list row's menu, so there
   * is one confirmation, one write and one activity record. What is different
   * here is what happens AFTER: this page is displaying the document that just
   * stopped existing, so it has to leave, and it must NOT ask "discard unsaved
   * changes?" on the way — an absurd question about a post that has just been
   * permanently deleted, and answering "no" would strand the editor on a dead
   * id, one Save away from re-creating it.
   */
  const handleDeleteFromDetail = useCallback(async () => {
    if (!stored) return
    const deleted = await deleteEntry(stored)
    if (!deleted) return
    pristineRef.current = null
    seededForRef.current = null
    setEditor(null)
    router.push(selected ? collectionHref(collectionKey(selected)) : contentHref)
  }, [stored, deleteEntry, router, selected, collectionHref, contentHref])

  /* ── body editing ──────────────────────────────────────────────────── */

  const [pickerTarget, setPickerTarget] = useState<'cover' | 'body' | null>(
    null,
  )
  // Body editing mode (AGL-582): the WYSIWYG surface is the default; the raw
  // markdown textarea stays one tab away. Both edit the same markdown-lite
  // string, so switching re-parses/serializes.
  const [bodyTab, setBodyTab] = useState<'visual' | 'markdown'>('visual')
  const visualEditorRef = useRef<MarkdownVisualEditorHandle | null>(null)
  const bodyInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [bodyContext, setBodyContext] = useState<MarkdownEditorContext | null>(
    null,
  )
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
  // One toolbar, two surfaces (AGL-582): in the Visual tab commands mutate the
  // editor's block model; in the Markdown tab they wrap the textarea selection.
  const handleToolbar = useCallback(
    (kind: MarkdownEditorCommand) => {
      if (bodyTab === 'visual') visualEditorRef.current?.exec(kind)
      else applyMarkdown(kind)
    },
    [bodyTab, applyMarkdown],
  )

  // AI assist (AGL-130): write or improve the markdown-lite body.
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
      // The blog editor's AI door, same pause notice as the designer drawer
      // (AGL-1532).
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
  }, [aiInstruction, aiBusy, editor, user, orgId, hostId, enqueueSnackbar])

  /* ── derived, for the panels ───────────────────────────────────────── */

  const entryIsPublished = stored?.status === 'published'
  const entryIsScheduled =
    stored?.status === 'scheduled' && Boolean(stored?.publishAt)
  /**
   * The entry's address on the published site.
   *
   * Built from the STORED slug, not from the buffer. They differ exactly when
   * somebody has edited the slug without saving — and in that window the typed
   * one names a page that does not exist, which would send the traffic card
   * looking up a path nobody has ever visited and report a read post as zero.
   */
  const entryPublicPath =
    selected && stored?.slug ? `/${selected.slug}/${stored.slug}` : null
  /** The absolute link, and only while the entry is actually reachable. */
  const entryLiveUrl =
    siteBase && entryPublicPath && entryIsPublished
      ? `${siteBase}${entryPublicPath}`
      : null
  /** `Raw JSON` is closed until asked for — see the card. */
  const [rawJsonOpen, setRawJsonOpen] = useState(false)

  const headerTitle = isNewEntry
    ? 'New entry'
    : editor?.title.trim() || stored?.title || 'Untitled entry'

  /**
   * WHICH entry this tab is about (AGL-2486).
   *
   * `entries/[entryId]/layout.tsx` paints `dR3GYhkZS1 · Entry · aglyn-marketing`
   * from the server, because `generateMetadata` runs where the console has no
   * authorization to spend and a server-rendered entry title would be readable
   * by anyone who can guess a URL. This is the client half: it swaps the id for
   * the loaded name in place.
   *
   * The BUFFER's title, not the stored one, so a retitle reaches the tab as it
   * is typed — the same way it reaches the header and the breadcrumb.
   *
   * ⚠️ `undefined` while the entry is still arriving — NOT `headerTitle`,
   * which falls back to "Untitled entry". `renameTitleSubject` is a PREFIX
   * match against the id the server painted, so the FIRST rename that lands
   * wins and every later one matches nothing: publishing the fallback pinned
   * the tab to "Untitled entry · Entry · …" for the rest of the session. The
   * hook is built for exactly this — "a name we do not have yet is not a
   * subject".
   */
  useDeclareDocumentSubject(
    entryId,
    isNewEntry
      ? 'New entry'
      : editor?.title.trim() || stored?.title || undefined,
  )

  /**
   * Everything recorded ABOUT the entry, in one list (AGL-2498).
   *
   * Created, published, scheduled and updated are all stored on the entry, and
   * all four belong on the page that writes them: an author who sets a
   * published date in a dialog otherwise has nowhere to read it back.
   *
   * `publishAt` appears only while the entry is SCHEDULED. Showing it always
   * would put a stale future instant beside a published post, one letter away
   * from the date it actually claims.
   */
  const entryDetails = useMemo(
    () => [
      {
        key: 'id',
        primary: 'Entry ID:',
        secondary: stored?.$id ?? 'Not created yet',
        icon: ICON_VARIANT_PRIMARY_KEY.path,
      },
      {
        key: 'address',
        primary: 'Address:',
        secondary: entryPublicPath ?? 'Save the entry to give it one',
        icon: mdiLinkVariant.path,
      },
      {
        key: 'collection',
        primary: 'Collection:',
        secondary: selected
          ? `${selected.displayName} (/${selected.slug})`
          : '',
        icon: mdiFileDocumentMultipleOutline.path,
      },
      {
        key: 'byline',
        primary: 'Byline:',
        secondary:
          authors.find((author) => author.$id === editor?.authorId)?.name ||
          editor?.authorName ||
          'The site (publisher entity)',
        icon: mdiAccountOutline.path,
      },
      {
        key: 'taxonomy',
        primary: 'Category and tags:',
        secondary:
          [
            categories.find((category) => category.id === editor?.categoryId)
              ?.name ||
              editor?.legacyCategory ||
              '',
            editor?.tags?.trim() ?? '',
          ]
            .filter(Boolean)
            .join(' · ') || 'None',
        icon: mdiTagOutline.path,
      },
      {
        key: 'created',
        primary: 'Date created:',
        secondary: formatStampFull(stored?.createdAt),
        icon: ICON_VARIANT_DATE_TIME.path,
      },
      {
        key: 'updated',
        primary: 'Last updated:',
        secondary: formatStampFull(stored?.updatedAt),
        icon: ICON_VARIANT_TEXT.path,
      },
      {
        key: 'published',
        primary: 'Date published:',
        secondary: formatStampFull(stored?.publishedAt),
        icon: ICON_VARIANT_DATE_TIME.path,
      },
      ...(entryIsScheduled
        ? [
            {
              key: 'scheduled',
              primary: 'Scheduled for:',
              secondary: formatStampFull(stored?.publishAt),
              icon: mdiClockOutline.path,
            },
          ]
        : []),
    ],
    [
      stored,
      entryPublicPath,
      entryIsScheduled,
      selected,
      authors,
      categories,
      editor?.authorId,
      editor?.authorName,
      editor?.categoryId,
      editor?.legacyCategory,
      editor?.tags,
    ],
  )

  const breadcrumbItems = [
    {
      children: <HostDisplayNameComponent hostId={hostId} />,
      href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
    },
    { children: 'Content', href: contentHref },
    // The COLLECTION is a crumb of its own since AGL-2498 gave it an address.
    // It could not be one while it lived in a query parameter — a crumb that
    // cannot be clicked is a label.
    ...(selected
      ? [
          {
            children: selected.displayName ?? selected.$id,
            href: collectionHref(collectionKey(selected)),
          },
        ]
      : []),
    { children: headerTitle, href: entryHref(entryId) },
  ]

  /**
   * The entry has not arrived yet.
   *
   * THIS is the state that replaces the flash. The old component had nothing
   * to show here so it showed the list — the address said "entry" and the page
   * said "collection" until Firestore answered. A separate route can show its
   * own chrome with a progress bar in it, which is both honest and stable: the
   * header, the breadcrumb and the page identity never change underneath the
   * reader.
   */
  if (!editor) {
    const settled = collectionsLoaded && entriesStatus !== 'loading'
    return (
      <DashboardLayout
        breadcrumbItems={breadcrumbItems}
        help={ENTRY_PAGE_HELP}
        header={{
          children: settled ? 'Entry not found' : 'Loading entry…',
          icon: { path: mdiFileDocumentMultipleOutline.path },
        }}
        headerRight={
          <Button
            size="small"
            startIcon={<MdiIcon path={mdiArrowLeft.path} size={0.8} />}
            onClick={() =>
              router.push(selected ? collectionHref(collectionKey(selected)) : contentHref)
            }
          >
            {'Back to entries'}
          </Button>
        }
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <CardDisplay
            header={'Entry'}
            help={ENTRY_PAGE_HELP}
            contentGutterX
            contentGutterY
          >
            {settled ? (
              <Typography variant="body2" color="text.secondary">
                {'This entry is not in this collection. It may have been ' +
                  'deleted, or the link may name an entry from a different ' +
                  'collection.'}
              </Typography>
            ) : (
              <LinearProgress />
            )}
          </CardDisplay>
        </Container>
      </DashboardLayout>
    )
  }

  return (
    <>
      <DashboardLayout
        breadcrumbItems={breadcrumbItems}
        help={ENTRY_PAGE_HELP}
        header={{
          children: headerTitle,
          icon: { path: mdiFileDocumentMultipleOutline.path },
        }}
        headerRight={
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            {editorDirty ? (
              <Chip size="small" color="warning" label="Unsaved changes" />
            ) : null}
            {/* Only for an entry that is actually reachable. A draft has no
                live address, and an outlined button pointing at a 404 is worse
                than an absent one. */}
            {entryLiveUrl ? (
              <AppLink
                componentVariant="button"
                size="small"
                variant="outlined"
                href={entryLiveUrl}
                target="_blank"
                rel="noreferrer"
                startIcon={<MdiIcon path={mdiOpenInNew.path} size={0.8} />}
              >
                {'View'}
              </AppLink>
            ) : null}
            {stored ? (
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<MdiIcon path={mdiDeleteOutline.path} size={0.8} />}
                onClick={() => void handleDeleteFromDetail()}
              >
                {'Delete'}
              </Button>
            ) : null}
            <Button
              size="small"
              startIcon={<MdiIcon path={mdiArrowLeft.path} size={0.8} />}
              onClick={() => void closeEditor()}
            >
              {'Back to entries'}
            </Button>
            {/*
              The ONE save control on the page (AGL-2498).

              It used to sit at the foot of the single card that held every
              field. There is no single foot any more — the fields are spread
              across `Entry`, `Body`, `SEO` and `Cover image` — so a footer
              button would belong to whichever card the masonry happened to put
              last, which is a different card at every breakpoint. In the header
              it is in the same place at every width, visible without scrolling
              past a body that can be thousands of words long, and there is
              still exactly one control with the accessible name "Save".
            */}
            <Button
              variant="contained"
              size="small"
              color="primary"
              disabled={
                !editor.title.trim() || !effectiveSlug || slugOwner !== null
              }
              onClick={handleSaveEntry}
            >
              {editor.id ? 'Save' : 'Create draft'}
            </Button>
          </Stack>
        }
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            masonry
            items={[
              {
                size: CARD_WIDE,
                children: (
                  <CardDisplay
                    header={'Entry'}
                    help={docsHelp('buildABlog', {
                      anchor: '#2-write-entries',
                      title: 'Title, address and byline',
                      excerpt:
                        'What the entry is called, where it publishes, and ' +
                        'who it is published under.',
                    })}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <Stack spacing={2}>
                      <TextField
                        label="Title"
                        value={editor.title}
                        onChange={(event) =>
                          handleTitleChange(event.target.value)
                        }
                        size="small"
                        autoFocus
                      />
                      {/*
                        The slug is an editable FIELD, not a derivation
                        (AGL-2498). It seeds from the title, but once
                        `slugTouched` is set the title stops driving it.

                        Deriving it on every save would mean a published entry
                        MOVES whenever it is retitled, 404-ing every inbound
                        link, with nothing on this page to say the address had
                        changed.
                      */}
                      <TextField
                        label="Slug"
                        value={editor.slug}
                        onChange={(event) => {
                          setSlugTouched(true)
                          setEditor((prev) =>
                            prev ? { ...prev, slug: event.target.value } : prev,
                          )
                        }}
                        size="small"
                        error={slugOwner !== null}
                        helperText={
                          slugOwner !== null
                            ? `Already used by "${slugOwnerTitle ?? slugOwner}" — two entries at one address means one of them is unreachable`
                            : effectiveSlug
                              ? // "Publishes at", present tense, deliberately.
                                // A draft is not published, so "Published at"
                                // would assert something false about half the
                                // entries that see this field — and it read as
                                // the Publication card's own "Published …"
                                // status line, which is a different claim.
                                `Publishes at /${selected?.slug ?? '…'}/${effectiveSlug}`
                              : 'Taken from the title until you change it'
                        }
                        slotProps={{
                          input: {
                            endAdornment:
                              // Only once it has actually diverged, and only
                              // where putting it back is safe: on a published
                              // entry this button would move a live URL, which
                              // is the thing the field exists to prevent.
                              slugTouched &&
                              !publishedAlready &&
                              effectiveSlug !== slugify(editor.title) ? (
                                <Button
                                  size="small"
                                  onClick={() => {
                                    setSlugTouched(false)
                                    setEditor((prev) =>
                                      prev
                                        ? { ...prev, slug: slugify(prev.title) }
                                        : prev,
                                    )
                                  }}
                                >
                                  {'Reset'}
                                </Button>
                              ) : null,
                          },
                        }}
                      />
                      {/*
                        Said out loud on the surface where it matters. An
                        author retitling a live post has no way to know the
                        address stopped following, and "why didn't the URL
                        change" is a better question to answer here than
                        "why did every link break".
                      */}
                      {publishedAlready ? (
                        <Typography variant="caption" color="text.secondary">
                          {'This entry is published, so its address no longer ' +
                            'follows the title — editing the slug moves a live ' +
                            'URL and breaks links already pointing at it.'}
                        </Typography>
                      ) : null}
                      <TextField
                        label="Excerpt"
                        value={editor.excerpt}
                        onChange={(event) =>
                          setEditor((prev) =>
                            prev
                              ? { ...prev, excerpt: event.target.value }
                              : prev,
                          )
                        }
                        size="small"
                        multiline
                        minRows={2}
                      />
                      <Stack direction="row" spacing={1}>
                        {/* Category is a LOOKUP (AGL-582): entries store the
                            stable categoryId, names resolve at render — renames
                            never touch posts. The legacy free-typed value shows
                            until migrated. */}
                        <TextField
                          select
                          label="Category"
                          value={editor.categoryId}
                          onChange={(event) => {
                            const value = event.target.value
                            if (value === MANAGE_CATEGORIES_VALUE) {
                              return void openCategories()
                            }
                            setEditor((prev) =>
                              prev ? { ...prev, categoryId: value } : prev,
                            )
                          }}
                          size="small"
                          sx={{ flexGrow: 1 }}
                          helperText={
                            editor.legacyCategory && !editor.categoryId
                              ? `Typed category "${editor.legacyCategory}" — pick one to migrate this entry`
                              : 'Pick from this collection’s categories'
                          }
                        >
                          <MenuItem value="">{'None'}</MenuItem>
                          {categories.map((category) => (
                            <MenuItem key={category.id} value={category.id}>
                              {category.name}
                            </MenuItem>
                          ))}
                          {editor.categoryId &&
                          !categories.some(
                            (category) => category.id === editor.categoryId,
                          ) ? (
                            // The referenced category was deleted: keep the
                            // Select valid and let the author see (and move
                            // off) the id.
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
                          value={editor.tags}
                          onChange={(event) =>
                            setEditor((prev) =>
                              prev
                                ? { ...prev, tags: event.target.value }
                                : prev,
                            )
                          }
                          size="small"
                          sx={{ flexGrow: 2 }}
                          helperText="Comma-separated, e.g. nextjs, seo"
                        />
                      </Stack>
                      {/* Byline (AGL-2486). A record, a one-off string, or the
                          site — and the Select has to be able to say all three,
                          because an entry written before this feature is in the
                          middle state and opening its editor must not
                          re-attribute it. */}
                      <TextField
                        select
                        label="Author"
                        value={
                          editor.authorId
                            ? editor.authorId
                            : editor.authorName
                              ? CUSTOM_BYLINE_VALUE
                              : ''
                        }
                        onChange={(event) => {
                          const value = event.target.value
                          setEditor((prev) => {
                            if (!prev) return prev
                            if (value === CUSTOM_BYLINE_VALUE) {
                              // Keep whatever was typed; only drop the record
                              // reference.
                              return { ...prev, authorId: '' }
                            }
                            if (!value) {
                              return { ...prev, authorId: '', authorName: '' }
                            }
                            return {
                              ...prev,
                              authorId: value,
                              // The resolved name travels with the id — see
                              // the save.
                              authorName:
                                authors.find((author) => author.$id === value)
                                  ?.name ?? prev.authorName,
                            }
                          })
                        }}
                        size="small"
                        helperText="Byline for this entry — falls back to the site entity"
                      >
                        <MenuItem value="">
                          {'The site (publisher entity)'}
                        </MenuItem>
                        {authors.map((author) => (
                          <MenuItem key={author.$id} value={author.$id}>
                            {`${author.name} · ${Aglyn.contentAuthorSchemaType(author.type)}`}
                          </MenuItem>
                        ))}
                        {editor.authorId &&
                        !authors.some(
                          (author) => author.$id === editor.authorId,
                        ) ? (
                          // The referenced author was deleted. Keep the Select
                          // valid and show the id, exactly as the category
                          // Select does — the post still renders (the stored
                          // name is the fallback), and the editor can see what
                          // to move it off.
                          <MenuItem value={editor.authorId}>
                            {`${editor.authorId} (deleted)`}
                          </MenuItem>
                        ) : null}
                        <MenuItem value={CUSTOM_BYLINE_VALUE}>
                          {'Custom byline…'}
                        </MenuItem>
                      </TextField>
                      {!editor.authorId ? (
                        <TextField
                          label="Custom byline"
                          value={editor.authorName}
                          onChange={(event) =>
                            setEditor((prev) =>
                              prev
                                ? { ...prev, authorName: event.target.value }
                                : prev,
                            )
                          }
                          size="small"
                          helperText={
                            'A one-off name for this entry — published as a ' +
                            'Person. Leave blank to attribute the piece to the ' +
                            'site.'
                          }
                        />
                      ) : null}
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: CARD_NARROW,
                children: (
                  <CardDisplay
                    header={'Details'}
                    help={docsHelp('buildABlog', {
                      anchor: '#2-write-entries',
                      title: 'What is recorded',
                      excerpt:
                        'The entry id, its public address, and every date ' +
                        'stored against it — created, updated, published and ' +
                        'scheduled.',
                    })}
                    contentGutterY
                    contentBordered="all"
                  >
                    <List dense disablePadding>
                      {entryDetails.map(
                        ({ key: itemKey, primary, secondary, icon }) => (
                          <ListItem key={itemKey} alignItems="flex-start" dense>
                            <ListItemIcon
                              sx={{
                                border: `1px solid`,
                                borderColor: 'divider',
                                padding: 1,
                                borderRadius: 1,
                                minWidth: 'unset',
                                marginRight: 2,
                                color: 'secondary.main',
                              }}
                            >
                              <MdiIcon path={icon} />
                            </ListItemIcon>
                            <ListItemText
                              primary={primary}
                              secondary={secondary || '—'}
                              // An entry id and a `/collection/entry` path are
                              // long unbroken tokens; the default break rules
                              // cut them mid-word instead of wrapping them,
                              // which in a one-third column is most of the
                              // value gone.
                              slotProps={{
                                secondary: {
                                  sx: { overflowWrap: 'anywhere' },
                                },
                              }}
                            />
                          </ListItem>
                        ),
                      )}
                    </List>
                  </CardDisplay>
                ),
              },
              {
                size: CARD_NARROW,
                children: (
                  <CardDisplay
                    header={'Publication'}
                    help={docsHelp('buildABlog', {
                      anchor: '#scheduling',
                      title: 'Publishing and scheduling',
                      excerpt:
                        'Publish this entry now, schedule it for a future ' +
                        'time, or correct the date it says it went out.',
                    })}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    {/*
                      Publication controls, on the page where the writing
                      happens rather than only in the list row's menu
                      (AGL-2498).

                      They are the SAME actions the row menu runs — shared
                      through the scope rather than copied — so there is one
                      behavior with two doors. Deliberately NOT folded into
                      Save: publishing is an explicit act, and a Save that also
                      published would make every typo fix a publication event.

                      `publishedAt` (when it WENT live) and `publishAt` (when it
                      is DUE to) differ by a single letter, so each line states
                      its own tense and the two buttons are worded apart.
                    */}
                    {stored ? (
                      <Stack spacing={1.5}>
                        <Stack
                          direction="row"
                          spacing={1}
                          useFlexGap
                          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <Chip
                            size="small"
                            label={
                              entryIsPublished
                                ? 'Published'
                                : entryIsScheduled
                                  ? 'Scheduled'
                                  : 'Draft'
                            }
                            color={
                              entryIsPublished
                                ? 'success'
                                : entryIsScheduled
                                  ? 'info'
                                  : 'default'
                            }
                          />
                          <Typography variant="body2" color="text.secondary">
                            {entryIsPublished
                              ? `Published ${formatStampFull(stored.publishedAt) ?? '—'}`
                              : entryIsScheduled
                                ? `Scheduled for ${formatStampFull(stored.publishAt) ?? '—'}`
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
                                  entryIsPublished
                                    ? mdiPublishOff.path
                                    : mdiPublish.path
                                }
                                size={0.8}
                              />
                            }
                            onClick={() => void togglePublish(stored)}
                          >
                            {entryIsPublished ? 'Unpublish' : 'Publish'}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={
                              <MdiIcon path={mdiCalendarEdit.path} size={0.8} />
                            }
                            onClick={() => openPublishDate(stored)}
                          >
                            {'Edit published date…'}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={
                              <MdiIcon
                                path={mdiCalendarClock.path}
                                size={0.8}
                              />
                            }
                            onClick={() => openScheduler(stored)}
                          >
                            {'Schedule…'}
                          </Button>
                        </Stack>
                      </Stack>
                    ) : (
                      /*
                        Shown, not hidden, for a draft that has no document
                        yet. There is nothing to publish, schedule or date until
                        the draft has been created — offering the controls would
                        write to an id no document answers to — but an ABSENT
                        card reads as a missing feature, and this is the card
                        whose absence started the issue.
                      */
                      <Typography variant="body2" color="text.secondary">
                        {'Create the draft first — publishing, scheduling and ' +
                          'the published date all act on a stored entry.'}
                      </Typography>
                    )}
                  </CardDisplay>
                ),
              },
              {
                size: CARD_WIDE,
                children: (
                  <CardDisplay
                    header={'Body'}
                    help={docsHelp('buildABlog', {
                      anchor: '#visual-editor',
                      title: 'The visual editor',
                      excerpt:
                        'The entry itself. The visual surface and the ' +
                        'markdown source edit the same document, so switching ' +
                        'between them never loses anything.',
                    })}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <Stack spacing={1}>
                      {/* One toolbar for both surfaces (AGL-984), including
                          the Visual / Markdown switch. */}
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
                            // The handler half of AGL-1380: `org` is undefined
                            // both in flight and on a failed read, and
                            // `hasEntitlement` on an undefined org answers NO
                            // — so clicking inside the loading window told a
                            // Pro org the feature it pays for is not on its
                            // plan. Pending declines and says so; only a loaded
                            // plan may make the claim.
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
                          {editor.body?.trim()
                            ? 'Improve with AI'
                            : 'Write with AI'}
                        </Button>
                      </MarkdownEditorToolbar>
                      {bodyTab === 'visual' ? (
                        // WYSIWYG surface (AGL-582): the editor IS the preview
                        // — it round-trips through the same markdown-lite
                        // parser/serializer the tenant renders with.
                        <Box>
                          <MarkdownVisualEditor
                            ref={visualEditorRef}
                            value={editor.body}
                            onChange={(body) =>
                              setEditor((prev) =>
                                prev ? { ...prev, body } : prev,
                              )
                            }
                            // The editor's Insert image dialog hands off to the
                            // same media picker the "Insert image" button uses
                            // (AGL-596).
                            onPickImageFromMedia={() => setPickerTarget('body')}
                            onContextChange={setBodyContext}
                          />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            component="div"
                            sx={{ mt: 0.5 }}
                          >
                            {'Cmd/Ctrl+B bold · Cmd/Ctrl+I italic · ' +
                              'Cmd/Ctrl+Z undo · type "## ", "### " or "- " ' +
                              'at a line start to convert'}
                          </Typography>
                        </Box>
                      ) : (
                        <TextField
                          label="Markdown source"
                          value={editor.body}
                          onChange={(event) =>
                            setEditor((prev) =>
                              prev
                                ? { ...prev, body: event.target.value }
                                : prev,
                            )
                          }
                          size="small"
                          multiline
                          minRows={14}
                          fullWidth
                          inputRef={bodyInputRef}
                          helperText={MARKDOWN_SOURCE_HINT}
                        />
                      )}
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: CARD_NARROW,
                children: (
                  <CardDisplay
                    header={'Cover image'}
                    help={docsHelp('seo', {
                      anchor: '#social-cards',
                      title: 'The share card image',
                      excerpt:
                        'The picture shown at the top of the entry and on its ' +
                        'share card, with the description screen readers ' +
                        'announce. Previewed at the 1200×630 crop social ' +
                        'readers apply.',
                    })}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    {/* The field PREVIEWS what it points at (AGL-2498) — see
                        the component for why the URL input stays and why the
                        picker dialog is still the page's. */}
                    <EntryCoverImageField
                      hostId={hostId}
                      value={editor.coverImage}
                      alt={editor.coverImageAlt}
                      onValueChange={(value) =>
                        setEditor((prev) =>
                          prev ? { ...prev, coverImage: value } : prev,
                        )
                      }
                      onAltChange={(alt) =>
                        setEditor((prev) =>
                          prev ? { ...prev, coverImageAlt: alt } : prev,
                        )
                      }
                      onChoose={() => setPickerTarget('cover')}
                    />
                  </CardDisplay>
                ),
              },
              {
                size: CARD_WIDE,
                children: (
                  <CardDisplay
                    header={'SEO'}
                    help={docsHelp('seo', {
                      anchor: '#per-screen-seo',
                      title: 'Search and social text',
                      excerpt:
                        'The title and description search engines and social ' +
                        'readers show. Both fall back to the entry’s own ' +
                        'title and excerpt when left blank.',
                    })}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <Stack spacing={1.5}>
                      <TextField
                        label="SEO title"
                        value={editor.seoTitle}
                        onChange={(event) =>
                          setEditor((prev) =>
                            prev
                              ? { ...prev, seoTitle: event.target.value }
                              : prev,
                          )
                        }
                        size="small"
                        // The same counters the screen SEO card carries
                        // (AGL-1368). A title is published VERBATIM, so the
                        // number is the one thing that tells an author it will
                        // be cut.
                        helperText={`${editor.seoTitle.length}/60 — falls back to the title`}
                        error={editor.seoTitle.length > 60}
                      />
                      <TextField
                        label="SEO description"
                        value={editor.seoDescription}
                        onChange={(event) =>
                          setEditor((prev) =>
                            prev
                              ? { ...prev, seoDescription: event.target.value }
                              : prev,
                          )
                        }
                        size="small"
                        multiline
                        minRows={2}
                        helperText={`${editor.seoDescription.length}/155 — falls back to the excerpt`}
                        error={editor.seoDescription.length > 155}
                      />
                      {/*
                        What a search result would read, from the values above
                        and their fallbacks. Not a mock of Google's chrome — a
                        plain rendering of the three strings the head will
                        actually emit, which is the part an author cannot
                        otherwise see until the page is live.
                      */}
                      <Stack
                        spacing={0.25}
                        sx={{
                          border: 1,
                          borderColor: 'divider',
                          borderRadius: 1,
                          p: 1.5,
                        }}
                      >
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ overflowWrap: 'anywhere' }}
                        >
                          {effectiveSlug && selected
                            ? `${siteBase ?? ''}/${selected.slug}/${effectiveSlug}`
                            : 'Save the entry to give it an address'}
                        </Typography>
                        <Typography
                          variant="subtitle1"
                          color="primary"
                          sx={{ overflowWrap: 'anywhere' }}
                        >
                          {editor.seoTitle.trim() ||
                            editor.title.trim() ||
                            'Untitled entry'}
                        </Typography>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ overflowWrap: 'anywhere' }}
                        >
                          {editor.seoDescription.trim() ||
                            editor.excerpt.trim() ||
                            'No description — search engines will pick their own.'}
                        </Typography>
                      </Stack>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                // Per-entry traffic (AGL-2498), the counterpart of the screen
                // detail page's `Screen traffic`. Full width: it is a chart,
                // and it earns the row.
                size: { xs: 12 },
                children: (
                  <EntryAnalyticsCard hostId={hostId} path={entryPublicPath} />
                ),
              },
              {
                // FULL WIDTH, in a band of its own — matching the screen detail
                // page's `Page Activity`. The slot renders an empty fragment
                // when no activity plugin is entitled, and `GridItems masonry`
                // drops the item wrapper via `:empty`.
                //
                // `targetId` is the ENTRY id, which is what every `logActivity`
                // call already writes as `target.id` — so the feed on this page
                // is this entry's audit trail rather than the site's.
                size: { xs: 12 },
                children: stored ? (
                  <PluginWidgetSlot
                    slot="hostActivity"
                    hostId={hostId}
                    targetId={String(stored.$id)}
                    header={'Entry activity'}
                  />
                ) : null,
              },
              {
                // LAST card, CLOSED by default — the same arrangement and the
                // same `unmountOnExit` reasoning as the screen detail page: the
                // `<pre>` is not in the DOM at all while closed, so a long
                // entry body costs nothing to render.
                size: { xs: 12 },
                children: stored ? (
                  <CardDisplay
                    header={'Raw JSON'}
                    help={docsHelp('buildABlog', {
                      anchor: '#entry-tokens',
                      title: 'The stored document',
                      excerpt:
                        'Every field this entry holds, exactly as saved — the ' +
                        'names a template screen’s entry tokens read from.',
                    })}
                    // Gutters and the content border belong to the CONTENT, so
                    // they come off with it. Left on, a closed card draws an
                    // empty bordered strip under its header.
                    contentGutterX={rawJsonOpen}
                    contentGutterY={rawJsonOpen}
                    contentBordered={rawJsonOpen ? 'all' : undefined}
                    HeaderProps={{
                      action: (
                        <IconButton
                          size="small"
                          onClick={() => setRawJsonOpen((prior) => !prior)}
                          aria-expanded={rawJsonOpen}
                          aria-label={
                            rawJsonOpen ? 'Hide raw JSON' : 'Show raw JSON'
                          }
                        >
                          <MdiIcon
                            path={
                              rawJsonOpen
                                ? mdiChevronUp.path
                                : mdiChevronDown.path
                            }
                          />
                        </IconButton>
                      ),
                    }}
                  >
                    <Collapse in={rawJsonOpen} unmountOnExit>
                      <pre
                        style={{ margin: 0, maxHeight: 360, overflow: 'auto' }}
                      >
                        {JSON.stringify(stored, null, 2)}
                      </pre>
                    </Collapse>
                  </CardDisplay>
                ) : null,
              },
            ]}
          />
        </Container>
      </DashboardLayout>
      <Dialog
        open={aiInstruction != null}
        onClose={() => (aiBusy ? null : setAiInstruction(null))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {editor.body?.trim() ? 'Improve with AI' : 'Write with AI'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Typography variant="body2" color="text.secondary">
            {editor.body?.trim()
              ? 'Describe how the body should change — tone, structure, length.'
              : 'Describe the post — the title and excerpt are included automatically.'}
          </Typography>
          <TextField
            label="Instruction"
            placeholder={
              editor.body?.trim()
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
            {aiBusy ? 'Working…' : editor.body?.trim() ? 'Improve' : 'Write'}
          </Button>
        </DialogActions>
      </Dialog>
      <MediaPickerDialog
        hostId={hostId}
        open={pickerTarget != null}
        onClose={() => setPickerTarget(null)}
        onPick={(media) => {
          // ONE writer for the cover and the body (AGL-1705). `media.url`
          // names the object's CURRENT LOCATION, so an AGL-1215 folder move —
          // which copies the object, rewrites `url` and deletes the original —
          // 404s every body image permanently, and a replace regenerates the
          // embedded `&token=` and does it again. `mediaNodeSrc` stores the
          // reference by identity and still degrades to `url` for an org with
          // no `mediaCdn` entitlement.
          const src = Aglyn.mediaNodeSrc(media)
          if (src) {
            // The asset's alt, through the one shared rule (AGL-1896). The
            // `?? fileName` fallback that used to sit here is GONE: a file name
            // is not a description, and "IMG_4021.jpg" announced by a screen
            // reader is worse than the silence it replaced.
            const alt =
              Aglyn.inheritedMediaAlt({ assetAlt: (media as any).alt }) ?? ''
            if (pickerTarget === 'cover') {
              setEditor((prev) =>
                prev
                  ? {
                      ...prev,
                      coverImage: src,
                      // An alt the author already wrote wins; an asset with no
                      // alt leaves the field empty and honest.
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
    </>
  )
}
EntryDetailPage.displayName = 'EntryDetailPage'

export default EntryDetailPage
