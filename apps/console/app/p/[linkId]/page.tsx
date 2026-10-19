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
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * THE PAGE A SITE PHOTO LINK OPENS (AGL-3957), on a phone, with no sign-in.
 *
 * Whoever holds the link — the owner of the business a site is being built
 * for, standing at a booth — picks photos from their camera roll and they
 * land in the site's media library. The page is the whole of what they see
 * of the console, so it says what it is for, takes the photos one at a time
 * over whatever signal there is, and says when each one arrived.
 *
 * Each photo is drawn onto a canvas and re-encoded before it is sent: a
 * 12 MB camera original, or a HEIC the browser can show but the server
 * cannot read, becomes a JPEG no wider than 2560 px, which the server then
 * strips and stores. The canvas also drops the photo's metadata, so its GPS
 * position leaves the phone in no form at all.
 */

type LinkInfo = {
  site: { name: string }
  link: { remainingUploads: number; remainingBytes: number; expiresAt: number }
}

type Refusal = 'invalid' | 'expired' | 'revoked' | 'full' | 'busy' | 'failed'

type Item = {
  id: string
  name: string
  preview: string
  status: 'waiting' | 'preparing' | 'sending' | 'sent' | 'failed'
  error?: string
}

const REFUSAL_COPY: Record<Refusal, string> = {
  invalid: 'This link is not valid. Ask for a new one.',
  expired: 'This link has expired. Ask for a new one.',
  revoked: 'This link has been turned off.',
  full: 'This link has taken all the photos it can.',
  busy: 'Too many photos at once. Wait a minute and try again.',
  failed: 'Something went wrong. Try again in a moment.',
}

/** The longest edge a photo is sent at, and the most bytes one may be after encoding. */
const MAX_EDGE = 2560
const MAX_SENT_BYTES = 3 * 1024 * 1024

async function decodePhoto(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    // The element keeps its bitmap; the URL is only needed until decode.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

async function base64Of(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

/** The photo as it is sent: oriented, no wider than the edge, a JPEG unless the source is a PNG that fits. */
async function preparePhoto(file: File): Promise<{ contentType: string; data: string; fileName: string }> {
  const image = await decodePhoto(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  let blob: Blob | null = file.type === 'image/png' ? await toBlob(canvas, 'image/png', 1) : null
  if (!blob || blob.size > MAX_SENT_BYTES) {
    let quality = 0.86
    blob = await toBlob(canvas, 'image/jpeg', quality)
    while (blob && blob.size > MAX_SENT_BYTES && quality > 0.5) {
      quality -= 0.12
      blob = await toBlob(canvas, 'image/jpeg', quality)
    }
  }
  if (!blob) throw new Error('encode')
  const contentType = blob.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const stem = file.name.replace(/\.[^.]+$/, '') || 'photo'
  return { contentType, data: await base64Of(blob), fileName: `${stem}.${contentType === 'image/png' ? 'png' : 'jpg'}` }
}

/** The public route the page talks to. The token rides in each POST body, never in an address. */
const ENDPOINT = '/api/media/photo-links/public'

/**
 * The token `{linkId}.{secret}`: the id from the path, the secret from the
 * fragment. The fragment never leaves the browser, so the secret reaches the
 * server only inside a request body. Empty when either half is missing.
 */
function composeToken(linkId: string, hash: string): string {
  let secret: string
  try {
    secret = decodeURIComponent(hash.replace(/^#/, ''))
  } catch {
    return ''
  }
  return linkId && secret ? `${linkId}.${secret}` : ''
}

export default function PhotoLinkPage() {
  const params = useParams<{ linkId: string }>()
  const linkId = typeof params?.linkId === 'string' ? params.linkId : ''
  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const queue = useRef<Array<{ item: Item; file: File }>>([])
  const busy = useRef(false)
  const token = useRef('')

  useEffect(() => {
    token.current = composeToken(linkId, window.location.hash)
    // A link opened without its fragment cannot name a secret: refused here,
    // with no request sent.
    if (!token.current) {
      setRefusal('invalid')
      return undefined
    }
    let cancelled = false
    fetch(ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'open', token: token.current }),
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as Partial<LinkInfo> & { reason?: Refusal }
        if (cancelled) return
        if (response.ok && payload.site && payload.link) setInfo(payload as LinkInfo)
        else setRefusal(payload.reason ?? 'failed')
      })
      .catch(() => {
        if (!cancelled) setRefusal('failed')
      })
    return () => {
      cancelled = true
    }
  }, [linkId])

  const update = useCallback((id: string, patch: Partial<Item>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  // One photo at a time: a phone at a booth has one bar of signal, and two
  // uploads racing each other finish later than two in a row.
  const drain = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      while (queue.current.length) {
        const next = queue.current.shift()
        if (!next) break
        const { item, file } = next
        try {
          update(item.id, { status: 'preparing' })
          const prepared = await preparePhoto(file)
          update(item.id, { status: 'sending' })
          const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'store', token: token.current, ...prepared }),
          })
          const payload = (await response.json().catch(() => ({}))) as {
            ok?: boolean
            reason?: Refusal | 'type' | 'size' | 'refused'
            error?: string
            link?: LinkInfo['link']
          }
          if (response.ok && payload.ok) {
            update(item.id, { status: 'sent' })
            if (payload.link) setInfo((current) => (current ? { ...current, link: payload.link as LinkInfo['link'] } : current))
          } else {
            const reason = payload.reason
            const error =
              payload.error ??
              (reason && reason in REFUSAL_COPY ? REFUSAL_COPY[reason as Refusal] : REFUSAL_COPY.failed)
            update(item.id, { status: 'failed', error })
            if (reason === 'expired' || reason === 'revoked' || reason === 'full' || reason === 'invalid') {
              setRefusal(reason)
              queue.current = []
            }
          }
        } catch {
          update(item.id, { status: 'failed', error: 'This photo could not be read. Try another.' })
        }
      }
    } finally {
      busy.current = false
    }
  }, [update])

  const onPick = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return
      const picked = Array.from(files).map((file) => ({
        file,
        item: {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          preview: URL.createObjectURL(file),
          status: 'waiting' as const,
        },
      }))
      setItems((current) => [...current, ...picked.map((entry) => entry.item)])
      queue.current.push(...picked)
      void drain()
    },
    [drain],
  )

  const sent = items.filter((item) => item.status === 'sent').length
  const inFlight = items.some((item) => item.status === 'preparing' || item.status === 'sending' || item.status === 'waiting')
  const remaining = info?.link.remainingUploads ?? 0

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        bgcolor: 'background.default',
        display: 'flex',
        justifyContent: 'center',
        px: 2,
        py: 4,
      }}
    >
      <Stack spacing={3} sx={{ width: '100%', maxWidth: 480 }}>
        {!info && !refusal ? (
          <Stack spacing={2} sx={{ pt: 8, alignItems: 'center' }}>
            <CircularProgress aria-label="Opening the link" />
          </Stack>
        ) : null}

        {refusal && !items.length ? (
          <Alert severity={refusal === 'failed' || refusal === 'busy' ? 'error' : 'warning'}>{REFUSAL_COPY[refusal]}</Alert>
        ) : null}

        {info ? (
          <>
            <Stack spacing={1}>
              <Typography variant="h5" component="h1">
                {`Send photos to ${info.site.name}`}
              </Typography>
              <Typography color="text.secondary">
                {'Pick photos of your business from your phone: your work, your shop, your team, you. ' +
                  'They go straight into the website. Nothing else on your phone is read.'}
              </Typography>
            </Stack>

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                onPick(event.target.files)
                event.target.value = ''
              }}
            />
            <Button
              variant="contained"
              size="large"
              onClick={() => inputRef.current?.click()}
              disabled={Boolean(refusal) || remaining <= 0}
              sx={{ py: 1.5 }}
            >
              {items.length ? 'Choose more photos' : 'Choose photos'}
            </Button>
            {refusal && items.length ? <Alert severity="warning">{REFUSAL_COPY[refusal]}</Alert> : null}

            {items.length ? (
              <Stack spacing={1}>
                <Typography variant="subtitle2" color="text.secondary">
                  {inFlight ? `Sending… ${sent} of ${items.length} sent` : `${sent} of ${items.length} sent`}
                </Typography>
                {inFlight ? <LinearProgress aria-label="Sending photos" /> : null}
                <List disablePadding>
                  {items.map((item) => (
                    <ListItem key={item.id} disableGutters divider>
                      <ListItemAvatar>
                        <Avatar variant="rounded" src={item.preview} alt="" sx={{ width: 56, height: 56, mr: 1 }} />
                      </ListItemAvatar>
                      <ListItemText
                        primary={item.name}
                        secondary={item.error}
                        slotProps={{
                          primary: { noWrap: true },
                          secondary: { color: item.status === 'failed' ? 'error' : undefined },
                        }}
                      />
                      <Chip
                        size="small"
                        label={
                          item.status === 'sent'
                            ? 'Sent'
                            : item.status === 'failed'
                              ? 'Not sent'
                              : item.status === 'waiting'
                                ? 'Waiting'
                                : 'Sending'
                        }
                        color={item.status === 'sent' ? 'success' : item.status === 'failed' ? 'error' : 'default'}
                        variant={item.status === 'sent' || item.status === 'failed' ? 'filled' : 'outlined'}
                      />
                    </ListItem>
                  ))}
                </List>
                {!inFlight && sent === items.length ? (
                  <Alert severity="success">{'All sent. You can close this page, or choose more.'}</Alert>
                ) : null}
              </Stack>
            ) : null}

            <Typography variant="caption" color="text.secondary">
              {remaining > 0
                ? `This link takes ${remaining} more photo${remaining === 1 ? '' : 's'}.`
                : 'This link has taken all the photos it can.'}
            </Typography>
          </>
        ) : null}
      </Stack>
    </Box>
  )
}
