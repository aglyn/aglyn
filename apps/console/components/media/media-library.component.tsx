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
  Box,
  Button,
  Card,
  CardActions,
  CardMedia,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  limit,
  query,
  updateDoc,
} from 'firebase/firestore'
import {
  type ChangeEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  useFirestore,
  useFirestoreCollectionData,
  useUser,
} from 'reactfire'
import { checkTenantQuota } from '../../constants/entitlements'
import useCurrentTenant from '../../hooks/use-current-tenant'
import useHostActivityLogger from '../../hooks/use-host-activity-logger'

export interface MediaLibraryComponentProps {
  hostId: string
  /** When set, clicking an item selects it instead of exposing row actions. */
  onSelect?: (media: Aglyn.AglynHostMedia) => void
}

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024))} KB`

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

  const { data: mediaDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'media'), limit(500)),
    { idField: '$id' },
  )
  const items: Aglyn.AglynHostMedia[] = [...(mediaDocs ?? [])]
    .filter((item: any) => !item.deletedAt)
    .sort(
      (a: any, b: any) =>
        (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
    )
  const usedBytes = items.reduce(
    (sum, item) => sum + (item.sizeBytes ?? 0),
    0,
  )

  // Organization (AGL-124): search + folder/tag filters over doc metadata.
  const [search, setSearch] = useState('')
  const [folderFilter, setFolderFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  // Sorting + type/date/size filters (AGL-134).
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'size'>(
    'newest',
  )
  const [typeFilter, setTypeFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const folders = useMemo(
    () =>
      [...new Set(items.map((item: any) => item.folder).filter(Boolean))].sort(),
    [items],
  )
  const tags = useMemo(
    () =>
      [...new Set(items.flatMap((item: any) => item.tags ?? []))].sort(),
    [items],
  )
  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase()
    const now = Date.now() / 1000
    const filtered = items.filter((item: any) => {
      if (folderFilter && item.folder !== folderFilter) return false
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
    folderFilter,
    tagFilter,
    typeFilter,
    dateFilter,
    sizeFilter,
    sortBy,
  ])

  // Metadata editor (folder, tags, alt text, description) — metadata lives
  // on the Firestore mirror doc, so host admins edit it client-side.
  const [editor, setEditor] = useState<{
    id: string
    fileName: string
    folder: string
    tags: string
    alt: string
    description: string
  } | null>(null)
  const handleEditorSave = useCallback(async () => {
    if (!editor) return
    const tagList = [
      ...new Set(
        editor.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ]
    await updateDoc(doc(firestore, 'hosts', hostId, 'media', editor.id), {
      folder: editor.folder.trim(),
      tags: tagList,
      alt: editor.alt.trim(),
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
          name: editor.fileName,
        })
        setEditor(null)
      })
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [editor, firestore, hostId, enqueueSnackbar, logActivity])

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
      try {
        const idToken = await (user as any)?.getIdToken?.()
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
    [user, hostId, tenant, usedBytes, enqueueSnackbar, logActivity],
  )

  const handleCopyUrl = useCallback(
    (media: Aglyn.AglynHostMedia) => () => {
      if (!media.url) return
      void navigator.clipboard.writeText(media.url)
      enqueueSnackbar('URL copied — paste it into an Image or Video element', {
        variant: 'success',
        persist: false,
      })
    },
    [enqueueSnackbar],
  )

  const handleDelete = useCallback(
    (media: Aglyn.AglynHostMedia) => async () => {
      const confirmed = await confirm({
        title: 'Delete this file?',
        description:
          `"${media.fileName ?? media.$id}" will be removed from storage. ` +
          'Elements using its URL will stop rendering it.',
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
    [confirm, user, hostId, enqueueSnackbar, logActivity],
  )

  return (
    <Stack spacing={2}>
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
          {`${items.length} file${items.length === 1 ? '' : 's'} · ${formatBytes(usedBytes)} used`}
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
        />
        <TextField
          select
          size="small"
          label="Folder"
          value={folderFilter}
          onChange={(event) => setFolderFilter(event.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">{'All folders'}</MenuItem>
          {folders.map((folder) => (
            <MenuItem key={folder} value={folder}>
              {folder}
            </MenuItem>
          ))}
        </TextField>
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
      {busy ? <LinearProgress /> : null}
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No media yet — upload images, video, or PDFs to use on your site.'}
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {visibleItems.map((media: any) => (
            <Grid key={media.$id} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
              <Card variant="outlined">
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
                            fileName: media.fileName ?? (media.$id as string),
                            folder: (media as any).folder ?? '',
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
            </Grid>
          ))}
        </Grid>
      )}
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{editor?.fileName}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            size="small"
            label="Folder"
            value={editor?.folder ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, folder: event.target.value } : prev,
              )
            }
            sx={{ mt: 1 }}
            helperText={
              folders.length ? `Existing: ${folders.join(', ')}` : undefined
            }
          />
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
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleEditorSave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
MediaLibraryComponent.displayName = 'MediaLibraryComponent'

export default MediaLibraryComponent
