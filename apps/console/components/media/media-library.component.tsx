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
  Grid,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { type ChangeEvent, useCallback, useRef, useState } from 'react'
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

  const handleUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      if (!file.type.startsWith('image/')) {
        return void enqueueSnackbar('Only image uploads are supported', {
          variant: 'warning',
          persist: false,
        })
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
      enqueueSnackbar('Image URL copied — paste it into an Image element', {
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
          {'Upload image'}
        </Button>
        <Typography variant="body2" color="text.secondary">
          {`${items.length} file${items.length === 1 ? '' : 's'} · ${formatBytes(usedBytes)} used`}
        </Typography>
        <Box
          component="input"
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          sx={{ display: 'none' }}
        />
      </Stack>
      {busy ? <LinearProgress /> : null}
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No media yet — upload an image to use it on your site.'}
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {items.map((media) => (
            <Grid key={media.$id} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
              <Card variant="outlined">
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
    </Stack>
  )
}
MediaLibraryComponent.displayName = 'MediaLibraryComponent'

export default MediaLibraryComponent
