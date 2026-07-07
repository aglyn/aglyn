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
import {
  collection,
  deleteDoc,
  doc,
  increment,
  limit,
  query,
  setDoc,
} from 'firebase/firestore'
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from 'firebase/storage'
import { type ChangeEvent, useCallback, useRef, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollectionData,
  useStorage,
} from 'reactfire'
import { checkTenantQuota } from '../../constants/entitlements'
import useCurrentTenant from '../../hooks/use-current-tenant'

export interface MediaLibraryComponentProps {
  hostId: string
  /** When set, clicking an item selects it instead of exposing row actions. */
  onSelect?: (media: Aglyn.AglynHostMedia) => void
}

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

/**
 * Per-host media library (AGL-72/73): uploads to Firebase Storage at
 * `hosts/{hostId}/media/{mediaId}` with a Firestore metadata mirror and a
 * bytes counter doc (`counters/media`) that feeds the storage quota meter.
 * Doubles as the browse grid inside MediaPickerDialog via `onSelect`.
 */
export function MediaLibraryComponent(props: MediaLibraryComponentProps) {
  const { hostId, onSelect } = props
  const firestore = useFirestore()
  const storage = useStorage()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { tenant } = useCurrentTenant()
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)

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

      const mediaId = Aglyn.createResourceUid()
      const objectRef = storageRef(storage, `hosts/${hostId}/media/${mediaId}`)
      setProgress(0)
      try {
        await new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(objectRef, file, {
            contentType: file.type,
          })
          task.on(
            'state_changed',
            (snapshot) =>
              setProgress(
                (snapshot.bytesTransferred / snapshot.totalBytes) * 100,
              ),
            reject,
            () => resolve(),
          )
        })
        const url = await getDownloadURL(objectRef)
        const timestamp = Timestamp.now()
        await setDoc(doc(firestore, 'hosts', hostId, 'media', mediaId), {
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          url,
          createdAt: timestamp,
        })
        await setDoc(
          doc(firestore, 'hosts', hostId, 'counters', 'media'),
          { bytes: increment(file.size), count: increment(1) },
          { merge: true },
        )
        enqueueSnackbar(`Uploaded "${file.name}"`, {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Upload failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setProgress(null)
      }
    },
    [storage, firestore, hostId, tenant, usedBytes, enqueueSnackbar],
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
        await deleteObject(
          storageRef(storage, `hosts/${hostId}/media/${media.$id}`),
        ).catch(() => {
          // Object may already be gone; still remove the metadata.
        })
        await deleteDoc(doc(firestore, 'hosts', hostId, 'media', media.$id))
        await setDoc(
          doc(firestore, 'hosts', hostId, 'counters', 'media'),
          {
            bytes: increment(-(media.sizeBytes ?? 0)),
            count: increment(-1),
          },
          { merge: true },
        )
        enqueueSnackbar('File deleted', { variant: 'success', persist: false })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
    },
    [confirm, storage, firestore, hostId, enqueueSnackbar],
  )

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Button
          variant="contained"
          color="secondary"
          disabled={progress !== null}
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
      {progress !== null ? (
        <LinearProgress variant="determinate" value={progress} />
      ) : null}
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
