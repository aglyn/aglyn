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
import { AppLink, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import AddIcon from '@mui/icons-material/Add'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { alpha } from '@mui/material/styles'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControlLabel,
  Grid,
  IconButton,
  LinearProgress,
  Link,
  Menu,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  serverTimestamp,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  useFirestore,
  useScopeTokens,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { checkOrgQuota } from '../../constants/entitlements'
import useCurrentOrg from '../../hooks/use-current-org'
import useFirestoreCollection from '../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../hooks/use-firestore-doc'
import useHostActivityLogger from '../../hooks/use-host-activity-logger'
import useOrgHosts from '../../hooks/use-org-hosts'
import firestoreOneShotRetry from '../../utils/firestore-one-shot-retry'
import {
  normalizeUploadContentType,
  SIGNED_UPLOAD_MAX_BYTES,
  SIGNED_UPLOAD_THRESHOLD_BYTES,
} from '../../utils/media-upload-limits'
import { buildRoute, Route } from '../../constants/route-links'
import { useOrgSlug } from '../../hooks/use-org-scope'
import { ImageEditorDialog } from './image-editor-dialog.component'
import { MediaAssetCard } from './media-asset-card.component'
import { MediaFolderCard } from './media-folder-card.component'
import { MediaFolderRail } from './media-folder-rail.component'

export interface MediaLibraryComponentProps {
  /** Host scope — the site's own library. Mutually exclusive with orgId. */
  hostId?: string
  /** Org scope: the organization's shared library (same features). */
  orgId?: string
  /** When set, clicking an item selects it instead of exposing row actions. */
  onSelect?: (media: Aglyn.AglynHostMedia) => void
  /**
   * Restrict the ORG library to what one site may actually render
   * (AGL-1045). Set by the picker: you can only place an asset the target
   * site is allowed to use, regardless of how much the person browsing can
   * see. An agency owner sees every internal asset in the org library — but
   * not while choosing an image for a client's page, where placing one
   * would 404 on that site's domain.
   *
   * Filtering by the TARGET host's tokens also satisfies the AGL-1042
   * rules: `['org', 'host:{target}']` is a subset of the viewer's own
   * tokens whenever they can edit that site at all, so every returned doc
   * passes their check too.
   */
  forHostId?: string
}

/** Page size for cursor pagination (AGL-174). */
const MEDIA_PAGE_SIZE = 60

/**
 * Docs per request in the folder sharing cascade (AGL-1045). Small enough
 * that the progress bar moves on a folder of a few hundred files and that
 * a failure loses at most this much work; large enough that a 500-file
 * folder is a handful of round-trips, not five hundred.
 */
const SCOPE_CHUNK_SIZE = 100

/**
 * One "Used on" reference (AGL-845) as returned by /api/media/references —
 * carries what the client needs to deep-link back to the resource.
 */
interface MediaUsageRef {
  kind: 'screen' | 'layout' | 'entry'
  id: string
  name: string
  hostId: string
  hostSubdomain: string
  versionId?: string
  collectionId?: string
}

/** How each reference kind is labelled in the "Used on" list. */
const REF_KIND_LABEL: Record<MediaUsageRef['kind'], string> = {
  screen: 'Screen',
  layout: 'Layout',
  entry: 'Content',
}

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024))} KB`

/**
 * Drag wrapper for an asset card (AGL-172): drag id `media:{mediaId}`.
 * Disabled in picker mode where clicking selects instead.
 */
function DraggableCard(props: {
  mediaId: string
  disabled?: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `media:${props.mediaId}`,
    disabled: props.disabled,
  })
  return (
    <Box
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      sx={{ opacity: isDragging ? 0.4 : 1 }}
    >
      {props.children}
    </Box>
  )
}
DraggableCard.displayName = 'DraggableCard'

/**
 * Breadcrumb drop target (AGL-819): dropping a dragged file/folder onto an
 * ancestor crumb (or "All files" → root) moves it up and out. Uses the
 * `gridfolder:` id space so it never collides with the rail's `folder:`.
 */
function CrumbDropZone(props: {
  targetId: string | null
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: props.targetId === null ? 'gridfolder:root' : `gridfolder:${props.targetId}`,
  })
  return (
    <Box
      ref={setNodeRef}
      sx={{
        borderRadius: 1,
        px: 0.5,
        transition: (theme) => theme.transitions.create(['background-color']),
        bgcolor: isOver ? 'primary.main' : undefined,
        color: isOver ? 'primary.contrastText' : undefined,
      }}
    >
      {props.children}
    </Box>
  )
}
CrumbDropZone.displayName = 'CrumbDropZone'

/** File → base64 (payload for the upload API). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Per-host media library (AGL-72/73): files live in Firebase Storage at
 * `hosts/{hostId}/media/{mediaId}` with a Firestore metadata mirror and a
 * bytes counter doc (`counters/media`) that feeds the storage quota meter.
 * Uploads/deletes go through `/api/media/upload` (AGL-85) — Storage rules
 * deny client writes, so auth, admin membership, and quota are enforced
 * server-side; the quota check here is just a friendlier early error.
 * Doubles as the browse grid inside MediaPickerDialog via `onSelect`.
 */
export function MediaLibraryComponent(props: MediaLibraryComponentProps) {
  const { hostId, orgId, onSelect, forHostId } = props
  // Scope plumbing: one library serves both a site's media and the org
  // DAM — only the Firestore base path and the API identity differ.
  const scopeCollection = orgId ? 'orgs' : 'hosts'
  const scopeId = (orgId ?? hostId) as string
  const scopeBody = orgId ? { orgId } : { hostId }
  // Scoped sharing (AGL-1045). Under the AGL-1042 rules a scoped member's
  // UNFILTERED list is rejected outright — Firestore fails the whole query
  // if any candidate document would fail — so this constraint is required
  // for the page to work at all, not a nicety. Org-wide members skip it:
  // they read everything, and adding the filter would cost them a
  // composite index for nothing.
  const {
    tokens: viewerTokens,
    orgWide: viewerOrgWide,
    loaded: scopeLoaded,
  } = useScopeTokens(orgId)
  /**
   * Queries wait for the member doc (AGL-1047).
   *
   * `useScopeTokens` reports `orgWide: true` while it loads — deliberately,
   * so an org-wide member never sees an empty library flash. The cost lands
   * on the other side: for a SCOPED collaborator that default makes the
   * first render issue an UNFILTERED list, which the AGL-1042 rules deny
   * per document. It recovers when the member doc arrives, so the library
   * looks fine and quietly logs a denial on every single mount.
   *
   * Waiting is strictly better than either default: no wasted denied
   * round-trip, no misleading error in the console, and no chance of a
   * page that renders empty with only a rules error to explain why. An
   * org-scope-less library (a host library) has nothing to wait for.
   */
  const scopeReady = !orgId || scopeLoaded
  // Picking for a site narrows to THAT site's read set; otherwise a scoped
  // member narrows to their own. An org-wide member browsing the library
  // outright needs no filter.
  // Memoised because it is a QUERY DEPENDENCY, not just a value. The
  // `forHostId` branch built a fresh array every render, and the effects
  // below end in `setFolderCounts`/`setPages` — so a new array meant
  // re-render → new array → re-run, a self-sustaining loop firing one
  // `getCountFromServer` per folder (up to 500) for as long as the picker
  // stayed open. `viewerTokens` is already stable state.
  const scopeTokens = useMemo(
    () =>
      forHostId
        ? [Aglyn.ORG_SCOPE_TOKEN, Aglyn.hostScopeToken(forHostId)]
        : viewerTokens,
    [forHostId, viewerTokens],
  )
  const needsScope = Boolean(orgId) && (Boolean(forHostId) || !viewerOrgWide)

  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  // Sites in this org, for the "Selected sites…" chips and for turning
  // stored `host:` tokens back into names.
  const { hosts: orgHostList } = useOrgHosts(
    firestore,
    (user as any)?.uid,
    orgId ?? undefined,
  )
  /** host id → display name, for turning `host:` tokens back into words. */
  const hostNameById = useMemo(
    () =>
      Object.fromEntries(
        orgHostList.map((host: any) => [
          host.$id,
          host.name ?? host.subdomain ?? host.$id,
        ]),
      ) as Record<string, string>,
    [orgHostList],
  )

  const { org } = useCurrentOrg()
  // The org is a path segment in every console route; the "Used on" deep
  // links (AGL-845) build `/[orgSlug]/hosts/[subdomain]/…` from it.
  const orgSlug = useOrgSlug()
  const logHostActivity = useHostActivityLogger(hostId ?? '')
  // Activity feeds are a host-dashboard feature; the org DAM skips them.
  const logActivity = hostId
    ? logHostActivity
    : ((() => undefined) as typeof logHostActivity)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  // Paged media loading (AGL-174): cursor pagination over query-side
  // filters replaces the old limit(500)+client-filter read. The fetch
  // effect lives below the filter state it depends on.
  const [pages, setPages] = useState<any[][]>([])
  const [pageCursor, setPageCursor] =
    useState<QueryDocumentSnapshot | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMedia, setLoadingMedia] = useState(true)
  /** Firestore error code when the last load failed, else null. */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), [])
  const mediaDocs = useMemo(() => pages.flat(), [pages])
  const items: Aglyn.AglynHostMedia[] = useMemo(
    () => (mediaDocs as any[]).filter((item: any) => !item.deletedAt),
    [mediaDocs],
  )
  // Usage + total from the counter doc — accurate past pagination.
  const { data: mediaCounter } = useFirestoreDoc<any>(
    () => doc(firestore, scopeCollection, scopeId, 'counters', 'media'),
    [firestore, scopeId],
  )
  const usedBytes = Number(mediaCounter?.['bytes'] ?? 0)
  const totalCount = Number(mediaCounter?.['count'] ?? 0)

  // Public origin for absolute Copy-URL (AGL-831): a host's own site domain
  // (custom cname or `{subdomain}.aglyn.app`), else the current console
  // origin — which also serves the /api/media/cdn route.
  const { data: hostDoc } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId ?? '-none-'),
    [firestore, hostId],
  )
  const assetOrigin = useMemo(() => {
    if (hostId && hostDoc) {
      if (hostDoc.cname) return `https://${hostDoc.cname}`
      if (hostDoc.subdomain) return `https://${hostDoc.subdomain}.aglyn.app`
    }
    return typeof window !== 'undefined' ? window.location.origin : ''
  }, [hostId, hostDoc])

  // Folder hierarchy (AGL-171): first-class docs replace the AGL-124
  // free-text `folder` string. Legacy strings migrate lazily below.
  const { data: folderDocs } = useFirestoreCollection<any>(
    () =>
      // `null` skips the listener entirely until the read set is known —
      // see `scopeReady`. Issuing this unfiltered first would be denied.
      scopeReady
        ? query(
            collection(firestore, scopeCollection, scopeId, 'mediaFolders'),
            ...(needsScope
              ? [where('visibleTo', 'array-contains-any', scopeTokens)]
              : []),
            limit(500),
          )
        : null,
    [firestore, scopeId, needsScope, scopeTokens, scopeReady],
    { idField: '$id' },
  )
  const folderList: Array<Aglyn.AglynHostMediaFolder> = useMemo(
    () =>
      [...((folderDocs as any[]) ?? [])].sort(
        (a, b) =>
          (a.order ?? 0) - (b.order ?? 0) ||
          String(a.name).localeCompare(String(b.name)),
      ),
    [folderDocs],
  )
  const folderNameById = useMemo(
    () =>
      Object.fromEntries(folderList.map((folder) => [folder.$id, folder.name])),
    [folderList],
  )

  // One-shot legacy migration: create a root folder per distinct legacy
  // string and stamp `folderId` on its assets. Client-side under the
  // host-admin rules; ref-guarded so a mount runs it at most once.
  const migratedRef = useRef(false)
  useEffect(() => {
    if (migratedRef.current || !mediaDocs || !folderDocs) return
    const plan = Aglyn.planLegacyFolderMigration(
      mediaDocs as any[],
      folderDocs as any[],
    )
    if (!plan.assignments.length && !plan.foldersToCreate.length) return
    migratedRef.current = true
    const batch = writeBatch(firestore)
    const idByName: Record<string, string> = {}
    for (const folder of folderDocs as any[]) {
      if ((folder.parentId ?? null) === null) {
        idByName[String(folder.name).trim().toLowerCase()] = folder.$id
      }
    }
    for (const name of plan.foldersToCreate) {
      const ref = doc(collection(firestore, scopeCollection, scopeId, 'mediaFolders'))
      idByName[name.toLowerCase()] = ref.id
      batch.set(ref, { name, parentId: null, createdAt: serverTimestamp() })
    }
    for (const assignment of plan.assignments) {
      const folderId = idByName[assignment.folderName.toLowerCase()]
      if (!folderId) continue
      batch.update(doc(firestore, scopeCollection, scopeId, 'media', assignment.mediaId), {
        folderId,
      })
    }
    batch
      .commit()
      .then(() => setRefreshKey((key) => key + 1))
      .catch((error) => console.error('media migration', error))
  }, [mediaDocs, folderDocs, firestore, scopeId])

  // Organization (AGL-124): search + folder/tag filters over doc metadata.
  const [search, setSearch] = useState('')
  // Folder scoping (AGL-172): 'all' = every file, null = root/no folder.
  const [currentFolder, setCurrentFolder] = useState<string | null | 'all'>(
    'all',
  )
  const [tagFilter, setTagFilter] = useState('')
  // Sorting + type/date/size filters (AGL-134).
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'size'>(
    'newest',
  )
  const [typeFilter, setTypeFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')

  // Query construction (AGL-174). Query-side: folder scoping, single-tag
  // array-contains, type facet, date range, and sort. Two deliberate
  // downgrades keep the composite-index set small (documented in
  // cloud/firebase-firestore.indexes.json): the type facet goes
  // client-side when a tag filter is active or the sort isn't by date,
  // and the date range goes client-side whenever the type facet is
  // query-side (Firestore allows one range field). The client-side
  // filter pass below still applies everything within loaded pages, so
  // downgrades only affect which docs get fetched, never correctness of
  // what's shown.
  // Firestore permits ONE array-contains/array-contains-any per query, and
  // the scope filter has to be the one that survives — it is the security
  // constraint, and the tag filter already has a client-side twin below.
  const tagFilterServerSide = Boolean(tagFilter) && !needsScope
  const buildConstraints = useCallback(
    (cursor: QueryDocumentSnapshot | null): QueryConstraint[] => {
      const constraints: QueryConstraint[] = []
      const dateSort = sortBy === 'newest' || sortBy === 'oldest'
      if (typeof currentFolder === 'string' && currentFolder !== 'all') {
        constraints.push(where('folderId', '==', currentFolder))
      }
      if (needsScope) {
        constraints.push(
          where('visibleTo', 'array-contains-any', scopeTokens),
        )
      }
      if (tagFilterServerSide) {
        constraints.push(where('tags', 'array-contains', tagFilter))
      }
      const typeQuerySide = Boolean(typeFilter) && !tagFilter && dateSort
      if (typeQuerySide) {
        if (typeFilter === 'pdf') {
          constraints.push(where('contentType', '==', 'application/pdf'))
        } else {
          const prefix = typeFilter === 'video' ? 'video/' : 'image/'
          constraints.push(
            where('contentType', '>=', prefix),
            where('contentType', '<', `${prefix}`),
            orderBy('contentType'),
          )
        }
      }
      if (dateFilter && dateSort && (!typeQuerySide || typeFilter === 'pdf')) {
        const days = dateFilter === '7d' ? 7 : 30
        if (!typeQuerySide) {
          constraints.push(
            where(
              'createdAt',
              '>=',
              Timestamp.fromMillis(Date.now() - days * 86400 * 1000),
            ),
          )
        }
      }
      if (sortBy === 'name') constraints.push(orderBy('fileName'))
      else if (sortBy === 'size') constraints.push(orderBy('sizeBytes', 'desc'))
      else constraints.push(orderBy('createdAt', sortBy === 'oldest' ? 'asc' : 'desc'))
      if (cursor) constraints.push(startAfter(cursor))
      constraints.push(limit(MEDIA_PAGE_SIZE))
      return constraints
    },
    [
      currentFolder,
      tagFilter,
      tagFilterServerSide,
      typeFilter,
      dateFilter,
      sortBy,
      needsScope,
      scopeTokens,
    ],
  )
  const fetchPage = useCallback(
    async (cursor: QueryDocumentSnapshot | null) => {
      const snapshot = await firestoreOneShotRetry(
        () =>
          getDocs(
            query(
              collection(firestore, scopeCollection, scopeId, 'media'),
              ...buildConstraints(cursor),
            ),
          ),
        // Named for the session-health verdict (AGL-1063).
        `${scopeCollection}/media`,
      )
      return {
        docs: snapshot.docs.map((docSnap) => ({
          $id: docSnap.id,
          ...docSnap.data(),
        })),
        last: snapshot.docs[snapshot.docs.length - 1] ?? null,
        more: snapshot.docs.length === MEDIA_PAGE_SIZE,
      }
    },
    [firestore, scopeId, buildConstraints],
  )
  useEffect(() => {
    let active = true
    // Hold until the caller's read set is known — see `scopeReady`.
    if (!scopeReady) return undefined
    setLoadingMedia(true)
    setLoadError(null)
    void fetchPage(null)
      .then((page) => {
        if (!active) return
        setPages([page.docs])
        setPageCursor(page.last)
        setHasMore(page.more)
      })
      // Name the path and the scope state. "Missing or insufficient
      // permissions" with no context cost real time to diagnose — the
      // useful question is always WHICH collection, under WHICH scope,
      // with WHICH filter.
      .catch((error) => {
        console.error(
          `media query ${scopeCollection}/${scopeId}/media` +
            ` needsScope=${needsScope} tokens=${JSON.stringify(scopeTokens)}` +
            ` sort=${sortBy} folder=${String(currentFolder)}`,
          error,
        )
        // A FAILED load and an EMPTY library are different facts, and this
        // component was reporting both as "No media here — upload images…".
        // Someone whose query was denied was being told, confidently, that
        // they have no files: an invitation to re-upload assets that are
        // already there. Whatever the cause (AGL-1062), the page must not
        // claim knowledge it doesn't have.
        if (active) setLoadError(error?.code ?? 'unavailable')
      })
      .then(() => {
        if (active) setLoadingMedia(false)
      })
    return () => {
      active = false
    }
    // refreshKey re-runs after any mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, refreshKey, scopeReady])
  const handleLoadMore = useCallback(async () => {
    if (!pageCursor) return
    setLoadingMedia(true)
    try {
      const page = await fetchPage(pageCursor)
      setPages((prev) => [...prev, page.docs])
      setPageCursor(page.last)
      setHasMore(page.more)
    } catch (error) {
      console.error('media query', error)
    } finally {
      setLoadingMedia(false)
    }
  }, [fetchPage, pageCursor])
  const tags = useMemo(
    () =>
      [...new Set(items.flatMap((item: any) => item.tags ?? []))].sort(),
    [items],
  )
  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase()
    const now = Date.now() / 1000
    const filtered = items.filter((item: any) => {
      if (currentFolder === null && (item.folderId || item.folder)) {
        return false
      }
      if (
        typeof currentFolder === 'string' &&
        currentFolder !== 'all' &&
        item.folderId !== currentFolder &&
        // Legacy fallback: unmigrated docs match by folder name.
        item.folder !== folderNameById[currentFolder]
      ) {
        return false
      }
      if (tagFilter && !(item.tags ?? []).includes(tagFilter)) return false
      const contentType = String(item.contentType ?? '')
      if (typeFilter === 'image' && !contentType.startsWith('image/')) {
        return false
      }
      if (typeFilter === 'video' && !contentType.startsWith('video/')) {
        return false
      }
      if (typeFilter === 'pdf' && contentType !== 'application/pdf') {
        return false
      }
      const createdSeconds = item.createdAt?.seconds ?? 0
      if (dateFilter === '7d' && now - createdSeconds > 7 * 86400) return false
      if (dateFilter === '30d' && now - createdSeconds > 30 * 86400) {
        return false
      }
      const sizeBytes = item.sizeBytes ?? 0
      if (sizeFilter === '1mb' && sizeBytes < 1024 * 1024) return false
      if (sizeFilter === '5mb' && sizeBytes < 5 * 1024 * 1024) return false
      if (!term) return true
      const haystack = [
        item.fileName,
        item.folder,
        item.folderId ? folderNameById[item.folderId] : undefined,
        item.alt,
        item.description,
        ...(item.tags ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
    return [...filtered].sort((a: any, b: any) => {
      if (sortBy === 'name') {
        return String(a.fileName ?? '').localeCompare(String(b.fileName ?? ''))
      }
      if (sortBy === 'size') return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)
      if (sortBy === 'oldest') {
        return (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0)
      }
      return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
    })
  }, [
    items,
    search,
    currentFolder,
    folderNameById,
    tagFilter,
    typeFilter,
    dateFilter,
    sizeFilter,
    sortBy,
  ])

  // Folders-as-grid-items (AGL-818): render the current level's folders as
  // cards ahead of the files. The "parent context" is the open folder when
  // browsing into one, else root. The explicit "No folder" view and any
  // active search hide folder cards (you're looking at files, not nav).
  const folderParentContext =
    typeof currentFolder === 'string' && currentFolder !== 'all'
      ? currentFolder
      : null
  const showFolderCards = currentFolder !== null && !search.trim()
  const visibleFolders = useMemo(
    () =>
      showFolderCards
        ? folderList.filter(
            (folder) => (folder.parentId ?? null) === folderParentContext,
          )
        : [],
    [showFolderCards, folderList, folderParentContext],
  )

  // Rail counts via server-side count() so they stay accurate past the
  // paginated window; `root` = total minus foldered.
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    let active = true
    // Same wait as the grid — see `scopeReady`.
    if (!scopeReady) return undefined
    void Promise.all(
      folderList.map((folder) =>
        firestoreOneShotRetry(
          () =>
            getCountFromServer(
              query(
                collection(firestore, scopeCollection, scopeId, 'media'),
                where('folderId', '==', folder.$id),
                // Without this the count is an UNFILTERED list, which the
                // AGL-1042 rules deny per document for a scoped collaborator
                // — the `.catch` below then reports every folder as "0 files"
                // while the grid beside it shows the assets. Found by driving
                // the console as `scope-collab` (AGL-1047); needs the
                // folderId+visibleTo composite index, which the emulator does
                // NOT require and production does.
                ...(needsScope
                  ? [where('visibleTo', 'array-contains-any', scopeTokens)]
                  : []),
              ),
            ),
          // The SAME key as the grid's read above, deliberately: this is the
          // same collection under a second query shape, and counting it
          // twice would let one denied collection reach the two-collection
          // threshold on its own — the false prompt AGL-1063 must not fire.
          `${scopeCollection}/media`,
        )
          .then((snapshot) => [folder.$id, snapshot.data().count] as const)
          .catch(() => [folder.$id, 0] as const),
      ),
    ).then((entries) => {
      if (!active) return
      const counts = Object.fromEntries(entries)
      const foldered = entries.reduce((sum, [, count]) => sum + count, 0)
      counts['root'] = Math.max(0, totalCount - foldered)
      setFolderCounts(counts)
    })
    return () => {
      active = false
    }
  }, [
    folderList,
    firestore,
    scopeId,
    totalCount,
    refreshKey,
    needsScope,
    scopeTokens,
    scopeReady,
  ])

  // Breadcrumb chain for the open folder.
  const breadcrumb = useMemo(() => {
    if (typeof currentFolder !== 'string' || currentFolder === 'all') return []
    const foldersById = Object.fromEntries(
      folderList.map((folder) => [folder.$id, folder]),
    )
    const chain: Aglyn.AglynHostMediaFolder[] = []
    let cursor: string | null | undefined = currentFolder
    const seen = new Set<string>()
    while (cursor && foldersById[cursor] && !seen.has(cursor)) {
      seen.add(cursor)
      chain.unshift(foldersById[cursor])
      cursor = foldersById[cursor].parentId
    }
    return chain
  }, [currentFolder, folderList])

  // Folder CRUD (AGL-172) — shared validation from app-utils so the UI
  // can't create what enforcement would refuse.
  const foldersById = useMemo(
    () =>
      Object.fromEntries(folderList.map((folder) => [folder.$id, folder])),
    [folderList],
  )
  const handleFolderCreate = useCallback(
    async (rawName: string, parentId: string | null) => {
      const name = Aglyn.normalizeFolderName(rawName)
      if (!name) return null
      if (Aglyn.isSiblingNameTaken(name, parentId, folderList as any)) {
        enqueueSnackbar('A folder with that name already exists here', {
          variant: 'warning',
          persist: false,
        })
        return null
      }
      const parentDepth = parentId
        ? Aglyn.folderDepth(parentId, foldersById as any)
        : 0
      if (parentDepth + 1 > Aglyn.MEDIA_FOLDER_MAX_DEPTH) {
        enqueueSnackbar(
          `Folders can nest at most ${Aglyn.MEDIA_FOLDER_MAX_DEPTH} levels`,
          { variant: 'warning', persist: false },
        )
        return null
      }
      const ref = doc(collection(firestore, scopeCollection, scopeId, 'mediaFolders'))
      const batch = writeBatch(firestore)
      batch.set(ref, { name, parentId, createdAt: serverTimestamp() })
      await batch.commit()
      logActivity('Created media folder', { type: 'media', name })
      return ref.id
    },
    [firestore, scopeId, folderList, foldersById, enqueueSnackbar, logActivity],
  )
  const handleFolderRename = useCallback(
    async (folder: Aglyn.AglynHostMediaFolder, rawName: string) => {
      const name = Aglyn.normalizeFolderName(rawName)
      if (!name) return
      if (
        Aglyn.isSiblingNameTaken(
          name,
          folder.parentId ?? null,
          folderList as any,
          folder.$id,
        )
      ) {
        return void enqueueSnackbar(
          'A folder with that name already exists here',
          { variant: 'warning', persist: false },
        )
      }
      // API-routed: renaming a folder renames a REAL Storage prefix, so
      // the server relocates every asset underneath (urls follow).
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/media/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          ...scopeBody,
          action: 'rename',
          folderId: folder.$id,
          name,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Rename failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      refresh()
    },
    [firestore, scopeId, folderList, enqueueSnackbar, user, refresh],
  )
  const handleFolderDelete = useCallback(
    async (folder: Aglyn.AglynHostMediaFolder) => {
      const confirmed = await confirm({
        title: `Delete folder "${folder.name}"?`,
        description:
          'Its subfolders and files move up to the parent folder — nothing ' +
          'is deleted from storage.',
        confirmationText: 'Delete folder',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      const parentId = folder.parentId ?? null
      // API-routed (AGL-171 policy preserved): the server re-parents
      // children and assets AND moves their Storage objects up a level.
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/media/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          ...scopeBody,
          action: 'delete',
          folderId: folder.$id,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Delete failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      if (currentFolder === folder.$id) setCurrentFolder(parentId ?? 'all')
      refresh()
      logActivity('Deleted media folder', { type: 'media', name: folder.name })
    },
    [
      confirm,
      firestore,
      scopeId,
      folderList,
      items,
      currentFolder,
      logActivity,
      refresh,
    ],
  )

  // Folder create/rename prompt (AGL-818): a single small dialog shared by
  // the grid toolbar's "New folder" and each folder card's overflow menu.
  const [folderPrompt, setFolderPrompt] = useState<{
    title: string
    value: string
    action: (name: string) => Promise<void>
  } | null>(null)
  const [folderPromptBusy, setFolderPromptBusy] = useState(false)
  const handleFolderPromptSave = useCallback(async () => {
    if (!folderPrompt) return
    setFolderPromptBusy(true)
    try {
      await folderPrompt.action(folderPrompt.value)
      setFolderPrompt(null)
    } finally {
      setFolderPromptBusy(false)
    }
  }, [folderPrompt])

  /**
   * Turn one asset private, or publish it again (AGL-1051).
   *
   * Confirmed in BOTH directions, because both are one-way for anything
   * already pointing at the asset. Going private breaks every existing
   * embed of it; going public hands out a URL that then works forever, for
   * anyone it reaches — that is the property the private flag existed to
   * remove, so it deserves the same pause.
   */
  const setAssetPrivate = useCallback(
    async (mediaId: string, makePrivate: boolean) => {
      const confirmed = await confirm({
        title: makePrivate ? 'Make this file private?' : 'Publish this file?',
        description: makePrivate
          ? 'It will stop working anywhere it is already used, and can no ' +
            'longer be placed on a page. You will still be able to view and ' +
            'download it here through a temporary link.'
          : 'It gets a permanent public URL. Anyone that URL reaches can ' +
            'open the file, and there is no way to withdraw it afterwards.',
        confirmationText: makePrivate ? 'Make private' : 'Publish',
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/media/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          ...scopeBody,
          action: 'set-private',
          mediaId,
          private: makePrivate,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Could not update', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      refresh()
      enqueueSnackbar(makePrivate ? 'File is now private' : 'File published', {
        variant: 'success',
        persist: false,
      })
    },
    [user, scopeId, confirm, enqueueSnackbar, refresh],
  )

  // Multi-select + move (AGL-172): checkboxes are the accessible path;
  // dragging a selected card moves the whole selection.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moveAnchor, setMoveAnchor] = useState<HTMLElement | null>(null)
  const moveMedia = useCallback(
    async (mediaIds: string[], folderId: string | null) => {
      if (!mediaIds.length) return
      // API-routed: moving between folders moves the REAL objects too.
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/media/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          ...scopeBody,
          action: 'move-assets',
          mediaIds,
          folderId,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Move failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      setSelected(new Set())
      refresh()
      enqueueSnackbar(
        `Moved ${mediaIds.length} file${mediaIds.length === 1 ? '' : 's'}`,
        { variant: 'success', persist: false },
      )
    },
    [user, scopeId, enqueueSnackbar, refresh],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id)
      const overId = event.over ? String(event.over.id) : null
      if (!overId) return
      // Resolve the drop target folder (null = root). The rail uses
      // `folder:` ids; grid folder cards and breadcrumb crumbs use
      // `gridfolder:` so the two never register duplicate droppable ids.
      let targetId: string | null
      if (overId === 'folder:root' || overId === 'gridfolder:root') {
        targetId = null
      } else if (overId.startsWith('folder:')) {
        targetId = overId.slice(7)
      } else if (overId.startsWith('gridfolder:')) {
        targetId = overId.slice(11)
      } else {
        return
      }
      if (activeId.startsWith('media:')) {
        const mediaId = activeId.slice(6)
        const ids = selected.has(mediaId) ? [...selected] : [mediaId]
        void moveMedia(ids, targetId)
        return
      }
      // Folder drags come from the rail (`folderdrag:`) or a grid card
      // (`gridfolderdrag:`).
      const draggedFolderId = activeId.startsWith('gridfolderdrag:')
        ? activeId.slice(15)
        : activeId.startsWith('folderdrag:')
          ? activeId.slice(11)
          : null
      if (draggedFolderId) {
        const folderId = draggedFolderId
        if (folderId === targetId) return
        if (
          targetId &&
          Aglyn.wouldCreateCycle(folderId, targetId, foldersById as any)
        ) {
          return void enqueueSnackbar(
            'Cannot move a folder into itself or its subfolders',
            { variant: 'warning', persist: false },
          )
        }
        const folder = foldersById[folderId]
        if (!folder) return
        if (
          Aglyn.isSiblingNameTaken(
            folder.name,
            targetId,
            folderList as any,
            folderId,
          )
        ) {
          return void enqueueSnackbar(
            'A folder with that name already exists there',
            { variant: 'warning', persist: false },
          )
        }
        const targetDepth = targetId
          ? Aglyn.folderDepth(targetId, foldersById as any)
          : 0
        if (targetDepth + 1 > Aglyn.MEDIA_FOLDER_MAX_DEPTH) {
          return void enqueueSnackbar(
            `Folders can nest at most ${Aglyn.MEDIA_FOLDER_MAX_DEPTH} levels`,
            { variant: 'warning', persist: false },
          )
        }
        void updateDoc(
          doc(firestore, scopeCollection, scopeId, 'mediaFolders', folderId),
          { parentId: targetId },
        )
      }
    },
    [
      selected,
      moveMedia,
      foldersById,
      folderList,
      firestore,
      scopeId,
      enqueueSnackbar,
    ],
  )

  // Detail panel (AGL-173): drawer with preview, file facts, and all
  // metadata fields — folder is a picker over AGL-171 docs, tags are
  // normalized by the shared helper.
  const [editor, setEditor] = useState<{
    id: string
    media: any
    fileName: string
    folderId: string
    tags: string
    alt: string
    description: string
    // Custom metadata (AGL-822) edited as ordered rows, not a map, so
    // blank/duplicate keys are tolerable mid-edit and reorder is stable.
    customMeta: Array<{ key: string; value: string }>
    /** Scope tokens being edited (AGL-1045); org library only. */
    visibleTo: string[]
  } | null>(null)
  const handleEditorSave = useCallback(async () => {
    if (!editor) return
    const folderId = editor.folderId || null
    // Custom metadata (AGL-822): rows → record (last write wins, blank
    // keys dropped). Only round-trips to the server route — which touches
    // the Storage object — when it actually changed.
    const nextMeta = Object.fromEntries(
      editor.customMeta
        .map((row) => [row.key.trim(), row.value] as const)
        .filter(([key]) => key),
    )
    const prevMeta = (editor.media?.customMetadata ?? {}) as Record<
      string,
      string
    >
    const metaChanged =
      JSON.stringify(Object.entries(nextMeta).sort()) !==
      JSON.stringify(Object.entries(prevMeta).sort())
    const previousScope: string[] = Array.isArray(editor.media?.visibleTo)
      ? editor.media.visibleTo
      : [Aglyn.ORG_SCOPE_TOKEN]
    const scopeChanged =
      JSON.stringify([...previousScope].sort()) !==
      JSON.stringify([...editor.visibleTo].sort())
    // Narrowing can break a LIVE page (AGL-1045). Before taking an asset
    // away from a site, find out which sites actually use it and name them
    // — silently breaking a published client site is the worst outcome this
    // project could produce. Widening needs no confirmation.
    if (scopeChanged && Aglyn.narrowsScope(previousScope, editor.visibleTo)) {
      // Inline rather than reusing runReferenceAudit below: that one drives
      // the drawer's "Used on" panel state, and this needs a plain answer.
      const affected = await (async () => {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/media/references', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ ...scopeBody, mediaId: editor.id }),
        })
        if (!response.ok) throw new Error('scan failed')
        return ((await response.json())?.references ?? []) as MediaUsageRef[]
      })().catch(() => null)
      const losing = (affected ?? []).filter(
        (host) => !Aglyn.visibleToHost(editor.visibleTo, host.hostId),
      )
      const names = [...new Set(losing.map((host) => host.hostSubdomain))]
      const proceed = await confirm({
        title: 'Limit who can use this file?',
        description: names.length
          ? `${names.join(', ')} ${names.length === 1 ? 'uses' : 'use'} this ` +
            'file and will stop rendering it. This does not delete anything.'
          : affected === null
            ? 'Its current usage could not be checked. Any site losing ' +
              'access will stop rendering it.'
            : 'No page uses it yet, so nothing breaks today.',
        confirmationText: 'Limit access',
      })
        .then(() => true)
        .catch(() => false)
      if (!proceed) return
    }
    try {
      await updateDoc(
        doc(firestore, scopeCollection, scopeId, 'media', editor.id),
        {
          folderId,
          // Legacy string kept in sync until every reader is on folderId.
          folder: folderId ? (folderNameById[folderId] ?? '') : '',
          // Sharing scope (AGL-1045). Only an org-wide member may change
          // it — the AGL-1042 rules deny anyone else, so sending it would
          // fail the whole write rather than just this field.
          ...(orgId && viewerOrgWide && scopeChanged
            ? { visibleTo: Aglyn.normalizeVisibleTo(editor.visibleTo) ?? [Aglyn.ORG_SCOPE_TOKEN] }
            : {}),
          // Rename (AGL-184): display-name only; the Storage object id/URL
          // stays stable so existing references keep resolving.
          ...(editor.fileName.trim()
            ? { fileName: editor.fileName.trim().slice(0, 200) }
            : {}),
          tags: Aglyn.normalizeMediaTags(editor.tags),
          alt: editor.alt.trim().slice(0, Aglyn.MEDIA_ALT_MAX_LENGTH),
          description: editor.description.trim(),
        },
      )
      if (metaChanged) {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/media/folders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            ...scopeBody,
            action: 'custom-metadata',
            mediaId: editor.id,
            customMetadata: nextMeta,
          }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          throw new Error(payload?.error ?? 'Saving custom metadata failed')
        }
      }
      enqueueSnackbar('Media details saved', {
        variant: 'success',
        persist: false,
      })
      logActivity('Updated media details', {
        type: 'media',
        id: editor.id,
        name: editor.media?.fileName ?? editor.id,
      })
      setEditor(null)
      refresh()
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [editor, folderNameById, firestore, scopeId, user, enqueueSnackbar, logActivity, refresh])

  // Asset editing (AGL-184): replace-file + image transforms. AGL-827
  // generalized replace to any media so the card overflow menu can trigger
  // it without opening the drawer.
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [imageEditorOpen, setImageEditorOpen] = useState(false)
  const replaceMediaBytes = useCallback(
    async (media: any, base64: string, contentType: string) => {
      if (!media) return
      const mediaId = media.$id ?? media.id
      const idToken = await (user as any)?.getIdToken?.()
      const updatedAtMs =
        media?.updatedAt?.toMillis?.() ??
        (media?.updatedAt?.seconds ? media.updatedAt.seconds * 1000 : undefined)
      const response = await fetch('/api/media/replace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          ...scopeBody,
          mediaId,
          contentType,
          data: base64,
          ...(updatedAtMs ? { expectedUpdatedAtMs: updatedAtMs } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Replace failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar('Image replaced', { variant: 'success', persist: false })
      logActivity('Replaced media file', {
        type: 'media',
        id: mediaId,
        name: media?.fileName ?? mediaId,
      })
      setEditor(null)
      refresh()
    },
    [user, scopeId, enqueueSnackbar, logActivity, refresh],
  )
  const replaceBytes = useCallback(
    (base64: string, contentType: string) =>
      replaceMediaBytes(editor?.media, base64, contentType),
    [editor, replaceMediaBytes],
  )
  // Card-level replace (AGL-827): overflow "Replace file" opens a chooser
  // for that specific asset. A ref holds the target so click() isn't racing
  // a state update.
  const cardReplaceInputRef = useRef<HTMLInputElement>(null)
  const cardReplaceTargetRef = useRef<any>(null)
  const requestCardReplace = useCallback((media: any) => {
    cardReplaceTargetRef.current = media
    cardReplaceInputRef.current?.click()
  }, [])
  const handleCardReplaceFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      const media = cardReplaceTargetRef.current
      cardReplaceTargetRef.current = null
      if (!file || !media) return
      if (!file.type.startsWith('image/')) {
        return void enqueueSnackbar('Replace with an image file', {
          variant: 'warning',
          persist: false,
        })
      }
      setBusy(true)
      try {
        await replaceMediaBytes(media, await fileToBase64(file), file.type)
      } finally {
        setBusy(false)
      }
    },
    [replaceMediaBytes, enqueueSnackbar],
  )
  const handleReplaceFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file || !file.type.startsWith('image/')) return
      setBusy(true)
      try {
        await replaceBytes(await fileToBase64(file), file.type)
      } finally {
        setBusy(false)
      }
    },
    [replaceBytes],
  )

  // Bulk tag/delete (AGL-173) on the current selection.
  const [bulkTag, setBulkTag] = useState<{
    mode: 'add' | 'remove'
    value: string
  } | null>(null)
  const handleBulkTag = useCallback(async () => {
    if (!bulkTag) return
    const [tag] = Aglyn.normalizeMediaTags(bulkTag.value)
    if (!tag) return void setBulkTag(null)
    const batch = writeBatch(firestore)
    for (const item of items as any[]) {
      if (!selected.has(item.$id)) continue
      const tags: string[] = item.tags ?? []
      const next =
        bulkTag.mode === 'add'
          ? Aglyn.normalizeMediaTags([...tags, tag])
          : tags.filter((existing) => existing !== tag)
      batch.update(doc(firestore, scopeCollection, scopeId, 'media', item.$id), {
        tags: next,
      })
    }
    await batch.commit()
    setBulkTag(null)
    refresh()
    enqueueSnackbar(
      `${bulkTag.mode === 'add' ? 'Tagged' : 'Untagged'} ${selected.size} file${selected.size === 1 ? '' : 's'}`,
      { variant: 'success', persist: false },
    )
  }, [bulkTag, items, selected, firestore, scopeId, enqueueSnackbar, refresh])
  const handleBulkDelete = useCallback(async () => {
    const count = selected.size
    if (!count) return
    const confirmed = await confirm({
      title: `Delete ${count} file${count === 1 ? '' : 's'}?`,
      description:
        'The files are removed from storage. Elements using their URLs ' +
        'will stop rendering them.',
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      for (const mediaId of selected) {
        const response = await fetch('/api/media/upload', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ ...scopeBody, mediaId }),
        })
        if (!response.ok) throw new Error(`Delete failed (${response.status})`)
      }
      setSelected(new Set())
      refresh()
      enqueueSnackbar(`Deleted ${count} file${count === 1 ? '' : 's'}`, {
        variant: 'success',
        persist: false,
      })
      logActivity('Deleted media (bulk)', { type: 'media', name: `${count}` })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [selected, confirm, user, scopeId, enqueueSnackbar, logActivity, refresh])

  /**
   * "Shared with" for a whole selection or a whole folder (AGL-1045).
   *
   * One dialog for both, because they ask the same question and answering
   * it differently in two places is how the two paths drift. The drawer's
   * per-asset control stays where it is — it edits one asset alongside its
   * other fields, and folding it in here would mean opening a dialog to
   * rename a file.
   *
   * Org library only, and org-wide members only: the AGL-1042 rules deny a
   * scoped member the write, and a control that always fails is worse than
   * no control (same call as the drawer's read-only mode).
   */
  const [scopeDialog, setScopeDialog] = useState<{
    target:
      | { kind: 'selection'; ids: string[] }
      | { kind: 'folder'; id: string; name: string }
    visibleTo: string[]
    /** True when the chosen assets do not currently agree on a scope. */
    mixed: boolean
    /** Files under the folder — null while the count is in flight. */
    fileCount: number | null
    applyToFiles: boolean
  } | null>(null)
  /** Progress of the running apply, and where a failed one stopped. */
  const [scopeRun, setScopeRun] = useState<{
    done: number
    total: number
    running: boolean
  } | null>(null)
  const canShareScope = Boolean(orgId) && viewerOrgWide && !onSelect

  /** The scope stored on a media doc, defaulted the way the rules do. */
  const scopeOfMedia = useCallback((media: any): string[] => {
    const stored = Array.isArray(media?.visibleTo) ? media.visibleTo : null
    return stored?.length ? stored : [Aglyn.ORG_SCOPE_TOKEN]
  }, [])

  const openSelectionScope = useCallback(() => {
    const ids = [...selected]
    const scopes = ids.map((id) =>
      JSON.stringify(
        [...scopeOfMedia(items.find((item: any) => item.$id === id))].sort(),
      ),
    )
    const agreed = scopes.length && scopes.every((s) => s === scopes[0])
    setScopeRun(null)
    setScopeDialog({
      target: { kind: 'selection', ids },
      // Mixed selections start with nothing chosen. Pre-filling one of the
      // values would make Apply overwrite the others with a scope nobody
      // typed — the widening direction of that is a silent leak.
      visibleTo: agreed ? JSON.parse(scopes[0]) : [],
      mixed: !agreed,
      fileCount: ids.length,
      applyToFiles: true,
    })
  }, [selected, items, scopeOfMedia])

  const openFolderScope = useCallback(
    (folder: any) => {
      const stored = Array.isArray(folder?.visibleTo) ? folder.visibleTo : null
      setScopeRun(null)
      setScopeDialog({
        target: { kind: 'folder', id: folder.$id, name: folder.name },
        visibleTo: stored?.length ? stored : [Aglyn.ORG_SCOPE_TOKEN],
        mixed: false,
        fileCount: null,
        applyToFiles: true,
      })
      // Count the subtree so the prompt can name it. `preview` runs the
      // same walk the write does, so the number shown is the number that
      // will be touched — not a directory-only count that under-reports
      // every subfolder.
      void (async () => {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/media/folders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            ...scopeBody,
            action: 'set-scope',
            folderId: folder.$id,
            visibleTo: stored?.length ? stored : [Aglyn.ORG_SCOPE_TOKEN],
            preview: true,
          }),
        })
        const payload = await response.json().catch(() => ({}))
        const count = response.ok ? Number(payload?.assets ?? 0) : -1
        setScopeDialog((prev) =>
          prev && prev.target.kind === 'folder' && prev.target.id === folder.$id
            ? { ...prev, fileCount: count }
            : prev,
        )
      })()
    },
    [user, scopeId, orgId],
  )

  /**
   * Name the sites that lose a file before narrowing it.
   *
   * Bounded: the scan is one request per asset, so past a couple of dozen
   * it costs more than the answer is worth and the warning goes generic.
   * Returning `null` means "could not check", which the caller says out
   * loud rather than presenting as "nothing breaks".
   */
  const REFERENCE_SCAN_LIMIT = 20
  const sitesLosingAccess = useCallback(
    async (mediaIds: string[], nextScope: string[]) => {
      if (!mediaIds.length || mediaIds.length > REFERENCE_SCAN_LIMIT) return null
      const idToken = await (user as any)?.getIdToken?.()
      const scans = await Promise.all(
        mediaIds.map(async (mediaId) => {
          const response = await fetch('/api/media/references', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({ ...scopeBody, mediaId }),
          })
          if (!response.ok) throw new Error('scan failed')
          return ((await response.json())?.references ?? []) as MediaUsageRef[]
        }),
      ).catch(() => null)
      if (!scans) return null
      return [
        ...new Set(
          scans
            .flat()
            .filter((ref) => !Aglyn.visibleToHost(nextScope, ref.hostId))
            .map((ref) => ref.hostSubdomain),
        ),
      ]
    },
    [user, scopeId, orgId],
  )

  const applyScopeToSelection = useCallback(
    async (ids: string[], next: string[]) => {
      const narrowing = ids.filter((id) =>
        Aglyn.narrowsScope(
          scopeOfMedia(items.find((item: any) => item.$id === id)),
          next,
        ),
      )
      if (narrowing.length) {
        const names = await sitesLosingAccess(narrowing, next)
        const one = narrowing.length === 1
        const proceed = await confirm({
          title: `Limit who can use ${narrowing.length} file${one ? '' : 's'}?`,
          description: names?.length
            ? `${names.join(', ')} ${names.length === 1 ? 'uses' : 'use'} ` +
              `${one ? 'it' : 'these files'} and will stop rendering ` +
              `${one ? 'it' : 'them'}. This does not delete anything.`
            : names
              ? `No page uses ${one ? 'it' : 'them'} yet, so nothing breaks today.`
              : `Current usage was not checked. Any site losing access ` +
                `will stop rendering ${one ? 'it' : 'them'}.`,
          confirmationText: 'Limit access',
        })
          .then(() => true)
          .catch(() => false)
        if (!proceed) return false
      }
      setScopeRun({ done: 0, total: ids.length, running: true })
      // One write per doc rather than a batch: the rules evaluate per
      // document, and a batch fails whole — one asset the caller may not
      // write would take the other 49 down with it.
      for (const [index, id] of ids.entries()) {
        await updateDoc(doc(firestore, scopeCollection, scopeId, 'media', id), {
          visibleTo: Aglyn.normalizeVisibleTo(next) ?? [Aglyn.ORG_SCOPE_TOKEN],
        })
        setScopeRun({ done: index + 1, total: ids.length, running: true })
      }
      enqueueSnackbar(
        `Sharing updated for ${ids.length} file${ids.length === 1 ? '' : 's'}`,
        { variant: 'success', persist: false },
      )
      setSelected(new Set())
      return true
    },
    [items, scopeOfMedia, sitesLosingAccess, confirm, firestore, scopeCollection, scopeId, enqueueSnackbar],
  )

  const applyScopeToFolder = useCallback(
    async (folderId: string, next: string[], cascade: boolean, from: number) => {
      const idToken = await (user as any)?.getIdToken?.()
      let cursor = from
      // Corrected by the first response; the folder doc itself is one write,
      // so one is the floor.
      let total = Math.max(1, cursor)
      setScopeRun({ done: cursor, total, running: true })
      // Walked in slices so the dialog can show real progress on a folder
      // holding hundreds of files, and so a failure resumes from the last
      // committed slice instead of starting over.
      for (;;) {
        const response = await fetch('/api/media/folders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            ...scopeBody,
            action: 'set-scope',
            folderId,
            visibleTo: next,
            cascade,
            chunkStart: cursor,
            chunkSize: SCOPE_CHUNK_SIZE,
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          setScopeRun({ done: cursor, total, running: false })
          throw new Error(payload?.error ?? 'Applying sharing failed')
        }
        total = Number(payload?.total ?? total)
        cursor = Number(payload?.next ?? cursor)
        setScopeRun({ done: cursor, total, running: true })
        if (payload?.done !== false) break
      }
      const files = Math.max(0, total - 1)
      enqueueSnackbar(
        cascade
          ? `Sharing updated for the folder and ${files} file${files === 1 ? '' : 's'}`
          : 'Folder sharing updated',
        { variant: 'success', persist: false },
      )
      return true
    },
    [user, scopeId, orgId, enqueueSnackbar],
  )

  const handleScopeApply = useCallback(async () => {
    if (!scopeDialog) return
    const next = Aglyn.normalizeVisibleTo(scopeDialog.visibleTo)
    if (!next?.length) return
    try {
      const finished =
        scopeDialog.target.kind === 'selection'
          ? await applyScopeToSelection(scopeDialog.target.ids, next)
          : await applyScopeToFolder(
              scopeDialog.target.id,
              next,
              scopeDialog.applyToFiles,
              scopeRun && !scopeRun.running ? scopeRun.done : 0,
            )
      if (!finished) return setScopeRun(null)
      setScopeDialog(null)
      setScopeRun(null)
      refresh()
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [scopeDialog, scopeRun, applyScopeToSelection, applyScopeToFolder, enqueueSnackbar, refresh])

  // Per-asset delivery stats (AGL-176), loaded when the drawer opens: 30 days
  // of origin-serve counters from the analytics day-docs (edge cache hits
  // aren't counted — labeled as such). Cheap (30 doc reads), so it auto-loads;
  // the reference scan is the expensive part and stays on-demand below.
  const [usage, setUsage] = useState<{
    serves: number
    bytes: number
  } | null>(null)
  const editorId = editor?.id
  useEffect(() => {
    if (!editorId) {
      setUsage(null)
      return
    }
    let active = true
    void (async () => {
      const dayIds = Array.from({ length: 30 }, (_, index) => {
        const date = new Date()
        date.setDate(date.getDate() - index)
        return date.toISOString().slice(0, 10)
      })
      const stats = await Promise.all(
        dayIds.map((day) =>
          getDoc(doc(firestore, scopeCollection, scopeId, 'analytics', day))
            .then((snapshot) => {
              const media = snapshot.get('media') ?? {}
              return media[editorId] ?? { serves: 0, bytes: 0 }
            })
            .catch(() => ({ serves: 0, bytes: 0 })),
        ),
      )
      if (!active) return
      setUsage({
        serves: stats.reduce((sum, stat) => sum + Number(stat.serves ?? 0), 0),
        bytes: stats.reduce((sum, stat) => sum + Number(stat.bytes ?? 0), 0),
      })
    })()
    return () => {
      active = false
    }
  }, [editorId, scopeId, firestore])

  // "Used on" reference audit (AGL-845): scanning every published screen,
  // layout, and content entry for this asset's URLs is expensive, so it runs
  // ONLY when the user asks ("Find where this is used"), never on drawer open.
  const [refsAudit, setRefsAudit] = useState<{
    status: 'idle' | 'loading' | 'done' | 'error'
    items: MediaUsageRef[]
  }>({ status: 'idle', items: [] })
  // Reset the audit whenever the drawer switches assets.
  useEffect(() => {
    setRefsAudit({ status: 'idle', items: [] })
  }, [editorId])
  const runReferenceAudit = useCallback(async () => {
    if (!editorId) return
    setRefsAudit({ status: 'loading', items: [] })
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/media/references', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ ...scopeBody, mediaId: editorId }),
      })
      if (!response.ok) throw new Error(`Scan failed (${response.status})`)
      const payload = await response.json()
      setRefsAudit({
        status: 'done',
        items: (payload?.references ?? []) as MediaUsageRef[],
      })
    } catch (error) {
      console.error('media reference audit failed', error)
      setRefsAudit({ status: 'error', items: [] })
    }
  }, [editorId, user, scopeId])

  // Deep link for a reference row — the `[host]` segment is the subdomain,
  // and org assets can live on any of the org's sites (hence per-ref host).
  const referenceHref = useCallback(
    (reference: MediaUsageRef): string | null => {
      if (!orgSlug || !reference.hostSubdomain) return null
      if (reference.kind === 'screen' && reference.versionId) {
        return buildRoute(Route.SCREEN_DETAILS, {
          orgSlug,
          host: reference.hostSubdomain,
          screenId: reference.id,
          versionId: reference.versionId,
        })
      }
      if (reference.kind === 'layout') {
        return buildRoute(Route.LAYOUT_DETAILS, {
          orgSlug,
          host: reference.hostSubdomain,
          layoutId: reference.id,
        })
      }
      if (reference.kind === 'entry') {
        const base = buildRoute(Route.HOST_CONTENT, {
          orgSlug,
          host: reference.hostSubdomain,
        })
        return reference.collectionId
          ? `${base}?collection=${encodeURIComponent(reference.collectionId)}`
          : base
      }
      return null
    },
    [orgSlug],
  )

  // Single-file upload (AGL-820): extracted from the input handler so the
  // Upload button and drag-and-drop share one path. Returns bytes added on
  // success (0 when skipped/failed) so a batch can keep a running quota
  // estimate — the counter doc only refreshes after the whole batch.
  const uploadOne = useCallback(
    async (file: File, addedBytes: number): Promise<number> => {
      // Canonical type (AGL-1317): folds zip aliases and infers pdf/zip
      // from the name when the browser reports an empty type.
      const contentType = normalizeUploadContentType(file.type, file.name)
      const allowed =
        contentType.startsWith('image/') ||
        ['video/mp4', 'video/webm', 'video/quicktime'].includes(contentType) ||
        contentType === 'application/pdf' ||
        contentType === 'application/zip'
      if (!allowed) {
        enqueueSnackbar(
          `"${file.name}" skipped — supported uploads: images, mp4/webm video, PDF, ZIP`,
          { variant: 'warning', persist: false, allowDuplicate: true },
        )
        return 0
      }
      const usedMb = (usedBytes + addedBytes + file.size) / (1024 * 1024)
      const quota = checkOrgQuota(org, 'storagePerHostMb', usedMb - 1)
      if (!quota.allowed) {
        enqueueSnackbar(
          `Storage limit reached (${quota.limit} MB) — see Billing to upgrade`,
          { variant: 'warning', persist: false, allowDuplicate: true },
        )
        return 0
      }
      // Uploads land in the currently open folder (AGL-172).
      const uploadFolderId =
        typeof currentFolder === 'string' && currentFolder !== 'all'
          ? currentFolder
          : null
      try {
        const idToken = await (user as any)?.getIdToken?.()
        // Large files go direct-to-storage via signed URLs (AGL-167/1317):
        // Vercel 413s any request body over 4.5MB at the platform layer, so
        // the base64-JSON route can only carry ~3.3MB of raw file. Video,
        // PDF and ZIP above the threshold PUT straight to GCS instead.
        if (
          SIGNED_UPLOAD_MAX_BYTES[contentType] &&
          file.size > SIGNED_UPLOAD_THRESHOLD_BYTES
        ) {
          const mint = await fetch('/api/media/upload-url', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({
              ...scopeBody,
              contentType,
              fileName: file.name,
              sizeBytes: file.size,
              // The signed URL is bound to the folder's Storage path.
              folderId: uploadFolderId,
            }),
          })
          const minted = await mint.json().catch(() => ({}))
          if (!mint.ok || !minted?.uploadUrl) {
            enqueueSnackbar(minted?.error ?? `Upload failed for "${file.name}"`, {
              variant: 'error',
              allowDuplicate: true,
            })
            return 0
          }
          const put = await fetch(minted.uploadUrl, {
            method: 'PUT',
            // Must match the type the signed URL was minted for exactly.
            headers: { 'Content-Type': minted.contentType ?? contentType },
            body: file,
          })
          if (!put.ok) {
            enqueueSnackbar(`Upload failed for "${file.name}" — try again`, {
              variant: 'error',
              allowDuplicate: true,
            })
            return 0
          }
          const finalize = await fetch('/api/media/upload-url', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({
              ...scopeBody,
              mediaId: minted.mediaId,
              fileName: file.name,
              folderId: uploadFolderId,
            }),
          })
          const finalized = await finalize.json().catch(() => ({}))
          if (!finalize.ok) {
            enqueueSnackbar(finalized?.error ?? `Upload failed for "${file.name}"`, {
              variant: 'error',
              allowDuplicate: true,
            })
            return 0
          }
          enqueueSnackbar(`Uploaded "${file.name}"`, {
            variant: 'success',
            persist: false,
          })
          logActivity('Uploaded media', { type: 'media', name: file.name })
          return file.size
        }
        const response = await fetch('/api/media/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            ...scopeBody,
            fileName: file.name,
            contentType,
            folderId: uploadFolderId,
            data: await fileToBase64(file),
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          enqueueSnackbar(payload?.error ?? `Upload failed for "${file.name}"`, {
            variant: 'error',
            allowDuplicate: true,
          })
          return 0
        }
        enqueueSnackbar(`Uploaded "${file.name}"`, {
          variant: 'success',
          persist: false,
        })
        logActivity('Uploaded media', { type: 'media', name: file.name })
        return file.size
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`Upload failed for "${file.name}"`, {
          variant: 'error',
          allowDuplicate: true,
        })
        return 0
      }
    },
    [user, scopeId, org, usedBytes, currentFolder, enqueueSnackbar, logActivity],
  )

  // Batch upload (AGL-820): sequential so quota + counter stay sane; one
  // refresh at the end. Fed by the file input and by drag-and-drop.
  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      setBusy(true)
      let added = 0
      try {
        for (const file of files) {
          added += await uploadOne(file, added)
        }
      } finally {
        setBusy(false)
        refresh()
      }
    },
    [uploadOne, refresh],
  )

  const handleUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : []
      event.target.value = ''
      void handleFiles(files)
    },
    [handleFiles],
  )

  // Drag-and-drop upload (AGL-820): native HTML5 file drops are separate
  // from dnd-kit's pointer-based card dragging, so they don't conflict. A
  // depth counter tolerates dragenter/leave firing across child elements.
  const [isFileDropActive, setIsFileDropActive] = useState(false)
  const dropDepthRef = useRef(0)
  const isFileDrag = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')
  const handleFileDragEnter = useCallback((event: React.DragEvent) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dropDepthRef.current += 1
    setIsFileDropActive(true)
  }, [])
  const handleFileDragOver = useCallback((event: React.DragEvent) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])
  const handleFileDragLeave = useCallback((event: React.DragEvent) => {
    if (!isFileDrag(event)) return
    dropDepthRef.current -= 1
    if (dropDepthRef.current <= 0) {
      dropDepthRef.current = 0
      setIsFileDropActive(false)
    }
  }, [])
  const handleFileDrop = useCallback(
    (event: React.DragEvent) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      dropDepthRef.current = 0
      setIsFileDropActive(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      void handleFiles(files)
    },
    [handleFiles],
  )

  const handleCopyUrl = useCallback(
    (media: Aglyn.AglynHostMedia) => () => {
      // Prefer the stable CDN path (AGL-175/829) made ABSOLUTE with the
      // asset's public origin (AGL-831) so it's usable when pasted anywhere.
      // Older assets without a cdnPath fall back to the raw storage URL.
      const value = media.cdnPath
        ? `${assetOrigin}${media.cdnPath}`
        : media.url
      if (!value) return
      void navigator.clipboard.writeText(value)
      enqueueSnackbar('URL copied — paste it into an Image or Video element', {
        variant: 'success',
        persist: false,
      })
    },
    [assetOrigin, enqueueSnackbar],
  )

  const handleDelete = useCallback(
    (media: Aglyn.AglynHostMedia) => async () => {
      // Reference-aware warning (AGL-176): best-effort scan before the
      // confirm so a used asset gets a real warning, not a generic one.
      let referenceNote = ''
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/media/references', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ ...scopeBody, mediaId: media.$id }),
        })
        const payload = response.ok ? await response.json() : null
        const references: Array<{ name: string }> =
          payload?.references ?? []
        if (references.length) {
          referenceNote =
            ` WARNING: it is referenced in ${references.length} ` +
            `place${references.length === 1 ? '' : 's'} (${references
              .map((reference) => reference.name)
              .join(', ')}).`
        }
      } catch {
        // Scan is advisory; deletion stays possible without it.
      }
      const confirmed = await confirm({
        title: 'Delete this file?',
        description:
          `"${media.fileName ?? media.$id}" will be removed from storage. ` +
          'Elements using its URL will stop rendering it.' +
          referenceNote,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/media/upload', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ ...scopeBody, mediaId: media.$id }),
        })
        if (!response.ok) throw new Error(`Delete failed (${response.status})`)
        enqueueSnackbar('File deleted', { variant: 'success', persist: false })
        refresh()
        logActivity('Deleted media', {
          type: 'media',
          id: media.$id,
          name: media.fileName ?? media.$id,
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
    },
    [confirm, user, scopeId, enqueueSnackbar, logActivity, refresh],
  )

  const currentFolderName =
    typeof currentFolder === 'string' && currentFolder !== 'all'
      ? folderNameById[currentFolder]
      : null

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <Box
        onDragEnter={handleFileDragEnter}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}
        sx={{ position: 'relative' }}
      >
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <MediaFolderRail
          folders={folderList as any}
          current={currentFolder}
          onSelect={setCurrentFolder}
          counts={folderCounts}
          onCreate={handleFolderCreate}
          onRename={handleFolderRename}
          onDelete={handleFolderDelete}
          readOnly={Boolean(onSelect)}
        />
        <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Button
          variant="contained"
          color="primary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {'Upload media'}
        </Button>
        {onSelect ? null : (
          <Button
            variant="outlined"
            color="primary"
            onClick={() =>
              setFolderPrompt({
                title: folderParentContext
                  ? `New folder in "${folderNameById[folderParentContext] ?? ''}"`
                  : 'New folder',
                value: '',
                action: async (name) => {
                  await handleFolderCreate(name, folderParentContext)
                },
              })
            }
          >
            {'New folder'}
          </Button>
        )}
        <Typography variant="body2" color="text.secondary">
          {`${items.length}${totalCount > items.length ? ` of ${totalCount}` : ''} file${totalCount === 1 ? '' : 's'} · ${formatBytes(usedBytes)} used`}
        </Typography>
        <Box
          component="input"
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/mp4,video/webm,video/quicktime,application/pdf,application/zip,application/x-zip-compressed,.zip"
          onChange={handleUpload}
          sx={{ display: 'none' }}
        />
        <Box
          component="input"
          ref={cardReplaceInputRef}
          type="file"
          accept="image/*"
          onChange={handleCardReplaceFile}
          sx={{ display: 'none' }}
        />
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
      >
        <TextField
          size="small"
          label="Search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ minWidth: 200 }}
          helperText={
            hasMore ? 'Searches loaded files — Load more to widen' : undefined
          }
        />
        <TextField
          select
          size="small"
          label="Type"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          sx={{ minWidth: 110 }}
        >
          <MenuItem value="">{'All types'}</MenuItem>
          <MenuItem value="image">{'Images'}</MenuItem>
          <MenuItem value="video">{'Video'}</MenuItem>
          <MenuItem value="pdf">{'PDF'}</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="Uploaded"
          value={dateFilter}
          onChange={(event) => setDateFilter(event.target.value)}
          sx={{ minWidth: 120 }}
        >
          <MenuItem value="">{'Any time'}</MenuItem>
          <MenuItem value="7d">{'Last 7 days'}</MenuItem>
          <MenuItem value="30d">{'Last 30 days'}</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="Size"
          value={sizeFilter}
          onChange={(event) => setSizeFilter(event.target.value)}
          sx={{ minWidth: 110 }}
        >
          <MenuItem value="">{'Any size'}</MenuItem>
          <MenuItem value="1mb">{'Over 1 MB'}</MenuItem>
          <MenuItem value="5mb">{'Over 5 MB'}</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="Sort"
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as any)}
          sx={{ minWidth: 120 }}
        >
          <MenuItem value="newest">{'Newest'}</MenuItem>
          <MenuItem value="oldest">{'Oldest'}</MenuItem>
          <MenuItem value="name">{'Name'}</MenuItem>
          <MenuItem value="size">{'Largest'}</MenuItem>
        </TextField>
        {tags.length ? (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
            {tags.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                size="small"
                color={tagFilter === tag ? 'primary' : 'default'}
                onClick={() =>
                  setTagFilter((prev) => (prev === tag ? '' : tag))
                }
              />
            ))}
          </Stack>
        ) : null}
      </Stack>
      {breadcrumb.length ? (
        <Breadcrumbs>
          <CrumbDropZone targetId={null}>
            <Link
              component="button"
              variant="body2"
              underline="hover"
              color="inherit"
              onClick={() => setCurrentFolder('all')}
            >
              {'All files'}
            </Link>
          </CrumbDropZone>
          {breadcrumb.map((folder, index) =>
            index === breadcrumb.length - 1 ? (
              <Typography key={folder.$id} variant="body2">
                {folder.name}
              </Typography>
            ) : (
              <CrumbDropZone key={folder.$id} targetId={folder.$id}>
                <Link
                  component="button"
                  variant="body2"
                  underline="hover"
                  color="inherit"
                  onClick={() => setCurrentFolder(folder.$id)}
                >
                  {folder.name}
                </Link>
              </CrumbDropZone>
            ),
          )}
        </Breadcrumbs>
      ) : null}
      {!onSelect && selected.size ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2">
            {`${selected.size} selected`}
          </Typography>
          <Button
            size="small"
            onClick={(event) => setMoveAnchor(event.currentTarget)}
          >
            {'Move to folder…'}
          </Button>
          <Button
            size="small"
            onClick={() => setBulkTag({ mode: 'add', value: '' })}
          >
            {'Add tag…'}
          </Button>
          <Button
            size="small"
            onClick={() => setBulkTag({ mode: 'remove', value: '' })}
          >
            {'Remove tag…'}
          </Button>
          {canShareScope ? (
            <Button size="small" onClick={openSelectionScope}>
              {'Shared with…'}
            </Button>
          ) : null}
          <Button size="small" color="error" onClick={handleBulkDelete}>
            {'Delete…'}
          </Button>
          <Button size="small" onClick={() => setSelected(new Set())}>
            {'Clear'}
          </Button>
          <Menu
            anchorEl={moveAnchor}
            open={Boolean(moveAnchor)}
            onClose={() => setMoveAnchor(null)}
          >
            <MenuItem
              onClick={() => {
                setMoveAnchor(null)
                void moveMedia([...selected], null)
              }}
            >
              {'No folder'}
            </MenuItem>
            {folderList.map((folder) => (
              <MenuItem
                key={folder.$id}
                onClick={() => {
                  setMoveAnchor(null)
                  void moveMedia([...selected], folder.$id)
                }}
              >
                {folder.name}
              </MenuItem>
            ))}
          </Menu>
        </Stack>
      ) : null}
      {busy || loadingMedia ? <LinearProgress /> : null}
      {loadError && !loadingMedia ? (
        // Never the empty state: "no media" is a claim about the library,
        // and a failed read is a claim about us (AGL-1062).
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={refresh}>
              {'Retry'}
            </Button>
          }
        >
          {loadError === 'permission-denied'
            ? 'Your media could not be loaded — this account may not have access to this library, or the session needs refreshing. Nothing has been deleted.'
            : 'Your media could not be loaded. Nothing has been deleted — try again in a moment.'}
        </Alert>
      ) : visibleFolders.length === 0 && visibleItems.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {loadingMedia
            ? 'Loading media…'
            : 'No media here — upload images, video, or PDFs to use on your site.'}
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {visibleFolders.map((folder) => (
            <Grid
              key={`folder-${folder.$id}`}
              size={{ xs: 6, sm: 4, md: 3, lg: 2 }}
            >
              <MediaFolderCard
                folder={folder}
                count={folderCounts[folder.$id] ?? 0}
                onOpen={() => setCurrentFolder(folder.$id)}
                readOnly={Boolean(onSelect)}
                onNewSubfolder={() =>
                  setFolderPrompt({
                    title: `New folder in "${folder.name}"`,
                    value: '',
                    action: async (name) => {
                      await handleFolderCreate(name, folder.$id)
                    },
                  })
                }
                onRename={() =>
                  setFolderPrompt({
                    title: 'Rename folder',
                    value: folder.name,
                    action: (name) => handleFolderRename(folder, name),
                  })
                }
                onDelete={() => void handleFolderDelete(folder)}
                onSetScope={
                  canShareScope ? () => openFolderScope(folder) : undefined
                }
                scopeLabel={
                  orgId &&
                  Array.isArray((folder as any).visibleTo) &&
                  !Aglyn.isOrgWideScope((folder as any).visibleTo)
                    ? Aglyn.describeScope((folder as any).visibleTo, hostNameById)
                    : undefined
                }
              />
            </Grid>
          ))}
          {visibleItems.map((media: any) => (
            <Grid key={media.$id} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
              <DraggableCard
                mediaId={media.$id as string}
                disabled={Boolean(onSelect)}
              >
                <MediaAssetCard
                  media={media}
                  formatBytes={formatBytes}
                  onSelect={onSelect}
                  selectable={!onSelect}
                  selected={selected.has(media.$id as string)}
                  onToggleSelect={(checked) =>
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (checked) next.add(media.$id as string)
                      else next.delete(media.$id as string)
                      return next
                    })
                  }
                  onCopyUrl={handleCopyUrl(media)}
                  onReplace={
                    String(media.contentType ?? '').startsWith('image/')
                      ? () => requestCardReplace(media)
                      : undefined
                  }
                  onDetails={() =>
                    setEditor({
                      id: media.$id as string,
                      media,
                      fileName: (media as any).fileName ?? '',
                      folderId: (media as any).folderId ?? '',
                      tags: ((media as any).tags ?? []).join(', '),
                      alt: (media as any).alt ?? '',
                      description: (media as any).description ?? '',
                      customMeta: Object.entries(
                        (media as any).customMetadata ?? {},
                      ).map(([key, value]) => ({ key, value: String(value) })),
                      visibleTo: Array.isArray((media as any).visibleTo)
                        ? (media as any).visibleTo
                        : [Aglyn.ORG_SCOPE_TOKEN],
                    })
                  }
                  onDelete={handleDelete(media)}
                  // Org library only, and org-wide members only (AGL-1051).
                  // A host's own library is already unreachable from other
                  // sites, and the route refuses a scoped collaborator
                  // anyway — offering a control that always 403s is worse
                  // than not offering it.
                  onSetPrivate={
                    orgId && viewerOrgWide && !onSelect
                      ? (makePrivate) =>
                          void setAssetPrivate(media.$id as string, makePrivate)
                      : undefined
                  }
                />
              </DraggableCard>
            </Grid>
          ))}
        </Grid>
      )}
      {hasMore ? (
        <Button
          size="small"
          disabled={loadingMedia}
          onClick={handleLoadMore}
          sx={{ alignSelf: 'flex-start' }}
        >
          {'Load more'}
        </Button>
      ) : null}
      <Drawer
        anchor="right"
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
      >
        <Stack spacing={2} sx={{ width: 340, p: 2 }}>
          <TextField
            size="small"
            label="File name"
            value={editor?.fileName ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, fileName: event.target.value } : prev,
              )
            }
            helperText="Display name only — the URL stays the same"
          />
          {editor?.media?.url ? (
            String(editor.media.contentType ?? '').startsWith('video/') ? (
              <Box
                component="video"
                src={editor.media.url}
                controls
                muted
                sx={{ width: '100%', borderRadius: 1 }}
              />
            ) : String(editor.media.contentType ?? '').startsWith(
                'image/',
              ) ? (
              <Box
                component="img"
                src={editor.media.url}
                alt={editor.alt}
                sx={{
                  width: '100%',
                  maxHeight: 200,
                  objectFit: 'contain',
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                }}
              />
            ) : null
          ) : null}
          <Typography variant="caption" color="text.secondary" component="div">
            {[
              formatBytes(editor?.media?.sizeBytes ?? 0),
              editor?.media?.width && editor?.media?.height
                ? `${editor.media.width} × ${editor.media.height}px`
                : null,
              editor?.media?.contentType,
              editor?.media?.createdAt?.seconds
                ? new Date(
                    editor.media.createdAt.seconds * 1000,
                  ).toLocaleDateString()
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
          <Stack direction="row" spacing={1}>
            {editor?.media?.url ? (
              <Button size="small" onClick={handleCopyUrl(editor.media)}>
                {'Copy URL'}
              </Button>
            ) : null}
            {String(editor?.media?.contentType ?? '').startsWith('image/') ? (
              <>
                <Button
                  size="small"
                  onClick={() => replaceInputRef.current?.click()}
                >
                  {'Replace file'}
                </Button>
                <Button size="small" onClick={() => setImageEditorOpen(true)}>
                  {'Edit image'}
                </Button>
              </>
            ) : null}
          </Stack>
          <Box
            component="input"
            ref={replaceInputRef}
            type="file"
            accept="image/*"
            onChange={handleReplaceFile}
            sx={{ display: 'none' }}
          />
          <Typography variant="caption" color="text.secondary" component="div">
            {usage === null
              ? 'Checking delivery stats…'
              : usage.serves || usage.bytes
                ? `${usage.serves.toLocaleString()} origin serves / ${formatBytes(usage.bytes)} (30d, cache misses only)`
                : 'No origin serves in the last 30 days'}
          </Typography>
          <TextField
            select
            size="small"
            label="Folder"
            value={editor?.folderId ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, folderId: event.target.value } : prev,
              )
            }
          >
            <MenuItem value="">{'No folder'}</MenuItem>
            {folderList.map((folder) => (
              <MenuItem key={folder.$id} value={folder.$id}>
                {folder.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Tags"
            value={editor?.tags ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, tags: event.target.value } : prev,
              )
            }
            helperText="Comma-separated, e.g. hero, product"
          />
          <TextField
            size="small"
            label="Alt text"
            value={editor?.alt ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, alt: event.target.value } : prev,
              )
            }
          />
          <TextField
            size="small"
            label="Description"
            value={editor?.description ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
            multiline
            minRows={2}
          />
          {/* Sharing scope (AGL-1045). Org library only — a site's own
              library is private by construction. Read-only for scoped
              members: the AGL-1042 rules deny them the write, so offering
              a control that always fails would be worse than showing the
              value. */}
          {orgId ? (
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
                sx={{ mb: 0.5 }}
              >
                {'Shared with'}
              </Typography>
              {viewerOrgWide ? (
                <>
                  <Select
                    size="small"
                    fullWidth
                    value={
                      (editor?.visibleTo ?? []).includes(Aglyn.ORG_SCOPE_TOKEN)
                        ? 'org'
                        : 'hosts'
                    }
                    onChange={(event) =>
                      setEditor((prev) =>
                        prev
                          ? {
                              ...prev,
                              visibleTo:
                                event.target.value === 'org'
                                  ? [Aglyn.ORG_SCOPE_TOKEN]
                                  : // Default the narrowed case to the site
                                    // being browsed, or none — never a guess
                                    // at which sites the author meant.
                                    [],
                            }
                          : prev,
                      )
                    }
                  >
                    <MenuItem value="org">{'All sites'}</MenuItem>
                    <MenuItem value="hosts">{'Selected sites…'}</MenuItem>
                  </Select>
                  {!(editor?.visibleTo ?? []).includes(Aglyn.ORG_SCOPE_TOKEN) ? (
                    <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {orgHostList.map((host) => {
                        const token = Aglyn.hostScopeToken(host.$id)
                        const on = (editor?.visibleTo ?? []).includes(token)
                        return (
                          <Chip
                            key={host.$id}
                            size="small"
                            label={host.name ?? host.subdomain ?? host.$id}
                            color={on ? 'primary' : 'default'}
                            variant={on ? 'filled' : 'outlined'}
                            onClick={() =>
                              setEditor((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      visibleTo: on
                                        ? prev.visibleTo.filter((t) => t !== token)
                                        : [...prev.visibleTo, token],
                                    }
                                  : prev,
                              )
                            }
                          />
                        )
                      })}
                    </Box>
                  ) : null}
                </>
              ) : (
                <Typography variant="body2">
                  {Aglyn.describeScope(editor?.visibleTo, hostNameById)}
                </Typography>
              )}
            </Box>
          ) : null}
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              component="div"
              sx={{ mb: 0.5 }}
            >
              {'Custom metadata'}
            </Typography>
            <Stack spacing={1}>
              {(editor?.customMeta ?? []).map((row, index) => (
                <Stack
                  key={index}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <TextField
                    size="small"
                    label="Key"
                    value={row.key}
                    onChange={(event) =>
                      setEditor((prev) =>
                        prev
                          ? {
                              ...prev,
                              customMeta: prev.customMeta.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, key: event.target.value }
                                  : item,
                              ),
                            }
                          : prev,
                      )
                    }
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    size="small"
                    label="Value"
                    value={row.value}
                    onChange={(event) =>
                      setEditor((prev) =>
                        prev
                          ? {
                              ...prev,
                              customMeta: prev.customMeta.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, value: event.target.value }
                                  : item,
                              ),
                            }
                          : prev,
                      )
                    }
                    sx={{ flex: 1 }}
                  />
                  <IconButton
                    size="small"
                    aria-label="Remove field"
                    onClick={() =>
                      setEditor((prev) =>
                        prev
                          ? {
                              ...prev,
                              customMeta: prev.customMeta.filter(
                                (_item, itemIndex) => itemIndex !== index,
                              ),
                            }
                          : prev,
                      )
                    }
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() =>
                  setEditor((prev) =>
                    prev
                      ? {
                          ...prev,
                          customMeta: [
                            ...prev.customMeta,
                            { key: '', value: '' },
                          ],
                        }
                      : prev,
                  )
                }
                sx={{ alignSelf: 'flex-start' }}
              >
                {'Add field'}
              </Button>
            </Stack>
          </Box>
          {/* "Used on" audit (AGL-845): on-demand — the scan is expensive, so
              it runs only when the user asks, and lists each place the asset is
              referenced with a deep link to open it. */}
          <Box>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: 'center',
                justifyContent: 'space-between',
                mb: 0.5,
              }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
              >
                {'Used on'}
              </Typography>
              {refsAudit.status === 'done' ? (
                <Button size="small" onClick={runReferenceAudit}>
                  {'Rescan'}
                </Button>
              ) : null}
            </Stack>
            {refsAudit.status === 'idle' ? (
              <Button
                size="small"
                variant="outlined"
                onClick={runReferenceAudit}
                sx={{ alignSelf: 'flex-start' }}
              >
                {'Find where this is used'}
              </Button>
            ) : refsAudit.status === 'loading' ? (
              <Typography variant="body2" color="text.secondary">
                {'Scanning screens, layouts, and content…'}
              </Typography>
            ) : refsAudit.status === 'error' ? (
              <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
                <Typography variant="body2" color="warning.main">
                  {'Could not scan for usage — this is not the same as ' +
                    'nothing using it. Try again before deleting.'}
                </Typography>
                <Button size="small" onClick={runReferenceAudit}>
                  {'Try again'}
                </Button>
              </Stack>
            ) : refsAudit.items.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {'Not referenced by any published screen, layout, or content ' +
                  'entry.'}
              </Typography>
            ) : (
              <Stack spacing={0.75}>
                <Typography variant="caption" color="text.secondary">
                  {`Referenced in ${refsAudit.items.length} place${
                    refsAudit.items.length === 1 ? '' : 's'
                  }.`}
                </Typography>
                {refsAudit.items.map((reference) => {
                  const href = referenceHref(reference)
                  return (
                    <Stack
                      key={`${reference.kind}-${reference.hostId}-${reference.id}`}
                      direction="row"
                      spacing={1}
                      sx={{
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      {href ? (
                        <AppLink href={href}>{reference.name}</AppLink>
                      ) : (
                        <Typography variant="body2" noWrap>
                          {reference.name}
                        </Typography>
                      )}
                      <Chip
                        size="small"
                        variant="outlined"
                        label={REF_KIND_LABEL[reference.kind]}
                      />
                    </Stack>
                  )
                })}
              </Stack>
            )}
          </Box>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
            <Button
              variant="contained"
              color="primary"
              onClick={handleEditorSave}
            >
              {'Save'}
            </Button>
          </Stack>
        </Stack>
      </Drawer>
      <ImageEditorDialog
        open={imageEditorOpen}
        // Load via the same-origin cdnPath (AGL-832) so the editor canvas
        // stays untainted/exportable — the raw storage URL lacks CORS.
        src={editor?.media?.cdnPath ?? editor?.media?.url ?? ''}
        fileName={editor?.fileName || editor?.media?.fileName || 'image'}
        onClose={() => setImageEditorOpen(false)}
        onSave={async (result) => {
          setImageEditorOpen(false)
          if (result.saveAsCopy) {
            // Save-as-copy uploads a new asset via the upload path.
            setBusy(true)
            try {
              const idToken = await (user as any)?.getIdToken?.()
              const copyName = (editor?.fileName || 'image').replace(
                /(\.[^.]+)?$/,
                ' (edited)$1',
              )
              const response = await fetch('/api/media/upload', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
                },
                body: JSON.stringify({
                  ...scopeBody,
                  fileName: copyName,
                  contentType: result.contentType,
                  folderId:
                    typeof currentFolder === 'string' &&
                    currentFolder !== 'all'
                      ? currentFolder
                      : null,
                  data: result.data,
                }),
              })
              if (response.ok) {
                enqueueSnackbar('Saved edited copy', {
                  variant: 'success',
                  persist: false,
                })
                setEditor(null)
                refresh()
              } else {
                const payload = await response.json().catch(() => ({}))
                enqueueSnackbar(payload?.error ?? 'Save failed', {
                  variant: 'error',
                  allowDuplicate: true,
                })
              }
            } finally {
              setBusy(false)
            }
          } else {
            setBusy(true)
            try {
              await replaceBytes(result.data, result.contentType)
            } finally {
              setBusy(false)
            }
          }
        }}
      />
      <Dialog
        open={Boolean(bulkTag)}
        onClose={() => setBulkTag(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {bulkTag?.mode === 'remove'
            ? `Remove a tag from ${selected.size} files`
            : `Add a tag to ${selected.size} files`}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Tag"
            value={bulkTag?.value ?? ''}
            onChange={(event) =>
              setBulkTag((prev) =>
                prev ? { ...prev, value: event.target.value } : prev,
              )
            }
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkTag(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!bulkTag?.value.trim()}
            onClick={handleBulkTag}
          >
            {'Apply'}
          </Button>
        </DialogActions>
      </Dialog>
      {/* Sharing for a selection or a folder subtree (AGL-1045). */}
      <Dialog
        open={Boolean(scopeDialog)}
        onClose={() => {
          if (scopeRun?.running) return
          setScopeDialog(null)
          setScopeRun(null)
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {scopeDialog?.target.kind === 'folder'
            ? `Shared with — "${scopeDialog.target.name}"`
            : `Shared with — ${scopeDialog?.target.ids.length ?? 0} file${
                scopeDialog?.target.ids.length === 1 ? '' : 's'
              }`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {scopeDialog?.mixed ? (
              <Alert severity="info">
                {'These files are not shared the same way today. Choosing ' +
                  'here replaces the sharing on all of them.'}
              </Alert>
            ) : null}
            <Select
              size="small"
              fullWidth
              value={
                scopeDialog?.visibleTo.includes(Aglyn.ORG_SCOPE_TOKEN)
                  ? 'org'
                  : 'hosts'
              }
              onChange={(event) =>
                setScopeDialog((prev) =>
                  prev
                    ? {
                        ...prev,
                        visibleTo:
                          event.target.value === 'org'
                            ? [Aglyn.ORG_SCOPE_TOKEN]
                            : [],
                      }
                    : prev,
                )
              }
            >
              <MenuItem value="org">{'All sites'}</MenuItem>
              <MenuItem value="hosts">{'Selected sites…'}</MenuItem>
            </Select>
            {!scopeDialog?.visibleTo.includes(Aglyn.ORG_SCOPE_TOKEN) ? (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {orgHostList.map((host: any) => {
                  const token = Aglyn.hostScopeToken(host.$id)
                  const on = Boolean(scopeDialog?.visibleTo.includes(token))
                  return (
                    <Chip
                      key={host.$id}
                      size="small"
                      label={hostNameById[host.$id]}
                      color={on ? 'primary' : 'default'}
                      variant={on ? 'filled' : 'outlined'}
                      onClick={() =>
                        setScopeDialog((prev) =>
                          prev
                            ? {
                                ...prev,
                                visibleTo: on
                                  ? prev.visibleTo.filter((t) => t !== token)
                                  : [...prev.visibleTo, token],
                              }
                            : prev,
                        )
                      }
                    />
                  )
                })}
              </Box>
            ) : null}
            {scopeDialog?.target.kind === 'folder' ? (
              <>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={scopeDialog.applyToFiles}
                      onChange={(event) =>
                        setScopeDialog((prev) =>
                          prev
                            ? { ...prev, applyToFiles: event.target.checked }
                            : prev,
                        )
                      }
                    />
                  }
                  label={
                    scopeDialog.fileCount == null
                      ? 'Also apply to the files in this folder and its subfolders?'
                      : scopeDialog.fileCount < 0
                        ? 'Also apply to the files in this folder and its subfolders? (count unavailable)'
                        : `Also apply to the ${scopeDialog.fileCount} file${
                            scopeDialog.fileCount === 1 ? '' : 's'
                          } in this folder and its subfolders?`
                  }
                />
                <Typography variant="caption" color="text.secondary">
                  {'Files keep their own sharing — a folder applies its ' +
                    'setting when you save it, and moving a file into this ' +
                    'folder later does not re-share it.'}
                </Typography>
              </>
            ) : null}
            {scopeRun ? (
              <Box>
                <LinearProgress
                  variant="determinate"
                  value={
                    scopeRun.total
                      ? Math.min(100, (scopeRun.done / scopeRun.total) * 100)
                      : 0
                  }
                />
                <Typography variant="caption" color="text.secondary">
                  {scopeRun.running
                    ? `Updating ${scopeRun.done} of ${scopeRun.total}…`
                    : `Stopped after ${scopeRun.done} of ${scopeRun.total} — Apply resumes from here.`}
                </Typography>
              </Box>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={scopeRun?.running}
            onClick={() => {
              setScopeDialog(null)
              setScopeRun(null)
            }}
          >
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={
              scopeRun?.running ||
              !Aglyn.normalizeVisibleTo(scopeDialog?.visibleTo ?? [])?.length
            }
            onClick={handleScopeApply}
          >
            {scopeRun && !scopeRun.running ? 'Resume' : 'Apply'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(folderPrompt)}
        onClose={() => setFolderPrompt(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{folderPrompt?.title}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Name"
            value={folderPrompt?.value ?? ''}
            onChange={(event) =>
              setFolderPrompt((prev) =>
                prev ? { ...prev, value: event.target.value } : prev,
              )
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && folderPrompt?.value.trim()) {
                event.preventDefault()
                void handleFolderPromptSave()
              }
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFolderPrompt(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={folderPromptBusy || !folderPrompt?.value.trim()}
            onClick={handleFolderPromptSave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
        </Stack>
      </Stack>
      {isFileDropActive ? (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: (theme) => theme.zIndex.modal - 1,
            borderRadius: 1,
            border: '2px dashed',
            borderColor: 'primary.main',
            bgcolor: (theme) =>
              alpha(theme.palette.background.paper, 0.9),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <Stack spacing={1} sx={{ alignItems: 'center' }}>
            <CloudUploadIcon color="primary" sx={{ fontSize: 56 }} />
            <Typography variant="h6" color="primary">
              {'Drop files to upload'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {currentFolderName
                ? `into "${currentFolderName}"`
                : 'into the library'}
            </Typography>
          </Stack>
        </Box>
      ) : null}
      </Box>
    </DndContext>
  )
}
MediaLibraryComponent.displayName = 'MediaLibraryComponent'

export default MediaLibraryComponent
