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

import type { HostPopup } from '@aglyn/aglyn'
import { CardDisplay, useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { doc, updateDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { hasEntitlement } from '../constants/entitlements'
import MediaPickerDialog from './media/media-picker-dialog.component'
import OverlayStatsRow from './overlay-stats-row.component'
import useCurrentTenant from '../hooks/use-current-tenant'
import useFirestoreDoc from '../hooks/use-firestore-doc'
import useHostActivityLogger from '../hooks/use-host-activity-logger'

export interface PopupCardProps {
  hostId: string
}

const TRIGGERS: Array<{ value: NonNullable<HostPopup['trigger']>; label: string }> = [
  { value: 'delay', label: 'After a delay (seconds)' },
  { value: 'scroll', label: 'At scroll depth (%)' },
  { value: 'exit', label: 'On exit intent (desktop)' },
]

const toLocalInput = (ms?: number) => {
  if (!ms) return ''
  const date = new Date(ms - new Date().getTimezoneOffset() * 60000)
  return date.toISOString().slice(0, 16)
}
const fromLocalInput = (value: string) =>
  value ? new Date(value).getTime() : undefined

/**
 * Promotional popup editor (AGL-196): one popup per host, persisted on the
 * host doc; the tenant render handles triggers, scheduling, and
 * frequency capping. marketingOverlays-gated (Starter+).
 */
export function PopupCard(props: PopupCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { tenant } = useCurrentTenant()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const logActivity = useHostActivityLogger(hostId)
  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  const entitled = hasEntitlement('marketing-overlays', tenant)

  const saved = (host?.popup ?? {}) as HostPopup
  const [draft, setDraft] = useState<HostPopup>(saved)
  const savedKey = JSON.stringify(saved)
  useEffect(() => {
    setDraft(JSON.parse(savedKey))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])

  const [pickerOpen, setPickerOpen] = useState(false)
  const dirty = JSON.stringify(draft) !== savedKey
  const patch = (partial: Partial<HostPopup>) =>
    setDraft((previous) => ({ ...previous, ...partial }))

  const handleSave = async () => {
    const dequeue = queueLoading()
    try {
      await updateDoc(doc(firestore, 'hosts', hostId), {
        popup: {
          enabled: Boolean(draft.enabled),
          headline: (draft.headline ?? '').slice(0, 120),
          body: (draft.body ?? '').slice(0, 1000),
          imageUrl: (draft.imageUrl ?? '').trim(),
          ctaLabel: (draft.ctaLabel ?? '').slice(0, 60),
          ctaHref: (draft.ctaHref ?? '').trim(),
          collectEmail: Boolean(draft.collectEmail),
          trigger: draft.trigger ?? 'delay',
          triggerValue: Math.max(0, Number(draft.triggerValue ?? 3)),
          frequencyDays: Math.max(1, Number(draft.frequencyDays ?? 7)),
          startAtMs: draft.startAtMs ?? null,
          endAtMs: draft.endAtMs ?? null,
        },
      })
      enqueueSnackbar('Popup saved', { variant: 'success', persist: false })
      logActivity('Updated popup', { type: 'host', id: hostId })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      dequeue()
    }
  }

  return (
    <CardDisplay header="Promotional popup" contentGutterX contentGutterY>
      {!entitled ? (
        <Alert severity="info">
          {'Popups are included from the Starter plan — see Billing to ' +
            'upgrade.'}
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Switch
              checked={Boolean(draft.enabled)}
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
            <Typography variant="body2">
              {draft.enabled ? 'Active on your published site' : 'Off'}
            </Typography>
          </Stack>
          <TextField
            label="Headline"
            size="small"
            value={draft.headline ?? ''}
            onChange={(event) => patch({ headline: event.target.value })}
            fullWidth
          />
          <TextField
            label="Body"
            size="small"
            value={draft.body ?? ''}
            onChange={(event) => patch({ body: event.target.value })}
            helperText="Supports variable bindings"
            multiline
            minRows={2}
            fullWidth
          />
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <TextField
              label="Image URL (optional)"
              size="small"
              placeholder="Pick from the media library"
              value={draft.imageUrl ?? ''}
              onChange={(event) => patch({ imageUrl: event.target.value })}
              sx={{ flex: 1, minWidth: 220 }}
            />
            <Button size="small" onClick={() => setPickerOpen(true)}>
              {'Browse media'}
            </Button>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Switch
              checked={Boolean(draft.collectEmail)}
              onChange={(event) =>
                patch({ collectEmail: event.target.checked })
              }
            />
            <Typography variant="body2">
              {'Collect emails (submissions land in your Inbox and Contacts)'}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <TextField
              label="Button label"
              size="small"
              value={draft.ctaLabel ?? ''}
              onChange={(event) => patch({ ctaLabel: event.target.value })}
              sx={{ width: 160 }}
            />
            <TextField
              label="Button link"
              size="small"
              placeholder="/sale or https://…"
              value={draft.ctaHref ?? ''}
              onChange={(event) => patch({ ctaHref: event.target.value })}
              sx={{ flex: 1, minWidth: 180 }}
            />
          </Stack>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <TextField
              select
              label="Show"
              size="small"
              value={draft.trigger ?? 'delay'}
              onChange={(event) =>
                patch({ trigger: event.target.value as HostPopup['trigger'] })
              }
              sx={{ minWidth: 200 }}
            >
              {TRIGGERS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            {draft.trigger !== 'exit' ? (
              <TextField
                label={draft.trigger === 'scroll' ? 'Depth %' : 'Seconds'}
                size="small"
                type="number"
                value={draft.triggerValue ?? 3}
                onChange={(event) =>
                  patch({ triggerValue: Number(event.target.value) })
                }
                sx={{ width: 110 }}
              />
            ) : null}
            <TextField
              label="Re-show after (days)"
              size="small"
              type="number"
              value={draft.frequencyDays ?? 7}
              onChange={(event) =>
                patch({ frequencyDays: Number(event.target.value) })
              }
              sx={{ width: 160 }}
            />
          </Stack>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <TextField
              label="Start (optional)"
              size="small"
              type="datetime-local"
              value={toLocalInput(draft.startAtMs)}
              onChange={(event) =>
                patch({ startAtMs: fromLocalInput(event.target.value) })
              }
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 200 }}
            />
            <TextField
              label="End (optional)"
              size="small"
              type="datetime-local"
              value={toLocalInput(draft.endAtMs)}
              onChange={(event) =>
                patch({ endAtMs: fromLocalInput(event.target.value) })
              }
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 200 }}
            />
          </Stack>
          <Button
            variant="contained"
            color="secondary"
            disabled={!dirty || (Boolean(draft.enabled) && !draft.body?.trim())}
            onClick={handleSave}
            sx={{ alignSelf: 'flex-start' }}
          >
            {'Save'}
          </Button>
          <OverlayStatsRow
            hostId={hostId}
            impressionKey="popupImpression"
            actionKey="popupClick"
            actionLabel="clicks"
          />
          <MediaPickerDialog
            hostId={hostId}
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onPick={(media) => {
              patch({ imageUrl: media.url ?? '' })
              setPickerOpen(false)
            }}
          />
        </Stack>
      )}
    </CardDisplay>
  )
}
PopupCard.displayName = 'PopupCard'

export default PopupCard
