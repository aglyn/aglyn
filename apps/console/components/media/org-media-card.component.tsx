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

import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Box,
  Button,
  Chip,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../../constants/docs-links'
import useFirestoreCollection from '../../hooks/use-firestore-collection'

/**
 * Organization media library (AGL-237): assets shared with every host in
 * the org — distinct from the host library above it, which stays private
 * to this host. Uploads/deletes go through /api/orgs/media so the
 * Storage object and its doc never drift.
 */
export function OrgMediaCard(props: { orgId: string | null }) {
  const { orgId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: items } = useFirestoreCollection<any>(
    () =>
      query(
        collection(
          firestore,
          'orgs',
          orgId ?? '-pending-',
          'media',
        ),
        limit(200),
      ),
    [firestore, orgId],
    { idField: '$id' },
  )

  if (!orgId) return null

  const request = async (body: Record<string, unknown>) => {
    const idToken = await (user as any)?.getIdToken?.()
    const response = await fetch('/api/orgs/media', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({ orgId, ...body }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      enqueueSnackbar(payload?.error ?? 'Org media request failed', {
        variant: 'warning',
      })
      return null
    }
    return payload
  }

  const handleUpload = async (file: File) => {
    setBusy(true)
    try {
      const buffer = await file.arrayBuffer()
      let binary = ''
      const bytes = new Uint8Array(buffer)
      for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index])
      }
      const payload = await request({
        action: 'upload',
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        dataBase64: btoa(binary),
      })
      if (payload) enqueueSnackbar(`Uploaded ${file.name}`, { variant: 'success' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <CardDisplay
      header={'Organization media (shared with all sites)'}
      help={docsHelp('media', {
        excerpt:
          'A shared library for the whole organization — any site can use ' +
          'these assets, unlike the site-private library.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
            {'Assets here can be used by any site in your organization; the ' +
              'library above stays private to this site.'}
          </Typography>
          <input
            ref={fileInput}
            type="file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleUpload(file)
              event.target.value = ''
            }}
          />
          <Button
            variant="contained"
            size="small"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {busy ? 'Uploading…' : 'Upload'}
          </Button>
        </Stack>
        {(items ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No organization media yet.'}
          </Typography>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 1.5,
            }}
          >
            {(items ?? []).map((item: any) => (
              <Stack
                key={item.$id}
                spacing={0.5}
                sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}
              >
                {String(item.contentType ?? '').startsWith('image/') ? (
                  <Box
                    component="img"
                    src={item.url}
                    alt={item.fileName}
                    sx={{ width: 1, height: 90, objectFit: 'cover', borderRadius: 0.5 }}
                  />
                ) : (
                  <Chip label={item.contentType ?? 'file'} size="small" />
                )}
                <Tooltip title={item.fileName}>
                  <Typography variant="caption" noWrap>
                    {item.fileName}
                  </Typography>
                </Tooltip>
                <Stack direction="row" spacing={0.5}>
                  <Button
                    size="small"
                    onClick={() => {
                      void navigator.clipboard.writeText(item.url)
                      enqueueSnackbar('URL copied', { variant: 'success' })
                    }}
                  >
                    {'Copy URL'}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={() =>
                      void confirm({
                        title: 'Delete org media?',
                        description: `${item.fileName} disappears from every site using it.`,
                      })
                        // confirm() resolves on accept and REJECTS on
                        // cancel — the catch is the cancel path.
                        .then(async () => {
                          await request({ action: 'delete', mediaId: item.$id })
                        })
                        .catch(() => {
                          // Cancelled — nothing to do.
                        })
                    }
                  >
                    {'Delete'}
                  </Button>
                </Stack>
              </Stack>
            ))}
          </Box>
        )}
      </Stack>
    </CardDisplay>
  )
}
OrgMediaCard.displayName = 'OrgMediaCard'
OrgMediaCard.aglyn = true

export default OrgMediaCard
