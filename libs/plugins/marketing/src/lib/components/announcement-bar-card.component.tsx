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
  type AglynOrgBilling,
  checkEntitlement,
  type HostAnnouncementBar,
} from '@aglyn/aglyn'
import { CardDisplay, useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { doc, updateDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import {
  useFirestore,
  useFirestoreDoc,
  useHostActivityLogger,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import OverlayStatsRow from './overlay-stats-row.component'

export interface AnnouncementBarCardProps {
  hostId: string
  /** Resolved entitlement source (AGL-395). */
  org?: Partial<AglynOrgBilling>
}

/**
 * Announcement bar editor (AGL-195): site-wide banner config persisted on
 * the host doc; the tenant render gates on the marketingOverlays
 * entitlement and resolves binding tokens in the text server-side.
 * Starter+ (locked-state upsell below), dark-launched for plan-less
 * workspaces like the other AGL-99 gates.
 */
export function AnnouncementBarCard(props: AnnouncementBarCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { org } = props
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const logActivity = useHostActivityLogger(hostId)
  const {
    data: host,
    status: hostStatus,
    /**
     * The host doc this form is seeded from is unconfirmed by the server
     * (AGL-1358). The save writes the whole `announcementBar` map — a nested
     * map value REPLACES atomically, so `updateDoc` protects only the host
     * doc's other fields, never the bar's own — and every field of it comes
     * off this seed. Against a cached read, editing the text reinstates the
     * colours, link and `enabled` flag from that snapshot on a banner shown
     * on every page of a published site.
     */
    fromCache: hostFromCache,
  } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  const entitled = checkEntitlement(org, 'marketingOverlays')

  const saved = (host?.announcementBar ?? {}) as HostAnnouncementBar
  const [draft, setDraft] = useState<HostAnnouncementBar>(saved)
  // Re-seed the form when another session edits the host doc.
  const savedKey = JSON.stringify(saved)
  useEffect(() => {
    setDraft(JSON.parse(savedKey))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])

  const dirty = JSON.stringify(draft) !== savedKey
  const patch = (partial: Partial<HostAnnouncementBar>) =>
    setDraft((previous) => ({ ...previous, ...partial }))

  const handleSave = async () => {
    const dequeue = queueLoading()
    try {
      /**
       * Refuse a save whose seed the server never confirmed (AGL-1358).
       *
       * There is no create path to exempt, and that is the point: unlike a
       * new row at a fresh uid, this writes a FIXED document path, so the
       * blank `draft` that `host?.announcementBar ?? {}` yields when the
       * cache has never seen a bar is not harmless — it replaces whatever
       * bar the server really holds with an empty, disabled one.
       *
       * The activity log rides inside the guard: a logged "Updated
       * announcement bar" whose write never happened leaves the history
       * disagreeing with the bar it claims to explain.
       *
       * The guard WRAPS the write — an early return is a shape you can keep
       * while losing the protection.
       */
      const verdict = await writeGuardedBySeed(
        {
          subject: 'announcement bar',
          unreadable: hostStatus === 'error',
          fromCache: hostFromCache,
        },
        async () => {
          await updateDoc(doc(firestore, 'hosts', hostId), {
            announcementBar: {
              enabled: Boolean(draft.enabled),
              text: (draft.text ?? '').slice(0, 300),
              href: (draft.href ?? '').trim(),
              backgroundColor: (draft.backgroundColor ?? '').trim(),
              textColor: (draft.textColor ?? '').trim(),
              dismissible: draft.dismissible !== false,
            },
          })
          logActivity('Updated announcement bar', { type: 'host', id: hostId })
        },
      )
      // A refusal leaves every typed value on screen. A save that silently
      // does nothing sends the user back to retype a form that will be
      // refused again just as quietly.
      if (!verdict.ok) {
        return void enqueueSnackbar(verdict.message, {
          variant: 'warning',
          persist: false,
        })
      }
      enqueueSnackbar('Announcement bar saved', {
        variant: 'success',
        persist: false,
      })
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
    <CardDisplay header="Announcement bar" contentGutterX contentGutterY>
      {!entitled ? (
        <Alert severity="info">
          {'Announcement bars and popups are included from the Starter ' +
            'plan — see Billing to upgrade.'}
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Switch
              checked={Boolean(draft.enabled)}
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
            <Typography variant="body2">
              {draft.enabled
                ? 'Shown on every page of your published site'
                : 'Hidden'}
            </Typography>
          </Stack>
          <TextField
            label="Text"
            size="small"
            value={draft.text ?? ''}
            onChange={(event) => patch({ text: event.target.value })}
            helperText="Supports variable bindings, e.g. {{saleEndsAt}}"
            multiline
            fullWidth
          />
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <TextField
              label="Link (optional)"
              size="small"
              placeholder="/sale or https://…"
              value={draft.href ?? ''}
              onChange={(event) => patch({ href: event.target.value })}
              sx={{ flex: 1, minWidth: 200 }}
            />
            <TextField
              label="Background"
              size="small"
              placeholder="#111827"
              value={draft.backgroundColor ?? ''}
              onChange={(event) =>
                patch({ backgroundColor: event.target.value })
              }
              sx={{ width: 120 }}
            />
            <TextField
              label="Text color"
              size="small"
              placeholder="#ffffff"
              value={draft.textColor ?? ''}
              onChange={(event) => patch({ textColor: event.target.value })}
              sx={{ width: 120 }}
            />
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Switch
              checked={draft.dismissible !== false}
              onChange={(event) =>
                patch({ dismissible: event.target.checked })
              }
            />
            <Typography variant="body2">
              {'Visitors can dismiss it (re-shown when the text changes)'}
            </Typography>
          </Stack>
          {draft.text ? (
            <Box
              sx={{
                px: 2,
                py: 1,
                borderRadius: 1,
                textAlign: 'center',
                fontSize: 14,
                color: draft.textColor || '#fff',
                backgroundColor: draft.backgroundColor || '#111827',
              }}
            >
              {draft.text}
            </Box>
          ) : null}
          <Button
            variant="contained"
            color="primary"
            disabled={!dirty || (Boolean(draft.enabled) && !draft.text?.trim())}
            onClick={handleSave}
            sx={{ alignSelf: 'flex-start' }}
          >
            {'Save'}
          </Button>
          <OverlayStatsRow
            hostId={hostId}
            actionKey="barClick"
            actionLabel="clicks"
          />
        </Stack>
      )}
    </CardDisplay>
  )
}
AnnouncementBarCard.displayName = 'AnnouncementBarCard'

export default AnnouncementBarCard
