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
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore, useUser } from 'reactfire'
import useFirestoreCollection from '../hooks/use-firestore-collection'

/**
 * Email campaigns (AGL-161): compose + send to leads or site members via
 * the env-gated Resend route (per-tier monthly caps, signed unsubscribe
 * links, suppression list). History lists past sends with stats.
 */
export function HostCampaignsCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  const { data: campaignDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'campaigns'),
        orderBy('sentAt', 'desc'),
        limit(20),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )

  // Contact segments (AGL-199) join the built-in audiences.
  const { data: segmentDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'contactSegments'),
        limit(50),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const segments = [...(segmentDocs ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )

  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<string>('leads')
  const [busy, setBusy] = useState(false)

  const handleSend = useCallback(async () => {
    if (!subject.trim() || !body.trim() || busy) return
    const confirmed = await confirm({
      title: 'Send this campaign?',
      description:
        `"${subject.trim()}" goes to every ${
          audience === 'leads'
            ? 'lead'
            : audience === 'members'
              ? 'site member'
              : 'contact in the segment'
        } who hasn't unsubscribed.`,
      confirmationText: 'Send',
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/campaigns/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          subject: subject.trim(),
          body: body.trim(),
          audience: audience.startsWith('segment:') ? 'segment' : audience,
          ...(audience.startsWith('segment:')
            ? { segmentId: audience.slice('segment:'.length) }
            : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.status === 501) {
        return void enqueueSnackbar(
          'Campaigns are not configured on this deployment',
          { variant: 'info', persist: false },
        )
      }
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Send failed', {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar(
        `Sent to ${payload.sent} of ${payload.recipients} recipients`,
        { variant: 'success', persist: false },
      )
      setSubject('')
      setBody('')
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [subject, body, audience, busy, user, hostId, confirm, enqueueSnackbar])

  return (
    <CardDisplay header={'Email campaigns'} contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Send an update to your leads or site members. Every email ' +
            'carries an unsubscribe link; monthly sends are capped by ' +
            'your plan.'}
        </Typography>
        <Stack direction="row" spacing={1}>
          <TextField
            label="Subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            size="small"
            sx={{ flex: 1 }}
          />
          <TextField
            select
            label="Audience"
            value={audience}
            onChange={(event) => setAudience(event.target.value as any)}
            size="small"
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="leads">{'Leads'}</MenuItem>
            <MenuItem value="members">{'Site members'}</MenuItem>
            {segments.map((segment: any) => (
              <MenuItem key={segment.$id} value={`segment:${segment.$id}`}>
                {`Segment: ${segment.name}`}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <TextField
          label="Message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          size="small"
          multiline
          minRows={4}
        />
        <Button
          variant="contained"
          color="secondary"
          disabled={busy || !subject.trim() || !body.trim()}
          onClick={handleSend}
          sx={{ alignSelf: 'flex-start' }}
        >
          {busy ? 'Sending…' : 'Send campaign'}
        </Button>
        {(campaignDocs ?? []).length ? (
          <Stack spacing={0.5}>
            <Typography variant="subtitle2">{'History'}</Typography>
            {(campaignDocs ?? []).map((campaign: any) => (
              <Stack
                key={campaign.$id}
                direction="row"
                sx={{ justifyContent: 'space-between' }}
              >
                <Typography variant="body2" noWrap sx={{ maxWidth: '70%' }}>
                  {campaign.subject}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {`${campaign.stats?.sent ?? 0}/${
                    campaign.stats?.recipients ?? 0
                  } sent · ${campaign.audience}`}
                </Typography>
              </Stack>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
HostCampaignsCard.displayName = 'HostCampaignsCard'

export default HostCampaignsCard
