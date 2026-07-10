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
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardActions,
  CardMedia,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  Grid,
  LinearProgress,
  Link,
  Menu,
  MenuItem,
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
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { checkTenantQuota } from '../../constants/entitlements'
import useCurrentTenant from '../../hooks/use-current-tenant'
import useFirestoreCollection from '../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../hooks/use-firestore-doc'
import useHostActivityLogger from '../../hooks/use-host-activity-logger'
import firestoreOneShotRetry from '../../utils/firestore-one-shot-retry'
import { ImageEditorDialog } from './image-editor-dialog.component'
import { MediaFolderRail } from './media-folder-rail.component'

export interface MediaLibraryComponentProps {
  hostId: string
  /** When set, clicking an item selects it instead of exposing row actions. */
  onSelect?: (media: Aglyn.AglynHostMedia) => void
}

/** Page size for cursor pagination (AGL-174). */
const MEDIA_PAGE_SIZE = 60

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
  const { hostId, onSelect } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { tenant } = useCurrentTenant()
  const logActivity = useHostActivityLogger(hostId)
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
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), [])
  const mediaDocs = useMemo(() => pages.flat(), [pages])
  const items: Aglyn.AglynHostMedia[] = useMemo(
    () => (mediaDocs as any[]).filter((item: any) => !item.deletedAt),
    [mediaDocs],
  )
  // Usage + total from the counter doc — accurate past pagination.
  const { data: mediaCounter } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'counters', 'media'),
    [firestore, hostId],
  )
  const usedBytes = Number(mediaCounter?.['bytes'] ?? 0)
  const totalCount = Number(mediaCounter?.['count'] ?? 0)

  // Folder hierarchy (AGL-171): first-class docs replace the AGL-124
  // free-text `folder` string. Legacy strings migrate lazily below.
  const { data: folderDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'mediaFolders'), limit(500)),
    [firestore, hostId],
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
      const ref = doc(collection(firestore, 'hosts', hostId, 'mediaFolders'))
      idByName[name.toLowerCase()] = ref.id
      batch.set(ref, { name, parentId: null, createdAt: serverTimestamp() })
    }
    for (const assignment of plan.assignments) {
      const folderId = idByName[assignment.folderName.toLowerCase()]
      if (!folderId) continue
      batch.update(doc(firestore, 'hosts', hostId, 'media', assignment.mediaId), {
        folderId,
      })
    }
    batch
      .commit()
      .then(() => setRefreshKey((key) => key + 1))
      .catch((error) => console.error('media migration', error))
  }, [mediaDocs, folderDocs, firestore, hostId])

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
  const buildConstraints = useCallback(
    (cursor: QueryDocumentSnapshot | null): QueryConstraint[] => {
      const constraints: QueryConstraint[] = []
      const dateSort = sortBy === 'newest' || sortBy === 'oldest'
      if (typeof currentFolder === 'string' && currentFolder !== 'all') {
        constraints.push(where('folderId', '==', currentFolder))
      }
      if (tagFilter) constraints.push(where('tags', 'array-contains', tagFilter))
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
    [currentFolder, tagFilter, typeFilter, dateFilter, sortBy],
  )
  const fetchPage = useCallback(
    async (cursor: QueryDocumentSnapshot | null) => {
      const snapshot = await firestoreOneShotRetry(() =>
        getDocs(
          query(
            collection(firestore, 'hosts', hostId, 'media'),
            ...buildConstraints(cursor),
          ),
        ),
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
    [firestore, hostId, buildConstraints],
  )
  useEffect(() => {
    let active = true
    setLoadingMedia(true)
    void fetchPage(null)
      .then((page) => {
        if (!active) return
        setPages([page.docs])
        setPageCursor(page.last)
        setHasMore(page.more)
      })
      .catch((error) => console.error('media query', error))
      .then(() => {
        if (active) setLoadingMedia(false)
      })
    return () => {
      active = false
    }
    // refreshKey re-runs after any mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, refreshKey])
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

  // Rail counts via server-side count() so they stay accurate past the
  // paginated window; `root` = total minus foldered.
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    let active = true
    void Promise.all(
      folderList.map((folder) =>
        firestoreOneShotRetry(() =>
          getCountFromServer(
            query(
              collection(firestore, 'hosts', hostId, 'media'),
              where('folderId', '==', folder.$id),
            ),
          ),
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
  }, [folderList, firestore, hostId, totalCount, refreshKey])

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
      const ref = doc(collection(firestore, 'hosts', hostId, 'mediaFolders'))
      const batch = writeBatch(firestore)
      batch.set(ref, { name, parentId, createdAt: serverTimestamp() })
      await batch.commit()
      logActivity('Created media folder', { type: 'media', name })
      return ref.id
    },
    [firestore, hostId, folderList, foldersById, enqueueSnackbar, logActivity],
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
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'mediaFolders', folder.$id),
        { name },
      )
    },
    [firestore, hostId, folderList, enqueueSnackbar],
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
      const batch = writeBatch(firestore)
      // Documented AGL-171 policy: re-parent children and assets.
      for (const child of folderList) {
        if ((child.parentId ?? null) === folder.$id) {
          batch.update(
            doc(firestore, 'hosts', hostId, 'mediaFolders', child.$id),
            { parentId },
          )
        }
      }
      for (const item of items as any[]) {
        if (item.folderId === folder.$id) {
          batch.update(doc(firestore, 'hosts', hostId, 'media', item.$id), {
            folderId: parentId,
          })
        }
      }
      batch.delete(doc(firestore, 'hosts', hostId, 'mediaFolders', folder.$id))
      await batch.commit()
      if (currentFolder === folder.$id) setCurrentFolder(parentId ?? 'all')
      refresh()
      logActivity('Deleted media folder', { type: 'media', name: folder.name })
    },
    [
      confirm,
      firestore,
      hostId,
      folderList,
      items,
      currentFolder,
      logActivity,
      refresh,
    ],
  )

  // Multi-select + move (AGL-172): checkboxes are the accessible path;
  // dragging a selected card moves the whole selection.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moveAnchor, setMoveAnchor] = useState<HTMLElement | null>(null)
  const moveMedia = useCallback(
    async (mediaIds: string[], folderId: string | null) => {
      if (!mediaIds.length) return
      const batch = writeBatch(firestore)
      for (const mediaId of mediaIds) {
        batch.update(doc(firestore, 'hosts', hostId, 'media', mediaId), {
          folderId,
          folder: folderId ? (folderNameById[folderId] ?? '') : '',
        })
      }
      await batch.commit()
      setSelected(new Set())
      refresh()
      enqueueSnackbar(
        `Moved ${mediaIds.length} file${mediaIds.length === 1 ? '' : 's'}`,
        { variant: 'success', persist: false },
      )
    },
    [firestore, hostId, folderNameById, enqueueSnackbar, refresh],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id)
      const overId = event.over ? String(event.over.id) : null
      if (!overId || !overId.startsWith('folder:')) return
      const targetId = overId === 'folder:root' ? null : overId.slice(7)
      if (activeId.startsWith('media:')) {
        const mediaId = activeId.slice(6)
        const ids = selected.has(mediaId) ? [...selected] : [mediaId]
        void moveMedia(ids, targetId)
        return
      }
      if (activeId.startsWith('folderdrag:')) {
        const folderId = activeId.slice(11)
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
          doc(firestore, 'hosts', hostId, 'mediaFolders', folderId),
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
      hostId,
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
  } | null>(null)
  const handleEditorSave = useCallback(async () => {
    if (!editor) return
    const folderId = editor.folderId || null
    await updateDoc(doc(firestore, 'hosts', hostId, 'media', editor.id), {
      folderId,
      // Legacy string kept in sync until every reader is on folderId.
      folder: folderId ? (folderNameById[folderId] ?? '') : '',
      // Rename (AGL-184): display-name only; the Storage object id/URL
      // stays stable so existing references keep resolving.
      ...(editor.fileName.trim()
        ? { fileName: editor.fileName.trim().slice(0, 200) }
        : {}),
      tags: Aglyn.normalizeMediaTags(editor.tags),
      alt: editor.alt.trim().slice(0, Aglyn.MEDIA_ALT_MAX_LENGTH),
      description: editor.description.trim(),
    })
      .then(() => {
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
      })
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [editor, folderNameById, firestore, hostId, enqueueSnackbar, logActivity, refresh])

  // Asset editing (AGL-184): replace-file + image transforms.
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [imageEditorOpen, setImageEditorOpen] = useState(false)
  const replaceBytes = useCallback(
    async (base64: string, contentType: string) => {
      if (!editor) return
      const idToken = await (user as any)?.getIdToken?.()
      const updatedAtMs =
        editor.media?.updatedAt?.toMillis?.() ??
        (editor.media?.updatedAt?.seconds
          ? editor.media.updatedAt.seconds * 1000
          : undefined)
      const response = await fetch('/api/media/replace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          mediaId: editor.id,
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
        id: editor.id,
        name: editor.media?.fileName ?? editor.id,
      })
      setEditor(null)
      refresh()
    },
    [editor, user, hostId, enqueueSnackbar, logActivity, refresh],
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
      batch.update(doc(firestore, 'hosts', hostId, 'media', item.$id), {
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
  }, [bulkTag, items, selected, firestore, hostId, enqueueSnackbar, refresh])
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
          body: JSON.stringify({ hostId, mediaId }),
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
  }, [selected, confirm, user, hostId, enqueueSnackbar, logActivity, refresh])

  // Per-asset usage (AGL-176), loaded when the drawer opens: on-demand
  // reference scan plus 30 days of origin-serve counters from the
  // analytics day-docs (edge cache hits aren't counted — labeled as such).
  const [usage, setUsage] = useState<{
    references: Array<{ kind: string; id: string; name: string }> | null
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
      const idToken = await (user as any)?.getIdToken?.()
      const referencesPromise = fetch('/api/media/references', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId, mediaId: editorId }),
      })
        .then((response) => (response.ok ? response.json() : { references: null }))
        .catch(() => ({ references: null }))
      const dayIds = Array.from({ length: 30 }, (_, index) => {
        const date = new Date()
        date.setDate(date.getDate() - index)
        return date.toISOString().slice(0, 10)
      })
      const statsPromise = Promise.all(
        dayIds.map((day) =>
          getDoc(doc(firestore, 'hosts', hostId, 'analytics', day))
            .then((snapshot) => {
              const media = snapshot.get('media') ?? {}
              return media[editorId] ?? { serves: 0, bytes: 0 }
            })
            .catch(() => ({ serves: 0, bytes: 0 })),
        ),
      )
      const [referencesResult, stats] = await Promise.all([
        referencesPromise,
        statsPromise,
      ])
      if (!active) return
      setUsage({
        references: referencesResult?.references ?? null,
        serves: stats.reduce((sum, stat) => sum + Number(stat.serves ?? 0), 0),
        bytes: stats.reduce((sum, stat) => sum + Number(stat.bytes ?? 0), 0),
      })
    })()
    return () => {
      active = false
    }
  }, [editorId, user, hostId, firestore])

  const handleUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      const allowed =
        file.type.startsWith('image/') ||
        ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type) ||
        file.type === 'application/pdf'
      if (!allowed) {
        return void enqueueSnackbar(
          'Supported uploads: images, mp4/webm video, PDF',
          { variant: 'warning', persist: false },
        )
      }
      const usedMb = (usedBytes + file.size) / (1024 * 1024)
      const quota = checkTenantQuota(tenant, 'storagePerHostMb', usedMb - 1)
      if (!quota.allowed) {
        return void enqueueSnackbar(
          `Storage limit reached (${quota.limit} MB) — see Billing to upgrade`,
          { variant: 'warning', persist: false },
        )
      }

      setBusy(true)
      // Uploads land in the currently open folder (AGL-172).
      const uploadFolderId =
        typeof currentFolder === 'string' && currentFolder !== 'all'
          ? currentFolder
          : null
      try {
        const idToken = await (user as any)?.getIdToken?.()
        // Large video goes direct-to-storage via signed URLs (AGL-167) —
        // base64 JSON bodies cap out around 25MB.
        if (file.type.startsWith('video/') && file.size > 20 * 1024 * 1024) {
          const mint = await fetch('/api/media/upload-url', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({
              hostId,
              contentType: file.type,
              sizeBytes: file.size,
            }),
          })
          const minted = await mint.json().catch(() => ({}))
          if (!mint.ok || !minted?.uploadUrl) {
            return void enqueueSnackbar(minted?.error ?? 'Upload failed', {
              variant: 'error',
              allowDuplicate: true,
            })
          }
          const put = await fetch(minted.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file,
          })
          if (!put.ok) {
            return void enqueueSnackbar('Upload failed — try again', {
              variant: 'error',
              allowDuplicate: true,
            })
          }
          const finalize = await fetch('/api/media/upload-url', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({
              hostId,
              mediaId: minted.mediaId,
              fileName: file.name,
              folderId: uploadFolderId,
            }),
          })
          const finalized = await finalize.json().catch(() => ({}))
          if (!finalize.ok) {
            return void enqueueSnackbar(
              finalized?.error ?? 'Upload failed',
              { variant: 'error', allowDuplicate: true },
            )
          }
          enqueueSnackbar(`Uploaded "${file.name}"`, {
            variant: 'success',
            persist: false,
          })
          logActivity('Uploaded media', { type: 'media', name: file.name })
          refresh()
          return
        }
        const response = await fetch('/api/media/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            hostId,
            fileName: file.name,
            contentType: file.type,
            folderId: uploadFolderId,
            data: await fileToBase64(file),
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'Upload failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
        enqueueSnackbar(`Uploaded "${file.name}"`, {
          variant: 'success',
          persist: false,
        })
        logActivity('Uploaded media', { type: 'media', name: file.name })
        refresh()
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Upload failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setBusy(false)
      }
    },
    [user, hostId, tenant, usedBytes, currentFolder, enqueueSnackbar, logActivity, refresh],
  )

  const handleCopyUrl = useCallback(
    (media: Aglyn.AglynHostMedia) => () => {
      // Prefer the immutable CDN path (AGL-175) — resolves on tenant
      // sites and in the editor alike and rides the edge cache. Older
      // assets without one fall back to the raw storage URL.
      const value = media.cdnPath ?? media.url
      if (!value) return
      void navigator.clipboard.writeText(value)
      enqueueSnackbar('URL copied — paste it into an Image or Video element', {
        variant: 'success',
        persist: false,
      })
    },
    [enqueueSnackbar],
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
          body: JSON.stringify({ hostId, mediaId: media.$id }),
        })
        const payload = response.ok ? await response.json() : null
        const references: Array<{ name: string }> =
          payload?.references ?? []
        if (references.length) {
          referenceNote =
            ` WARNING: it is used on ${references.length} published ` +
            `screen/layout${references.length === 1 ? '' : 's'} (${references
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
          body: JSON.stringify({ hostId, mediaId: media.$id }),
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
    [confirm, user, hostId, enqueueSnackbar, logActivity, refresh],
  )

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
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
          color="secondary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {'Upload media'}
        </Button>
        <Typography variant="body2" color="text.secondary">
          {`${items.length}${totalCount > items.length ? ` of ${totalCount}` : ''} file${totalCount === 1 ? '' : 's'} · ${formatBytes(usedBytes)} used`}
        </Typography>
        <Box
          component="input"
          ref={inputRef}
          type="file"
          accept="image/*,video/mp4,video/webm,video/quicktime,application/pdf"
          onChange={handleUpload}
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
                color={tagFilter === tag ? 'secondary' : 'default'}
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
          <Link
            component="button"
            variant="body2"
            underline="hover"
            color="inherit"
            onClick={() => setCurrentFolder('all')}
          >
            {'All files'}
          </Link>
          {breadcrumb.map((folder, index) =>
            index === breadcrumb.length - 1 ? (
              <Typography key={folder.$id} variant="body2">
                {folder.name}
              </Typography>
            ) : (
              <Link
                key={folder.$id}
                component="button"
                variant="body2"
                underline="hover"
                color="inherit"
                onClick={() => setCurrentFolder(folder.$id)}
              >
                {folder.name}
              </Link>
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
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {loadingMedia
            ? 'Loading media…'
            : 'No media here — upload images, video, or PDFs to use on your site.'}
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {visibleItems.map((media: any) => (
            <Grid key={media.$id} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
              <DraggableCard
                mediaId={media.$id as string}
                disabled={Boolean(onSelect)}
              >
              <Card variant="outlined" sx={{ position: 'relative' }}>
                {onSelect ? null : (
                  <Checkbox
                    size="small"
                    checked={selected.has(media.$id as string)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      setSelected((prev) => {
                        const next = new Set(prev)
                        if (event.target.checked) next.add(media.$id as string)
                        else next.delete(media.$id as string)
                        return next
                      })
                    }
                    sx={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      zIndex: 1,
                      bgcolor: 'background.paper',
                      borderRadius: '0 0 0 8px',
                      p: 0.25,
                    }}
                  />
                )}
                {String(media.contentType ?? '').startsWith('video/') ? (
                  <CardMedia
                    component="video"
                    src={media.url}
                    muted
                    onClick={onSelect ? () => onSelect(media) : undefined}
                    sx={{
                      height: 96,
                      objectFit: 'cover',
                      cursor: onSelect ? 'pointer' : undefined,
                    }}
                  />
                ) : media.contentType === 'application/pdf' ? (
                  <CardMedia
                    onClick={onSelect ? () => onSelect(media) : undefined}
                    sx={{
                      height: 96,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: 'action.hover',
                      typography: 'caption',
                      color: 'text.secondary',
                      cursor: onSelect ? 'pointer' : undefined,
                    }}
                  >
                    {'PDF'}
                  </CardMedia>
                ) : (
                  <CardMedia
                    component="img"
                    image={media.url}
                    alt={media.fileName ?? ''}
                    onClick={onSelect ? () => onSelect(media) : undefined}
                    sx={{
                      height: 96,
                      objectFit: 'cover',
                      cursor: onSelect ? 'pointer' : undefined,
                    }}
                  />
                )}
                <Box sx={{ px: 1, pt: 0.5 }}>
                  <Typography variant="caption" noWrap component="div">
                    {media.fileName ?? media.$id}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="div"
                  >
                    {formatBytes(media.sizeBytes ?? 0)}
                  </Typography>
                </Box>
                <CardActions sx={{ pt: 0 }}>
                  {onSelect ? (
                    <Button size="small" onClick={() => onSelect(media)}>
                      {'Select'}
                    </Button>
                  ) : (
                    <>
                      <Button size="small" onClick={handleCopyUrl(media)}>
                        {'Copy URL'}
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          setEditor({
                            id: media.$id as string,
                            media,
                            fileName: (media as any).fileName ?? '',
                            folderId: (media as any).folderId ?? '',
                            tags: ((media as any).tags ?? []).join(', '),
                            alt: (media as any).alt ?? '',
                            description: (media as any).description ?? '',
                          })
                        }
                      >
                        {'Details'}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={handleDelete(media)}
                      >
                        {'Delete'}
                      </Button>
                    </>
                  )}
                </CardActions>
              </Card>
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
              ? 'Checking usage…'
              : usage.references === null
                ? 'Usage check unavailable'
                : usage.references.length
                  ? `Used on ${usage.references.length}: ${usage.references
                      .map((reference) => reference.name)
                      .join(', ')}`
                  : 'Not referenced by any published screen or layout'}
            {usage && (usage.serves || usage.bytes)
              ? ` · ${usage.serves.toLocaleString()} origin serves / ${formatBytes(usage.bytes)} (30d, cache misses only)`
              : ''}
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
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
            <Button
              variant="contained"
              color="secondary"
              onClick={handleEditorSave}
            >
              {'Save'}
            </Button>
          </Stack>
        </Stack>
      </Drawer>
      <ImageEditorDialog
        open={imageEditorOpen}
        src={editor?.media?.url ?? ''}
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
                  hostId,
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
            color="secondary"
            disabled={!bulkTag?.value.trim()}
            onClick={handleBulkTag}
          >
            {'Apply'}
          </Button>
        </DialogActions>
      </Dialog>
        </Stack>
      </Stack>
    </DndContext>
  )
}
MediaLibraryComponent.displayName = 'MediaLibraryComponent'

export default MediaLibraryComponent
