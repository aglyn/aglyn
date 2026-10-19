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

import { mdiContentCopy, mdiQrcode } from '@aglyn/shared-data-mdi'
import { HelpTip, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { MdiIcon } from '@aglyn/shared-ui-jsx/components/mdi-icon'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { QRCodeSVG } from 'qrcode.react'
import { type FocusEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { docsHelp } from '../../constants/docs-links'

/** The folder `/api/media/photo-links` files a link's photos in. */
export const PHOTO_LINK_FOLDER_LABEL = 'From the owner'

const DAY_MS = 24 * 60 * 60 * 1000

/** One open link, as `/api/media/photo-links` lists it. */
export interface PhotoLinkRow {
  linkId: string
  createdAt: number
  expiresAt: number
  uploads: number
  remainingUploads: number
}

/** A link just made: the only moment its address is known. */
interface FreshPhotoLink {
  linkId: string
  url: string
  expiresAt: number
}

type ListState =
  | { kind: 'pending' }
  | { kind: 'ready'; links: PhotoLinkRow[] }
  /** `blocked`: the route refused the member, so no link can be made either. */
  | { kind: 'error'; message: string; blocked: boolean }

export interface PhotoLinkDialogProps {
  hostId: string
  open: boolean
  onClose: () => void
  /** Called once the closing transition has finished. */
  onExited?: () => void
}

const shortDate = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

const photoCount = (count: number): string => `${count} ${count === 1 ? 'photo' : 'photos'}`

/**
 * A photo link's QR code and address, as it is handed over (AGL-3957): the
 * code to scan, the address with a copy button, and a line under them. Drawn
 * by the photo link dialog and by the one-screen client build (AGL-3958),
 * which shows it inline while the owner scans it.
 */
export function PhotoLinkCode({ url, caption, size = 200 }: { url: string; caption?: ReactNode; size?: number }) {
  const { enqueueSnackbar } = useSnackbar()
  const copy = () => {
    void navigator.clipboard?.writeText(url)
    enqueueSnackbar('Link copied', { variant: 'success', persist: false })
  }
  return (
    <Stack spacing={2} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, alignItems: 'stretch' }}>
      <Box sx={{ display: 'flex', justifyContent: 'center', bgcolor: 'common.white', borderRadius: 1, py: 1 }}>
        <QRCodeSVG value={url} size={size} level="M" marginSize={2} title="Photo link QR code" role="img" />
      </Box>
      <TextField
        size="small"
        label="Link"
        value={url}
        fullWidth
        slotProps={{
          input: {
            readOnly: true,
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title="Copy link">
                  <IconButton aria-label="Copy link" edge="end" onClick={copy}>
                    <MdiIcon path={mdiContentCopy.path} fontSize="small" />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ),
          },
          htmlInput: { onFocus: (event: FocusEvent<HTMLInputElement>) => event.target.select() },
        }}
      />
      {caption ? (
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      ) : null}
    </Stack>
  )
}
PhotoLinkCode.displayName = 'PhotoLinkCode'

/**
 * A site's photo links (AGL-3957): an address and QR code a member hands to
 * the person with the photos — usually the business owner, on their phone —
 * so the photos land in the site's media library without a sign-in.
 *
 * The dialog lists the site's open links with what each has received and a
 * way to stop it, and makes new ones. The server keeps only a digest of a
 * link's secret, so a link's address and code are shown once, right after
 * it is made, and never again.
 */
export function PhotoLinkDialog(props: PhotoLinkDialogProps) {
  const { hostId, open, onClose, onExited } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [list, setList] = useState<ListState>({ kind: 'pending' })
  const [fresh, setFresh] = useState<FreshPhotoLink | null>(null)
  const [busy, setBusy] = useState<'create' | string | null>(null)

  const call = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await authorizedFetch(user, '/api/media/photo-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, ...body }),
      })
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
      return { ok: response.ok, status: response.status, payload }
    },
    [user, hostId],
  )

  const refresh = useCallback(async () => {
    try {
      const { ok, status, payload } = await call({ action: 'list' })
      if (ok) {
        setList({ kind: 'ready', links: (payload['links'] as PhotoLinkRow[] | undefined) ?? [] })
        return
      }
      setList({
        kind: 'error',
        message: String(payload['error'] ?? 'The photo links could not be loaded.'),
        blocked: status === 401 || status === 403 || status === 404 || status === 423,
      })
    } catch {
      setList({ kind: 'error', message: 'The photo links could not be loaded.', blocked: false })
    }
  }, [call])

  // Read on each opening, keyed by who and which site rather than by the
  // user object's identity, which a token refresh replaces.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const uid = user?.uid
  useEffect(() => {
    if (!open || !hostId || !uid) return
    setFresh(null)
    setList({ kind: 'pending' })
    void refreshRef.current()
  }, [open, hostId, uid])

  const create = async () => {
    setBusy('create')
    try {
      const { ok, payload } = await call({ action: 'create' })
      if (!ok || typeof payload['url'] !== 'string') {
        enqueueSnackbar(String(payload['error'] ?? 'The link could not be made'), {
          variant: 'warning',
          persist: false,
        })
        return
      }
      setFresh({
        linkId: String(payload['linkId']),
        url: payload['url'],
        expiresAt: Number(payload['expiresAt']),
      })
      await refresh()
    } catch {
      enqueueSnackbar('The link could not be made', { variant: 'warning', persist: false })
    } finally {
      setBusy(null)
    }
  }

  const revoke = async (link: PhotoLinkRow) => {
    // confirm() rejects on cancel, so the catch is the cancel path.
    try {
      await confirm({
        title: 'Stop this photo link?',
        description:
          'The link stops taking photos right away. Photos it already received stay in the library.',
        confirmationText: 'Revoke',
        confirmationButtonProps: { color: 'error' },
      })
    } catch {
      return
    }
    setBusy(link.linkId)
    try {
      const { ok, payload } = await call({ action: 'revoke', linkId: link.linkId })
      if (!ok) {
        enqueueSnackbar(String(payload['error'] ?? 'The link could not be revoked'), {
          variant: 'warning',
          persist: false,
        })
        return
      }
      if (fresh?.linkId === link.linkId) setFresh(null)
      enqueueSnackbar('Link revoked', { variant: 'success', persist: false })
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const freshRow = fresh && list.kind === 'ready' ? list.links.find((link) => link.linkId === fresh.linkId) : undefined
  const freshDays = fresh ? Math.max(1, Math.round((fresh.expiresAt - Date.now()) / DAY_MS)) : 0
  const blocked = list.kind === 'error' && list.blocked

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      maxWidth="xs"
      fullWidth
      slotProps={{ transition: { onExited } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {'Get photos from a phone'}
        <HelpTip {...docsHelp('media', { anchor: '#photo-link' })} sx={{ fontSize: '0.7em' }} />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <DialogContentText>
            {'The owner scans the code with their phone and picks the photos to send. No sign-in; ' +
              "the photos land in this site's media library."}
          </DialogContentText>

          {fresh ? (
            <PhotoLinkCode
              url={fresh.url}
              caption={
                `Works for ${freshDays} ${freshDays === 1 ? 'day' : 'days'}` +
                (freshRow ? ` and takes up to ${photoCount(freshRow.remainingUploads)}` : '') +
                `. Photos land in the folder “${PHOTO_LINK_FOLDER_LABEL}”.`
              }
            />
          ) : null}

          <Divider />
          <Typography variant="subtitle2">{'Open links'}</Typography>
          {list.kind === 'pending' ? (
            <Typography variant="body2" color="text.secondary">
              {'Checking for open links…'}
            </Typography>
          ) : list.kind === 'error' ? (
            <Alert
              severity={list.blocked ? 'info' : 'error'}
              action={
                list.blocked ? undefined : (
                  <Button color="inherit" size="small" onClick={() => void refresh()}>
                    {'Retry'}
                  </Button>
                )
              }
            >
              {list.message}
            </Alert>
          ) : list.links.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No open links.'}
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {list.links.map((link) => (
                <Stack
                  key={link.linkId}
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                  data-testid="photo-link-row"
                >
                  <Stack sx={{ minWidth: 0 }}>
                    <Typography variant="body2">
                      {`Made ${shortDate(link.createdAt)} · ${photoCount(link.uploads)} received`}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {`Works until ${shortDate(link.expiresAt)}`}
                    </Typography>
                  </Stack>
                  <Button
                    size="small"
                    color="error"
                    disabled={busy !== null}
                    onClick={() => void revoke(link)}
                    aria-label={`Revoke the link made ${shortDate(link.createdAt)}`}
                  >
                    {'Revoke'}
                  </Button>
                </Stack>
              ))}
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary">
            {"A link's address is shown only once, when it is made. To share one again, make a new link."}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy !== null} onClick={onClose}>
          {'Close'}
        </Button>
        <Button
          variant="contained"
          startIcon={<MdiIcon path={mdiQrcode.path} fontSize="small" />}
          disabled={busy !== null || blocked || list.kind === 'pending'}
          onClick={() => void create()}
        >
          {busy === 'create' ? 'Making…' : 'New link'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * {@link PhotoLinkDialog} as a page header mounts it: nothing until it is
 * first opened, so a closed dialog reads no user and fetches nothing, and
 * unmounted again once its closing transition has played.
 */
export function PhotoLinkDialogOnOpen(props: PhotoLinkDialogProps) {
  const { open, onExited } = props
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  if (!mounted) return null
  return (
    <PhotoLinkDialog
      {...props}
      onExited={() => {
        setMounted(false)
        onExited?.()
      }}
    />
  )
}

export default PhotoLinkDialogOnOpen
