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
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
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
  updateDoc,
} from 'firebase/firestore'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useHostId, useHostSubdomain } from '../host-id-provider'
import { buildRoute, Route } from '../../constants/route-links'
import { hasEntitlement } from '../../constants/entitlements'
import { useOrgSlug } from '../../hooks/use-org-scope'
import useCurrentOrg from '../../hooks/use-current-org'
import useFirestoreCollection from '../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../hooks/use-firestore-doc'
import useHostActivityLogger from '../../hooks/use-host-activity-logger'

/**
 * Everything BOTH content surfaces need, resolved once (AGL-2498).
 *
 * ## Why this exists at all
 *
 * The content manager was one component rendering either a list or an entry
 * editor, and AGL-2498's first pass gave it three addresses by aliasing three
 * `page.tsx` files at the same component. That kept the data layer single —
 * which was the point — and bought a defect with it: the collection page
 * flashes before the entry page appears.
 *
 * That flash is structural rather than cosmetic. One component
 * cannot render the detail until its buffer is seeded, and the buffer is
 * seeded from the entries LISTENER — so on a cold load of an entry URL the
 * component renders the only thing it can render meanwhile, which is the list.
 * The address says "entry" and the page says "collection", for as long as
 * Firestore takes. No amount of care inside that component removes it; the two
 * screens have to be two components.
 *
 * ## What that would have cost, and why it does not
 *
 * The original argument for keeping one component was real: the manager
 * resolves the collections, the entries listener, the categories, the authors,
 * the screens and the site origin, and a second copy of that resolution is a
 * second place for the two screens to disagree about which collection is open.
 *
 * So the resolution moves HERE, into a provider mounted by `content/layout.tsx`
 * — above all three routes. The pages became separate; the data layer did not
 * get a second copy. It got a shared one, which is the arrangement the first
 * pass was reaching for and could only approximate.
 *
 * ## The listener does not re-subscribe on the way into an entry
 *
 * A layout persists across its children in the App Router, so opening an entry
 * unmounts the list and mounts the detail while the entries listener stays
 * exactly where it was. That is strictly better than the aliased component,
 * which re-ran the whole resolution on nothing.
 *
 * ## Why the shared ENTRY ACTIONS live here too
 *
 * Publish, unpublish, schedule, re-date and delete are reachable from both the
 * list row's overflow menu and the detail page's Publication card. They are
 * one behaviour with two doors — see AGL-2497 for how nearly `publishAt` and
 * `publishedAt` merged — so the handlers and their two dialogs are owned here
 * and neither page can drift its own copy.
 */

/** `title` → `title-like-this`; the console's one slug rule. */
export const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')

/**
 * A row timestamp short enough to hold one line (AGL-2486).
 *
 * `toLocaleString()` renders `8/8/2026, 11:48:47 PM`, which wrapped to three
 * line boxes inside the ~100px column the table actually gave it and made
 * every row a different height. The exact instant is not lost — it moves to
 * the cell's `title`, which is where a precise value belongs when the column
 * is scanned for recency rather than read.
 */
export const formatStampShort = (value: any): string => {
  const date = value?.toDate?.()
  if (!date) return '—'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** The full instant behind {@link formatStampShort}, for a tooltip. */
export const formatStampFull = (value: any): string | undefined => {
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
export const toDateTimeLocalValue = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/**
 * The URL segment that addresses a collection — its SLUG (AGL-2498).
 *
 * Falls back to the document id only for a collection that somehow has no
 * slug. That is not a shape the create route can produce (it refuses a slug
 * that does not match `^[a-z0-9]+(?:-[a-z0-9]+)*$`), but an imported or
 * hand-written document could, and a collection with no address at all is
 * still better reached by an ugly URL than not reachable.
 */
export const collectionKey = (item: any): string =>
  String(item?.slug || item?.$id || '')

/** Sentinel option that opens the Manage categories dialog (AGL-582). */
export const MANAGE_CATEGORIES_VALUE = '__manage__'

export interface ContentScope {
  hostId: string
  orgSlug: string
  host: string
  /** The host document, for the public origin and the member roles. */
  hostDoc: any
  /** Live-entry links (AGL-123): custom domain first, subdomain fallback. */
  siteBase: string | null
  /** Content collections only — the catalog's share this Firestore path. */
  collections: any[]
  /** `null` until the collections listener has answered at all. */
  collectionsLoaded: boolean
  /** The collection the address names, falling back to the first. */
  selected: any
  /** The raw segment from the URL — a slug, or a legacy document id. */
  routeCollectionKey: string | null
  entries: any[]
  entriesStatus: string
  entriesFromCache: boolean
  categories: Array<{ id: string; name: string }>
  authors: Aglyn.ContentAuthorRecord[]
  screenOptions: any[]
  screensById: Record<string, Aglyn.CollectionTemplateScreen>
  isSiteAdmin: boolean

  /* ── addresses ─────────────────────────────────────────────────────── */
  contentHref: string
  /** `key` is a collection slug — see {@link collectionKey}. */
  collectionHref: (key: string) => string
  entryHref: (entryId: string) => string
  /** Claims a collection this app navigated to; see the rewrite effect. */
  claimNavigation: (key: string) => void

  /* ── shared entry actions ──────────────────────────────────────────── */
  togglePublish: (entry: any) => Promise<void>
  deleteEntry: (entry: any) => Promise<boolean>
  openScheduler: (entry: any) => void
  openPublishDate: (entry: any) => void
  openCategories: () => void
}

const ContentScopeContext = createContext<ContentScope | null>(null)

/** The scope for the current collection. Throws outside the provider. */
export function useContentScope(): ContentScope {
  const scope = useContext(ContentScopeContext)
  if (!scope) {
    throw new Error('useContentScope must be used inside ContentScopeProvider')
  }
  return scope
}

export function ContentScopeProvider({ children }: { children: ReactNode }) {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const logActivity = useHostActivityLogger(hostId)
  const { data: user } = useUser()
  const { org, ready: orgReady } = useCurrentOrg()

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
   * Host-scoped because the byline belongs to the SITE that publishes it, and
   * read unpaginated: `AUTHORS_MAX_PER_HOST` is the ceiling, and a masthead
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
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
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

  /* ── the address ───────────────────────────────────────────────────── */

  const routeParams = useParams<{ collectionSlug?: string }>()
  const routeCollectionKey = (routeParams?.collectionSlug as string) || null
  const searchParams = useSearchParams()
  const router = useRouter()
  /**
   * PRIMITIVES, not the `searchParams` object. `useSearchParams()` hands back
   * a fresh object on every render, so an effect depending on it depends on
   * "every render". These three are strings: they change when the address
   * changes and not otherwise.
   */
  const legacyCollection = searchParams?.get('collection') ?? null
  const legacyEntry = searchParams?.get('entry') ?? null
  const queryString = searchParams?.toString() ?? ''

  /** `useRouter()` is also fresh per render; held so effects can skip it. */
  const routerRef = useRef(router)
  routerRef.current = router
  /** The address the rewrite below has already asked for; see it. */
  const rewrittenToRef = useRef<string | null>(null)
  /**
   * A collection id this app itself navigated to, which the rewrite must not
   * second-guess.
   *
   * ⚠️ Without it, CREATING a collection bounces you off it. The route
   * confirms the write and hands back an id, and the address is pushed
   * immediately — but the collections LISTENER has not delivered the new
   * document yet, so for a few hundred milliseconds the id in the path names a
   * collection this provider cannot see. That is indistinguishable from a
   * deleted collection, which is exactly what case 2 rewrites away.
   */
  const navigatedToRef = useRef<string | null>(null)
  const claimNavigation = useCallback((key: string) => {
    navigatedToRef.current = key
  }, [])

  const contentHref = buildRoute(Route.HOST_CONTENT, { orgSlug, host })
  const collectionPath = useCallback(
    (key: string) =>
      buildRoute(Route.HOST_CONTENT_COLLECTION, {
        orgSlug,
        host,
        collectionSlug: key,
      }),
    [orgSlug, host],
  )
  const entryPath = useCallback(
    (key: string, entryId: string) =>
      buildRoute(Route.CONTENT_ENTRY_DETAILS, {
        orgSlug,
        host,
        collectionSlug: key,
        entryId,
      }),
    [orgSlug, host],
  )
  /**
   * Everything in the query EXCEPT the two legacy parameters.
   *
   * `?tab=` (HubTabs) has to survive a collection switch; `?collection=` and
   * `?entry=` must NOT, because they are the address that moved into the path
   * — carrying them forward would leave two answers to "which collection is
   * open" in one URL, and nothing to say which wins.
   */
  const survivingQuery = useMemo(() => {
    const params = new URLSearchParams(queryString)
    params.delete('collection')
    params.delete('entry')
    const rest = params.toString()
    return rest ? `?${rest}` : ''
  }, [queryString])
  const collectionHref = useCallback(
    (key: string) => `${collectionPath(key)}${survivingQuery}`,
    [collectionPath, survivingQuery],
  )

  /**
   * The collection the address names.
   *
   * By SLUG first, then by document id. The id branch is what keeps every link
   * written before AGL-2498 made the segment a slug — and every link to a
   * collection whose id happens to look like a slug — resolving; the rewrite
   * below then canonicalises the address so it does not stay in two shapes.
   */
  const selected =
    collections.find((item) => collectionKey(item) === routeCollectionKey) ??
    collections.find((item) => item.$id === routeCollectionKey) ??
    collections[0]

  const entryHref = useCallback(
    (entryId: string) =>
      selected ? entryPath(collectionKey(selected), entryId) : contentHref,
    [selected, entryPath, contentHref],
  )

  /**
   * The address is put into the routed form, and only when it is not already
   * in it.
   *
   * 1. **No collection in the path** — a bare `/content`, or a legacy
   *    `?collection=`/`?entry=` link. The legacy pair wins when it names a
   *    collection that exists; otherwise the first collection does.
   * 2. **A collection that no longer exists** — deleted, stale bookmark, typo.
   *    Left alone, `selected` falls back to `collections[0]` and the address
   *    NAMES one collection while the page SHOWS another; the next save writes
   *    to the one on screen.
   * 3. Anything else: nothing to do.
   *
   * `replace`, never `push`: a legacy address is not a place a reader chose to
   * be, and Back must not return them to a URL that forwards again.
   *
   * Guarded on the listener having ANSWERED rather than on `collections.length`
   * — an empty array means "no collections" and "not loaded yet" alike, and
   * rewriting on the second would fight the listener.
   */
  useEffect(() => {
    if (!collectionDocs || collections.length === 0) return
    const canonical =
      collections.some((item) => collectionKey(item) === routeCollectionKey) ||
      // Confirmed by the server a moment ago; the listener is just behind.
      routeCollectionKey === navigatedToRef.current
    if (routeCollectionKey && canonical) {
      // Settled. The claim is CLEARED rather than left standing, so a later
      // trip back to a bare, legacy or id-shaped address is rewritten again
      // instead of being mistaken for the one still in flight.
      rewrittenToRef.current = null
      return
    }
    /*
      The legacy `?collection=` parameter carried a document ID, and so did
      every `…/content/{id}` link written before the segment became a slug. Both
      resolve, and both are rewritten to the slug — an address that stays in two
      shapes is one nobody can recognise or compare.
    */
    const target = collectionKey(
      (!routeCollectionKey &&
        collections.find((item) => item.$id === legacyCollection)) ||
        collections.find((item) => item.$id === routeCollectionKey) ||
        collections[0],
    )
    const href =
      !routeCollectionKey && legacyEntry
        ? entryPath(target, legacyEntry)
        : `${collectionPath(target)}${survivingQuery}`
    /*
      Asked for ONCE. `router.replace` starts a transition, so `useParams()`
      keeps reporting the old address for at least one render and this effect
      can run again inside that window. Without the claim that is a `replace`
      per render at the exact moment the router is mid-navigation.
    */
    if (rewrittenToRef.current === href) return
    rewrittenToRef.current = href
    routerRef.current.replace(href)
  }, [
    collectionDocs,
    collections,
    routeCollectionKey,
    legacyCollection,
    legacyEntry,
    survivingQuery,
    collectionPath,
    entryPath,
  ])

  /* ── the entries of the selected collection ────────────────────────── */

  const {
    data: entryDocs,
    /**
     * The seed the entry editor is populated from (AGL-1449). Both are fed to
     * `writeGuardedBySeed` on save — read and dropped is how a guard becomes
     * decoration.
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

  // Category taxonomy (AGL-582): `{ id, name }` pairs on the COLLECTION doc.
  // Entries reference the stable id, so renaming a category here updates every
  // post at render time without touching any entry.
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

  /**
   * Delete collection (AGL-1324) is admin-only, and so is the control that
   * opens it. The route re-checks the role; this only hides a button that
   * would 403.
   */
  const isSiteAdmin = hostDoc?.memberRoles?.[(user as any)?.uid] === 'admin'

  /* ── shared entry actions ──────────────────────────────────────────── */

  const entryRef = useCallback(
    (entryId: string) =>
      doc(
        firestore,
        'hosts',
        hostId,
        'collections',
        selected?.$id ?? '-none-',
        'entries',
        entryId,
      ),
    [firestore, hostId, selected?.$id],
  )

  const togglePublish = useCallback(
    async (entry: any) => {
      if (!selected) return
      const publish = entry.status !== 'published'
      await updateDoc(
        entryRef(entry.$id),
        /**
         * Publishing stamps the instant only when the entry does not already
         * carry a date of its own (AGL-2497).
         *
         * `Timestamp.now()` used to be unconditional, so an entry's publish
         * date was always the moment somebody clicked this — which is what
         * made an imported archive tell Google every post in it went out on
         * migration day. `publishedAt` is the field `Article.datePublished`
         * is wired to.
         *
         * `??`, not a truthy test: an entry with no publish date has the
         * field ABSENT, and `strictNullChecks` is off repo-wide, so any
         * arithmetic fallback would compile clean and date the post to
         * 1 Jan 1970. Three states stay distinct — a real Timestamp, absent,
         * and unpublished.
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
    [selected, entryRef, enqueueSnackbar, logActivity],
  )

  /**
   * Deleting one entry, from the list row's overflow menu OR from the detail
   * page's header.
   *
   * REPORTS whether it deleted (AGL-2498). The row menu never had to know —
   * the row simply vanishes with the listener. The detail page does: it is
   * displaying the document that just stopped existing, and it must leave only
   * when the delete actually happened. A cancelled confirm that navigated away
   * anyway would look exactly like a successful delete.
   */
  const deleteEntry = useCallback(
    async (entry: any): Promise<boolean> => {
      if (!selected) return false
      const confirmed = await confirm({
        title: 'Delete this entry?',
        description: `"${entry.title}" will be permanently deleted.`,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return false
      await deleteDoc(entryRef(entry.$id))
      enqueueSnackbar('Entry deleted', { variant: 'success', persist: false })
      logActivity('Deleted entry', {
        type: 'content',
        id: entry.$id,
        name: entry.title,
      })
      return true
    },
    [selected, confirm, entryRef, enqueueSnackbar, logActivity],
  )

  /* ── the two date dialogs, owned here ──────────────────────────────── */

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
   * Opening the two date dialogs — ONE definition each, because both the list
   * row's menu and the detail page's Publication card call them.
   *
   * The seeding is the part that must not be copied: `publishAt` opens an hour
   * out (a schedule is a FUTURE instant), `publishedAt` opens on the entry's
   * own date (a publication date is a PAST one), and a hand-copied twin is how
   * those two swap over without anything failing loudly.
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

  const handleScheduleEntry = useCallback(async () => {
    if (!scheduler || !selected) return
    /*
      Plan gate (AGL-471). `scheduledPublishing` is a Business entitlement and
      the screens path has enforced it since AGL-471, but entries were never
      wired to it on either side. The renderer is the authority — see
      `get-collection-content.ts` — and this is the half that makes the refusal
      legible instead of letting someone schedule a post that never goes out.

      `orgReady` FIRST (AGL-1380): `org` is undefined both in flight and on a
      failed read, and `hasEntitlement` on an undefined org answers NO — so
      gating without it tells a Business org, during its own loading window,
      that it does not have the feature it pays for.
    */
    if (!orgReady) {
      return enqueueSnackbar('Checking your plan — try again in a moment', {
        variant: 'info',
        persist: false,
      })
    }
    if (!hasEntitlement('scheduledPublishing', org)) {
      return enqueueSnackbar(
        'Scheduled publishing requires a Business plan — see Billing to upgrade',
        { variant: 'warning', persist: false },
      )
    }
    const publishAt = new Date(scheduler.at)
    if (Number.isNaN(publishAt.getTime()) || publishAt <= new Date()) {
      return enqueueSnackbar('Pick a future date/time', {
        variant: 'warning',
        persist: false,
      })
    }
    await updateDoc(entryRef(scheduler.entry.$id), {
      status: 'scheduled',
      publishAt: Timestamp.fromDate(publishAt),
    })
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
  }, [
    scheduler,
    selected,
    entryRef,
    org,
    orgReady,
    enqueueSnackbar,
    logActivity,
  ])

  /**
   * Setting an entry's publish date, in the PAST (AGL-2497).
   *
   * ## Why this is a second affordance and not a mode on the scheduler
   *
   * Backdating and scheduling are different features that happen to share a
   * concept. Folding them together means relaxing the scheduler's
   * `<= new Date()` refusal, and after that "Schedule" silently accepts a past
   * instant that nothing will ever act on. So the two guards are COMPLEMENTARY
   * and between them tile the line with no gap and no overlap: this one
   * refuses the future and names where the future lives, the scheduler refuses
   * the past.
   *
   * ## What the write deliberately does NOT say
   *
   * It names exactly one field. Not `status` — re-dating is not publishing.
   * Not `updatedAt` — that is what `Article.dateModified` reads, and it has to
   * go on meaning "last edited" rather than "last re-dated".
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
    await updateDoc(entryRef(publishDate.entry.$id), {
      publishedAt: Timestamp.fromDate(at),
    })
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
  }, [publishDate, selected, entryRef, enqueueSnackbar, logActivity])

  /* ── the category manager, opened from both surfaces ───────────────── */

  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  // Inline rename drafts keyed by category id; committed on blur.
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>(
    {},
  )
  const openCategories = useCallback(() => setCategoriesOpen(true), [])
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
    // Stable id (AGL-582): slugified ONCE from the initial name and uniqued;
    // later renames never change it — that is the whole point.
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
      const current = categories.find((category) => category.id === categoryId)
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

  const value = useMemo<ContentScope>(
    () => ({
      hostId,
      orgSlug,
      host,
      hostDoc,
      siteBase,
      collections,
      collectionsLoaded: Boolean(collectionDocs),
      selected,
      routeCollectionKey,
      entries,
      entriesStatus,
      entriesFromCache,
      categories,
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
    }),
    [
      hostId,
      orgSlug,
      host,
      hostDoc,
      siteBase,
      collections,
      collectionDocs,
      selected,
      routeCollectionKey,
      entries,
      entriesStatus,
      entriesFromCache,
      categories,
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
    ],
  )

  return (
    <ContentScopeContext.Provider value={value}>
      {children}
      {/* Category taxonomy manager (AGL-582): add / inline-rename / delete
          the collection's categories. Renames only touch the collection doc —
          entries keep their stable ids. Mounted HERE because both the list's
          Categories button and the entry editor's "Manage categories…" option
          open it. */}
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
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
        >
          <Typography variant="body2" color="text.secondary">
            {'Entries reference categories by a stable id, so renaming one ' +
              'here updates every post — no entry is ever touched.'}
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
            {'The entry goes live once the time passes (applied on the next ' +
              'site refresh).'}
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
            {'The date this entry says it WAS published — what search engines ' +
              'read as its publication date. Set it in the past to date posts ' +
              'brought over from another site correctly.'}
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
    </ContentScopeContext.Provider>
  )
}
ContentScopeProvider.displayName = 'ContentScopeProvider'
