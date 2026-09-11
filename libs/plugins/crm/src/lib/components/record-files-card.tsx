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

import {
  CRM_MEDIA_IDS_FIELD,
  CRM_MEDIA_IDS_MAX,
  formatMediaRef,
  normalizeCrmMediaIds,
  pluginDocsHelp,
  resolveMediaSrc,
  useMediaPicker,
} from '@aglyn/aglyn'
import { mdiClose, mdiFileOutline, mdiPaperclip } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Box,
  Button,
  IconButton,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useSnackbar } from 'notistack'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useContactUpdate } from '../hooks/use-contact-update'

/** What one attached file is known by once its media document has been read. */
interface AttachedFile {
  mediaId: string
  fileName: string
  contentType: string
  alt: string
  /** The CDN URL the id resolves to, or undefined when it cannot be built. */
  src?: string
}

export interface RecordFilesCardProps {
  /** `['orgs', orgId]`, or `null` while the org is unresolved. */
  scope: readonly [string, string] | null
  /** The collection the record lives in under the org root. */
  collection: string
  /** The record's document id. */
  recordId: string
  /**
   * The holder whose facet the field belongs to, for a CONTACT.
   *
   * A contact's fields live per holder — an agency running two client brands
   * has one contact document between them, and a contract one client filed
   * is not the other's to see — so the field is a facet's, and a facet is the
   * server's to write (AGL-2804): a contact's files are saved through
   * `crm/contact-update`, which writes the holder's facet and refuses a plan
   * without the CRM suite. `null` for a company or a deal, whose fields are
   * the organization's, sit at the top of the document and are written here.
   */
  facetGroupId?: string | null
  /**
   * The site a contact's files are saved as: the mounted site, or `null` at
   * the organization level, where the route writes each contact through its
   * own holder. Read only for a contact.
   */
  hostId?: string | null
  /** The ids the record currently carries. */
  mediaIds: readonly string[] | undefined
  /**
   * The manual page this card's help opens — each record kind documents its
   * own Files section, and a card that pointed all three at one page would
   * send a company's reader to a page about people.
   */
  topic: 'contactRecord' | 'companies' | 'deals'
}

/**
 * FILES ON A RECORD (AGL-2662): the organization's library, attached.
 *
 * ## Ids, not URLs
 *
 * The field stores media DOCUMENT ids and resolves them to the CDN at read
 * time. A stored URL names an object's current location and dies on a folder
 * move; it also pins a private asset to a raw storage link rather than the
 * signed door that checks who is asking. `media-ref.ts` already made this
 * choice for every placement on a page, and this is the same choice for a
 * record.
 *
 * ## The picker is the console's, reached through the bridge
 *
 * The media library is coupled to the org and session context and lives in
 * the console app, which a plugin may not import — so this asks for one
 * through `MediaPickerContext`, the same door the commerce product editor
 * uses. Where no provider is mounted the card says so rather than offering a
 * button that does nothing.
 *
 * ## One read per attached file, and only for the files attached
 *
 * A name and a type are on the media document, not in the id, so each
 * attachment costs one `getDoc` — bounded by {@link CRM_MEDIA_IDS_MAX} and
 * paid only on a record that actually carries files. A file the library no
 * longer holds is still listed, by its id and as missing: an attachment that
 * silently vanished is worse than one that says it is gone.
 */
export function RecordFilesCard(props: RecordFilesCardProps) {
  const { scope, collection, recordId, facetGroupId, hostId, mediaIds, topic } = props
  const firestore = useFirestore()
  const { pickMedia } = useMediaPicker()
  const { enqueueSnackbar } = useSnackbar()
  const contactUpdate = useContactUpdate(hostId ?? null)
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState<AttachedFile[] | null>(null)

  const ids = useMemo(() => normalizeCrmMediaIds(mediaIds), [mediaIds])
  const key = ids.join('\n')
  const orgId = scope?.[1] ?? ''

  useEffect(() => {
    if (!orgId) return undefined
    const wanted = key ? key.split('\n') : []
    if (!wanted.length) {
      setFiles([])
      return undefined
    }
    let live = true
    void Promise.all(
      wanted.map(async (mediaId) => {
        try {
          const snapshot = await getDoc(
            doc(firestore, 'orgs', orgId, 'media', mediaId),
          )
          const data = (snapshot.data() ?? {}) as Record<string, unknown>
          return {
            mediaId,
            fileName: String(data['fileName'] ?? ''),
            contentType: String(data['contentType'] ?? ''),
            alt: String(data['alt'] ?? ''),
            src: resolveMediaSrc(
              formatMediaRef(`org:${orgId}`, mediaId) ?? undefined,
            ),
          }
        } catch {
          // A file the reader may not see, or one that is gone. Listed and
          // named as unreadable rather than dropped — an attachment that
          // silently disappears reads as one that was never made.
          return { mediaId, fileName: '', contentType: '', alt: '' }
        }
      }),
    ).then((resolved) => {
      if (live) setFiles(resolved)
    })
    return () => {
      live = false
    }
  }, [firestore, orgId, key])

  const write = useCallback(
    async (next: string[]) => {
      if (!scope) return
      if (facetGroupId) {
        await contactUpdate.updateOne(recordId, { mediaIds: next })
        return
      }
      await updateDoc(doc(firestore, scope[0], scope[1], collection, recordId), {
        [CRM_MEDIA_IDS_FIELD]: next,
        updatedAt: serverTimestamp(),
      })
    },
    [firestore, scope, collection, recordId, facetGroupId, contactUpdate],
  )

  const handleAttach = useCallback(async () => {
    if (!pickMedia || busy) return
    const picked = await pickMedia()
    if (!picked?.mediaId) return
    if (ids.includes(picked.mediaId)) {
      enqueueSnackbar('That file is already attached', { variant: 'info' })
      return
    }
    if (ids.length >= CRM_MEDIA_IDS_MAX) {
      enqueueSnackbar(
        `A record holds at most ${CRM_MEDIA_IDS_MAX} files — remove one first.`,
        { variant: 'warning' },
      )
      return
    }
    setBusy(true)
    try {
      await write(normalizeCrmMediaIds([...ids, picked.mediaId]))
    } catch {
      enqueueSnackbar('The file could not be attached', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }, [pickMedia, busy, ids, write, enqueueSnackbar])

  const handleRemove = useCallback(
    async (mediaId: string) => {
      if (busy) return
      setBusy(true)
      try {
        await write(ids.filter((id) => id !== mediaId))
      } catch {
        enqueueSnackbar('The file could not be removed', { variant: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [busy, ids, write, enqueueSnackbar],
  )

  return (
    <CardDisplay
      header={'Files'}
      help={pluginDocsHelp(topic, {
        anchor: '#files',
        excerpt:
          'Files from the organization library attached to this record. ' +
          'Stored by id, so a file moved between folders keeps its ' +
          'attachment and a private one is still served through the signed ' +
          'door.',
      })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            size="small"
            startIcon={<MdiIcon path={mdiPaperclip.path} size={0.8} />}
            disabled={!scope || !pickMedia || busy}
            onClick={() => void handleAttach()}
          >
            {'Attach…'}
          </Button>
        ),
      }}
    >
      <Stack spacing={1}>
        {!pickMedia ? (
          <Alert severity="info">
            {'The media library is not available on this surface.'}
          </Alert>
        ) : null}
        {files === null ? (
          <Typography variant="body2" color="text.secondary">
            {'Reading…'}
          </Typography>
        ) : files.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No files attached.'}
          </Typography>
        ) : (
          files.map((file) => (
            <Stack
              key={file.mediaId}
              direction="row"
              spacing={1.5}
              sx={{ alignItems: 'center' }}
            >
              {file.src && file.contentType.startsWith('image/') ? (
                <Box
                  component="img"
                  src={file.src}
                  alt={file.alt || file.fileName}
                  sx={{
                    width: 40,
                    height: 40,
                    objectFit: 'cover',
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'divider',
                  }}
                />
              ) : (
                <MdiIcon
                  path={mdiFileOutline.path}
                  size={1}
                  sx={{ color: 'text.disabled' }}
                />
              )}
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                {file.src ? (
                  <Link
                    href={file.src}
                    target="_blank"
                    rel="noreferrer"
                    variant="body2"
                    noWrap
                  >
                    {file.fileName || file.mediaId}
                  </Link>
                ) : (
                  <Typography variant="body2" noWrap>
                    {file.fileName || file.mediaId}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary" noWrap>
                  {file.fileName
                    ? file.contentType || 'Unknown type'
                    : 'This file is no longer in the library, or you cannot see it'}
                </Typography>
              </Stack>
              <IconButton
                size="small"
                aria-label={`Remove ${file.fileName || file.mediaId}`}
                disabled={busy || !scope}
                onClick={() => void handleRemove(file.mediaId)}
              >
                <MdiIcon path={mdiClose.path} size={0.8} />
              </IconButton>
            </Stack>
          ))
        )}
      </Stack>
    </CardDisplay>
  )
}
RecordFilesCard.displayName = 'RecordFilesCard'

export default RecordFilesCard
