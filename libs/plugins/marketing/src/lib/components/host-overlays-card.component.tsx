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

import { type AglynTenant, checkEntitlement, createResourceUid } from '@aglyn/aglyn'
import { overlayActiveAt, type HostOverlay } from '../model'
import { mdiChevronDown, mdiChevronUp } from '@aglyn/shared-data-mdi'
import {
  CardDisplay,
  MdiIcon,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  Button,
  Chip,
  IconButton,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { collection, deleteDoc, doc, limit, query, setDoc } from 'firebase/firestore'
import { useState } from 'react'
import { useFirestore, useFirestoreCollection, useHostActivityLogger } from '@aglyn/tenant-feature-instance'

export interface HostOverlaysCardProps {
  hostId: string
  /** Resolved entitlement source (AGL-395). */
  tenant?: Partial<AglynTenant>
}

type OverlayDraft = HostOverlay & { $id?: string }

const EMPTY_BAR: OverlayDraft = {
  kind: 'bar',
  enabled: true,
  bar: { dismissible: true },
}
const EMPTY_POPUP: OverlayDraft = {
  kind: 'popup',
  enabled: true,
  popup: { trigger: 'delay', triggerValue: 3, frequencyDays: 7 },
}

function toDatetimeLocal(ms?: number): string {
  if (!ms) return ''
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

function fromDatetimeLocal(value: string): number | undefined {
  if (!value) return undefined
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

function parsePatterns(value: string): string[] {
  return value
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
}

/**
 * Marketing hub overlays manager (AGL-251): multiple announcement bars
 * and popups at `hosts/{hostId}/overlays`, each with a schedule window
 * and page targeting; the tenant render shows the first active match per
 * kind (overlay docs win over the legacy single bar/popup fields).
 */
export function HostOverlaysCard(props: HostOverlaysCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { tenant } = props
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const logActivity = useHostActivityLogger(hostId)
  const entitled = checkEntitlement(tenant, 'marketingOverlays')

  const { data: overlayDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'overlays'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const overlays: OverlayDraft[] = [...(overlayDocs ?? [])].sort(
    (a, b) =>
      (a.order ?? 0) - (b.order ?? 0) ||
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )

  const [editor, setEditor] = useState<OverlayDraft | null>(null)
  const patch = (partial: Partial<OverlayDraft>) =>
    setEditor((previous) => (previous ? { ...previous, ...partial } : previous))
  const patchBar = (partial: Partial<NonNullable<OverlayDraft['bar']>>) =>
    setEditor((previous) =>
      previous
        ? { ...previous, bar: { ...(previous.bar ?? {}), ...partial } }
        : previous,
    )
  const patchPopup = (partial: Partial<NonNullable<OverlayDraft['popup']>>) =>
    setEditor((previous) =>
      previous
        ? { ...previous, popup: { ...(previous.popup ?? {}), ...partial } }
        : previous,
    )

  const handleSave = async () => {
    if (!editor) return
    if (editor.kind === 'bar' && !editor.bar?.text?.trim()) {
      return void enqueueSnackbar('Enter the bar text', {
        variant: 'warning',
        persist: false,
      })
    }
    if (editor.kind === 'popup' && !editor.popup?.body?.trim()) {
      return void enqueueSnackbar('Enter the popup body', {
        variant: 'warning',
        persist: false,
      })
    }
    const id = editor.$id ?? createResourceUid()
    const {
      $id: _ignored,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...payload
    } = editor as OverlayDraft & { createdAt?: unknown; updatedAt?: unknown }
    try {
      // JSON round-trip strips undefined values Firestore rejects.
      const cleaned = JSON.parse(
        JSON.stringify({
          ...payload,
          name: (editor.name ?? '').trim() || null,
        }),
      )
      await setDoc(doc(firestore, 'hosts', hostId, 'overlays', id), {
        ...cleaned,
        updatedAt: Timestamp.now(),
        ...(editor.$id ? {} : { createdAt: Timestamp.now() }),
      })
      enqueueSnackbar('Overlay saved', { variant: 'success', persist: false })
      logActivity(editor.$id ? 'Updated overlay' : 'Created overlay', {
        type: 'content',
        id,
        ...(editor.name ? { name: editor.name } : {}),
      })
      setEditor(null)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    }
  }

  const handleDelete = async (overlay: OverlayDraft) => {
    if (!overlay.$id) return
    const confirmed = await confirm({
      title: 'Delete overlay?',
      description: `"${overlay.name ?? overlay.$id}" stops showing immediately.`,
      confirmationButtonProps: { color: 'error' },
    })
    if (!confirmed) return
    await deleteDoc(doc(firestore, 'hosts', hostId, 'overlays', overlay.$id))
    enqueueSnackbar('Overlay deleted', { variant: 'success', persist: false })
    logActivity('Deleted overlay', {
      type: 'content',
      id: overlay.$id,
      ...(overlay.name ? { name: overlay.name } : {}),
    })
  }

  // Ordering (AGL-270): the first active overlay per kind wins, so the
  // list order is meaningful — swap `order` with the neighbor.
  const handleMove = async (index: number, direction: -1 | 1) => {
    const neighbor = overlays[index + direction]
    const current = overlays[index]
    if (!neighbor?.$id || !current?.$id) return
    const currentOrder = current.order ?? index
    const neighborOrder = neighbor.order ?? index + direction
    await Promise.all([
      setDoc(
        doc(firestore, 'hosts', hostId, 'overlays', current.$id),
        { order: neighborOrder === currentOrder ? neighborOrder + direction : neighborOrder },
        { merge: true },
      ),
      setDoc(
        doc(firestore, 'hosts', hostId, 'overlays', neighbor.$id),
        { order: currentOrder },
        { merge: true },
      ),
    ]).catch(console.error)
  }

  const handleToggle = async (overlay: OverlayDraft) => {
    if (!overlay.$id) return
    await setDoc(
      doc(firestore, 'hosts', hostId, 'overlays', overlay.$id),
      { enabled: overlay.enabled === false },
      { merge: true },
    )
  }

  // Engagement (AGL-271): lifetime counters the tenant beacon increments.
  const statsLabel = (overlay: OverlayDraft) => {
    const stats = overlay.stats ?? {}
    const impressions = stats.impressions ?? 0
    const clicks = stats.clicks ?? 0
    const dismissals = stats.dismissals ?? 0
    if (!impressions && !clicks && !dismissals) return '—'
    const parts = [`${impressions.toLocaleString()} views`]
    if (clicks) parts.push(`${clicks.toLocaleString()} clicks`)
    if (dismissals) parts.push(`${dismissals.toLocaleString()} dismissed`)
    return parts.join(' · ')
  }

  const statusChip = (overlay: OverlayDraft) => {
    if (overlay.enabled === false) {
      return <Chip size="small" label="Off" />
    }
    if (!overlayActiveAt(overlay, Date.now())) {
      return <Chip size="small" color="info" label="Scheduled" />
    }
    return <Chip size="small" color="success" label="Live" />
  }

  return (
    <CardDisplay
      header="Announcement bars & popups"
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      {!entitled ? (
        <Alert severity="info">
          {'Announcement bars and popups are included from the Starter ' +
            'plan — see Billing to upgrade.'}
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {'Configure as many bars and popups as you need, each with its ' +
              'own schedule and page targeting. When several match a page, ' +
              'the first per kind shows.'}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              color="secondary"
              variant="contained"
              onClick={() => setEditor({ ...EMPTY_BAR })}
            >
              {'New bar'}
            </Button>
            <Button
              size="small"
              color="secondary"
              variant="contained"
              onClick={() => setEditor({ ...EMPTY_POPUP })}
            >
              {'New popup'}
            </Button>
          </Stack>
          {overlays.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No overlays yet — the single announcement bar and popup ' +
                'below keep working as your default surfaces.'}
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Name'}</TableCell>
                  <TableCell>{'Kind'}</TableCell>
                  <TableCell>{'Status'}</TableCell>
                  <TableCell>{'Window'}</TableCell>
                  <TableCell>{'Pages'}</TableCell>
                  <TableCell>{'Engagement'}</TableCell>
                  <TableCell align="right">{'Actions'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {overlays.map((overlay) => (
                  <TableRow key={overlay.$id}>
                    <TableCell>
                      {overlay.name ??
                        (overlay.kind === 'bar'
                          ? (overlay.bar?.text ?? '').slice(0, 32)
                          : (overlay.popup?.headline ?? '').slice(0, 32)) ??
                        overlay.$id}
                    </TableCell>
                    <TableCell>
                      {overlay.kind === 'bar' ? 'Bar' : 'Popup'}
                    </TableCell>
                    <TableCell>{statusChip(overlay)}</TableCell>
                    <TableCell>
                      {overlay.startAtMs || overlay.endAtMs
                        ? `${
                            overlay.startAtMs
                              ? new Date(overlay.startAtMs).toLocaleDateString()
                              : '…'
                          } → ${
                            overlay.endAtMs
                              ? new Date(overlay.endAtMs).toLocaleDateString()
                              : '…'
                          }`
                        : 'Always'}
                    </TableCell>
                    <TableCell>
                      {overlay.pathPatterns?.length
                        ? overlay.pathPatterns.join(', ')
                        : 'All pages'}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {statsLabel(overlay)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        aria-label="move up"
                        disabled={overlays.indexOf(overlay) === 0}
                        onClick={() =>
                          void handleMove(overlays.indexOf(overlay), -1)
                        }
                      >
                        <MdiIcon path={mdiChevronUp.path} sx={{ fontSize: '1rem' }} />
                      </IconButton>
                      <IconButton
                        size="small"
                        aria-label="move down"
                        disabled={
                          overlays.indexOf(overlay) === overlays.length - 1
                        }
                        onClick={() =>
                          void handleMove(overlays.indexOf(overlay), 1)
                        }
                      >
                        <MdiIcon
                          path={mdiChevronDown.path}
                          sx={{ fontSize: '1rem' }}
                        />
                      </IconButton>
                      <Switch
                        size="small"
                        checked={overlay.enabled !== false}
                        onChange={() => handleToggle(overlay)}
                        slotProps={{ input: { 'aria-label': 'Enabled' } }}
                      />
                      <Button
                        size="small"
                        color="secondary"
                        onClick={() => setEditor({ ...overlay })}
                      >
                        {'Edit'}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => handleDelete(overlay)}
                      >
                        {'Delete'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Stack>
      )}

      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {editor?.$id
            ? 'Edit overlay'
            : editor?.kind === 'bar'
              ? 'New announcement bar'
              : 'New popup'}
        </DialogTitle>
        <DialogContent>
          {editor ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                size="small"
                label="Name"
                value={editor.name ?? ''}
                onChange={(event) => patch({ name: event.target.value })}
                helperText="Internal label shown in this list"
              />
              {editor.kind === 'bar' ? (
                <>
                  <TextField
                    size="small"
                    label="Text"
                    required
                    value={editor.bar?.text ?? ''}
                    onChange={(event) => patchBar({ text: event.target.value })}
                  />
                  <TextField
                    size="small"
                    label="Link (optional)"
                    value={editor.bar?.href ?? ''}
                    onChange={(event) => patchBar({ href: event.target.value })}
                  />
                  <Stack direction="row" spacing={1}>
                    <TextField
                      size="small"
                      label="Background color"
                      value={editor.bar?.backgroundColor ?? ''}
                      onChange={(event) =>
                        patchBar({ backgroundColor: event.target.value })
                      }
                    />
                    <TextField
                      size="small"
                      label="Text color"
                      value={editor.bar?.textColor ?? ''}
                      onChange={(event) =>
                        patchBar({ textColor: event.target.value })
                      }
                    />
                  </Stack>
                </>
              ) : (
                <>
                  <TextField
                    size="small"
                    label="Headline"
                    value={editor.popup?.headline ?? ''}
                    onChange={(event) =>
                      patchPopup({ headline: event.target.value })
                    }
                  />
                  <TextField
                    size="small"
                    label="Body"
                    required
                    multiline
                    minRows={2}
                    value={editor.popup?.body ?? ''}
                    onChange={(event) =>
                      patchPopup({ body: event.target.value })
                    }
                  />
                  <Stack direction="row" spacing={1}>
                    <TextField
                      size="small"
                      label="CTA label"
                      value={editor.popup?.ctaLabel ?? ''}
                      onChange={(event) =>
                        patchPopup({ ctaLabel: event.target.value })
                      }
                    />
                    <TextField
                      size="small"
                      label="CTA link"
                      value={editor.popup?.ctaHref ?? ''}
                      onChange={(event) =>
                        patchPopup({ ctaHref: event.target.value })
                      }
                    />
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    <TextField
                      select
                      size="small"
                      label="Trigger"
                      sx={{ minWidth: 140 }}
                      value={editor.popup?.trigger ?? 'delay'}
                      onChange={(event) =>
                        patchPopup({
                          trigger: event.target
                            .value as NonNullable<
                            OverlayDraft['popup']
                          >['trigger'],
                        })
                      }
                    >
                      <MenuItem value="delay">{'After a delay'}</MenuItem>
                      <MenuItem value="scroll">{'On scroll'}</MenuItem>
                      <MenuItem value="exit">{'On exit intent'}</MenuItem>
                    </TextField>
                    <TextField
                      size="small"
                      type="number"
                      label={
                        (editor.popup?.trigger ?? 'delay') === 'scroll'
                          ? 'Scroll %'
                          : 'Seconds'
                      }
                      value={editor.popup?.triggerValue ?? 3}
                      onChange={(event) =>
                        patchPopup({
                          triggerValue: Number(event.target.value),
                        })
                      }
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Re-show after (days)"
                      value={editor.popup?.frequencyDays ?? 7}
                      onChange={(event) =>
                        patchPopup({
                          frequencyDays: Number(event.target.value),
                        })
                      }
                    />
                  </Stack>
                </>
              )}
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  type="datetime-local"
                  label="Show from"
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={toDatetimeLocal(editor.startAtMs)}
                  onChange={(event) =>
                    patch({ startAtMs: fromDatetimeLocal(event.target.value) })
                  }
                />
                <TextField
                  size="small"
                  type="datetime-local"
                  label="Show until"
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={toDatetimeLocal(editor.endAtMs)}
                  onChange={(event) =>
                    patch({ endAtMs: fromDatetimeLocal(event.target.value) })
                  }
                />
              </Stack>
              <TextField
                size="small"
                label="Show on pages"
                value={(editor.pathPatterns ?? []).join(', ')}
                onChange={(event) =>
                  patch({ pathPatterns: parsePatterns(event.target.value) })
                }
                helperText={
                  'Comma-separated paths; /blog/* matches a section. ' +
                  'Empty = every page.'
                }
              />
              <TextField
                size="small"
                label="Never show on"
                value={(editor.excludePathPatterns ?? []).join(', ')}
                onChange={(event) =>
                  patch({
                    excludePathPatterns: parsePatterns(event.target.value),
                  })
                }
              />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setEditor(null)}>
            {'Cancel'}
          </Button>
          <Button variant="contained" color="secondary" onClick={handleSave}>
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostOverlaysCard.displayName = 'HostOverlaysCard'

export default HostOverlaysCard
