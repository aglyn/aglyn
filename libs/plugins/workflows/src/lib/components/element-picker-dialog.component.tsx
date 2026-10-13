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

import type { AglynHost } from '@aglyn/aglyn'
import {
  elementPickUrl,
  isElementPickMessage,
} from '@aglyn/aglyn/app-utils/element-pick-protocol'
import { siteLiveUrlForSlug } from '@aglyn/aglyn/app-utils/site-live-url'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'

/** How long a page gets to answer before the dialog says it did not. */
const READY_TIMEOUT_MS = 10_000

export interface ElementPickerDialogProps {
  hostId: string
  /** The page to open first; the home page when absent or not published. */
  initialPath?: string
  onPicked: (selector: string, label: string) => void
  onClose: () => void
}

/** The site's published pages as the picker lists them, home first. */
export function pickerPages(
  screens: Record<string, string> | undefined,
): { path: string; label: string }[] {
  const paths = new Set<string>(['/'])
  for (const slug of Object.values(screens ?? {})) {
    if (typeof slug !== 'string' || !slug) continue
    paths.add(slug.startsWith('/') ? slug : `/${slug}`)
  }
  return [...paths]
    .sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)))
    .map((path) => ({ path, label: path === '/' ? 'Home' : path }))
}

/**
 * The live-page element picker (AGL-3758): the site's page in a frame, in
 * pick mode, and the selector of whatever the builder clicks. Only a message
 * from THAT frame, from the page's own origin, is read.
 */
export default function ElementPickerDialog(props: ElementPickerDialogProps) {
  const { hostId, initialPath, onPicked, onClose } = props
  const firestore = useFirestore()
  const frame = useRef<HTMLIFrameElement | null>(null)
  const [host, setHost] = useState<AglynHost | null | undefined>(undefined)
  const [path, setPath] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  // The caller's handlers, current without re-arming the listener below.
  const handlers = useRef({ onPicked, onClose })
  handlers.current = { onPicked, onClose }

  useEffect(() => {
    let live = true
    getDoc(doc(firestore, 'hosts', hostId))
      .then((snapshot) => {
        if (live) setHost(snapshot.exists() ? (snapshot.data() as AglynHost) : null)
      })
      .catch(() => {
        if (live) setHost(null)
      })
    return () => {
      live = false
    }
  }, [firestore, hostId])

  const pages = useMemo(
    () => pickerPages(host?.screens as Record<string, string> | undefined),
    [host],
  )
  const current =
    path ??
    (initialPath && pages.some((page) => page.path === initialPath)
      ? initialPath
      : '/')
  const pageUrl = host ? siteLiveUrlForSlug(host, current) : undefined
  const src = pageUrl ? elementPickUrl(pageUrl) : undefined

  useEffect(() => {
    if (!src) return undefined
    setReady(false)
    setTimedOut(false)
    const origin = new URL(src).origin
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      if (event.origin !== origin) return
      if (!isElementPickMessage(event.data)) return
      if (event.data.event === 'ready') setReady(true)
      else if (event.data.event === 'cancel') handlers.current.onClose()
      else handlers.current.onPicked(event.data.selector, event.data.label)
    }
    window.addEventListener('message', onMessage)
    const timer = window.setTimeout(() => setTimedOut(true), READY_TIMEOUT_MS)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
    }
  }, [src])

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>{'Pick an element'}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <TextField
              select
              label="Page"
              value={current}
              onChange={(event) => setPath(event.target.value)}
              size="small"
              sx={{ minWidth: 220 }}
              disabled={!host}
            >
              {pages.map((page) => (
                <MenuItem key={page.path} value={page.path}>
                  {page.label}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="body2" color="text.secondary">
              {ready
                ? 'Click the element on the page below.'
                : 'Opening the page…'}
            </Typography>
          </Stack>
          {host === null || (host && !src) ? (
            <Alert severity="warning">
              {'This site has no address to open yet. Use a custom selector instead.'}
            </Alert>
          ) : null}
          {timedOut && !ready ? (
            <Alert severity="info">
              {'The page has not answered. Publish the site and try again, or use ' +
                'a custom selector.'}
            </Alert>
          ) : null}
          {src ? (
            <Box
              component="iframe"
              ref={frame}
              key={src}
              src={src}
              title="Site page to pick from"
              sx={{
                width: '100%',
                height: '65vh',
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'background.paper',
              }}
            />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
      </DialogActions>
    </Dialog>
  )
}
