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
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { createEmailScreen } from '../utils/create-email-screen'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useHostOrgId,
  useHostResourceApi,
  useUser,
} from '@aglyn/tenant-feature-instance'

/**
 * Besigner deep-link for an email screen. The route lives in the console
 * app's route table; the pattern is stable, so the plugin builds it
 * directly rather than importing app-only route constants.
 */
const besignerHref = (hostId: string, screenId: string, versionId: string) =>
  `/${hostId}/screens/${screenId}/versions/${versionId}/besigner`

/**
 * Email campaigns (AGL-161): compose + send to leads or site members via
 * the env-gated Resend route (per-tier monthly caps, signed unsubscribe
 * links, suppression list). History lists past sends with stats.
 */
export function HostCampaignsCard(props: { hostId: string }) {
  const { hostId } = props
  // Org-shared data root (AGL-237); the host path is the pre-migration
  // fallback for hosts not yet org-wired.
  const hostOrgId = useHostOrgId(hostId)
  const dataScope = hostOrgId
    ? (['orgs', hostOrgId] as const)
    : (['hosts', hostId] as const)
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  // No orderBy: scheduled campaigns have no sentAt yet (AGL-272), and an
  // orderBy on a missing field would drop them from the history.
  const { data: campaignDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'campaigns'), limit(30)),
    [firestore, hostId, hostOrgId],
    { idField: '$id' },
  )
  const campaigns = [...(campaignDocs ?? [])].sort(
    (a: any, b: any) =>
      (b.sentAt?.seconds ?? (b.sendAtMs ?? 0) / 1000) -
      (a.sentAt?.seconds ?? (a.sendAtMs ?? 0) / 1000),
  )

  // Contact segments (AGL-199) join the built-in audiences.
  const { data: segmentDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, dataScope[0], dataScope[1], 'contactSegments'),
        limit(50),
      ),
    [firestore, hostId, hostOrgId],
    { idField: '$id' },
  )
  const segments = [...(segmentDocs ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  // Org email lists (AGL-254) join the audiences.
  const { data: listDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, dataScope[0], dataScope[1], 'lists'),
        limit(50),
      ),
    [firestore, hostId, hostOrgId],
    { idField: '$id' },
  )
  const lists = [...(listDocs ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  // Email A/B experiments (AGL-255): running (or winner-decided) email
  // experiments the composer can attach.
  const { data: experimentDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'experiments'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const emailExperiments = [...(experimentDocs ?? [])]
    .filter(
      (experiment: any) =>
        !experiment.deletedAt &&
        experiment.target === 'email' &&
        (experiment.status === 'running' || experiment.winnerVariantId),
    )
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )

  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<string>('leads')
  const [experimentId, setExperimentId] = useState('')
  // Scheduling (AGL-272): a future timestamp turns Send into Schedule.
  const [sendAt, setSendAt] = useState('')
  const [busy, setBusy] = useState(false)

  // Designed emails (AGL-347/349): besigner email documents are screens
  // with kind 'email'; campaigns reference them by screen id.
  const router = useRouter()
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const emailScreens = [...(screenDocs ?? [])]
    .filter((screen: any) => !screen.deletedAt && screen.kind === 'email')
    .sort((a: any, b: any) =>
      String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
    )
  const [templateScreenId, setTemplateScreenId] = useState('')
  const selectedTemplate = emailScreens.find(
    (screen: any) => screen.$id === templateScreenId,
  )

  const handleCreateTemplate = useCallback(async () => {
    try {
      const { screenId, versionId } = await createEmailScreen(
        firestore,
        hostId,
        createHostResource,
      )
      void router.push(besignerHref(hostId, screenId, versionId))
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Creating the email template failed', {
        variant: 'error',
      })
    }
  }, [firestore, hostId, createHostResource, router, enqueueSnackbar])

  const handleTestSend = useCallback(async () => {
    if (busy) return
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
          action: 'test',
          subject: subject.trim() || 'Test send',
          body: body.trim(),
          templateScreenId: templateScreenId || undefined,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Test send failed', {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar('Test sent to your address', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }, [busy, user, hostId, subject, body, templateScreenId, enqueueSnackbar])

  const handleSend = useCallback(async () => {
    if (!subject.trim() || (!templateScreenId && !body.trim()) || busy) return
    const sendAtMs = sendAt ? new Date(sendAt).getTime() : 0
    const scheduling = Boolean(sendAtMs)
    if (scheduling && sendAtMs <= Date.now()) {
      return void enqueueSnackbar('Pick a future send time', {
        variant: 'warning',
        persist: false,
      })
    }
    const audienceLabel =
      audience === 'leads'
        ? 'lead'
        : audience === 'members'
          ? 'site member'
          : audience.startsWith('list:')
            ? 'list subscriber'
            : 'contact in the segment'
    const confirmed = await confirm({
      title: scheduling ? 'Schedule this campaign?' : 'Send this campaign?',
      description: scheduling
        ? `"${subject.trim()}" goes to every ${audienceLabel} who hasn't ` +
          `unsubscribed on ${new Date(sendAtMs).toLocaleString()}.`
        : `"${subject.trim()}" goes to every ${audienceLabel} who hasn't ` +
          'unsubscribed.',
      confirmationText: scheduling ? 'Schedule' : 'Send',
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
          ...(scheduling ? { action: 'schedule', sendAtMs } : {}),
          subject: subject.trim(),
          body: body.trim(),
          audience: audience.startsWith('segment:')
            ? 'segment'
            : audience.startsWith('list:')
              ? 'list'
              : audience,
          ...(audience.startsWith('segment:')
            ? { segmentId: audience.slice('segment:'.length) }
            : {}),
          ...(audience.startsWith('list:')
            ? { listId: audience.slice('list:'.length) }
            : {}),
          ...(experimentId ? { experimentId } : {}),
          ...(templateScreenId ? { templateScreenId } : {}),
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
        scheduling
          ? `Scheduled for ${new Date(sendAtMs).toLocaleString()}`
          : `Sent to ${payload.sent} of ${payload.recipients} recipients`,
        { variant: 'success', persist: false },
      )
      setSubject('')
      setBody('')
      setSendAt('')
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [subject, body, audience, experimentId, templateScreenId, sendAt, busy, user, hostId, confirm, enqueueSnackbar])

  // Cancel a scheduled campaign before the processor picks it up.
  const handleCancelSchedule = useCallback(
    async (campaignId: string) => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/campaigns/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ hostId, action: 'cancel', campaignId }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'Cancel failed', {
            variant: 'warning',
            allowDuplicate: true,
          })
        }
        enqueueSnackbar('Schedule canceled', {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', { variant: 'error' })
      }
    },
    [user, hostId, enqueueSnackbar],
  )

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
            {lists.map((list: any) => (
              <MenuItem key={list.$id} value={`list:${list.$id}`}>
                {`List: ${list.name}`}
              </MenuItem>
            ))}
          </TextField>
          {emailExperiments.length ? (
            // Email A/B (AGL-255): variant subject/body overrides apply
            // per recipient; a decided experiment sends the winner copy.
            <TextField
              select
              label="A/B test"
              value={experimentId}
              onChange={(event) => setExperimentId(event.target.value)}
              size="small"
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">{'None'}</MenuItem>
              {emailExperiments.map((experiment: any) => (
                <MenuItem key={experiment.$id} value={experiment.$id}>
                  {experiment.name ?? experiment.$id}
                  {experiment.winnerVariantId ? ' (winner decided)' : ''}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            select
            label="Email design"
            value={templateScreenId}
            onChange={(event) => setTemplateScreenId(event.target.value)}
            size="small"
            sx={{ minWidth: 220 }}
            helperText="Designed emails are built in the besigner"
          >
            <MenuItem value="">{'Plain text (message below)'}</MenuItem>
            {emailScreens.map((screen: any) => (
              <MenuItem key={screen.$id} value={screen.$id}>
                {screen.displayName ?? screen.$id}
              </MenuItem>
            ))}
          </TextField>
          {selectedTemplate ? (
            <Button
              size="small"
              onClick={() =>
                void router.push(
                  besignerHref(
                    hostId,
                    selectedTemplate.$id,
                    selectedTemplate.versionId,
                  ),
                )
              }
            >
              {'Edit design'}
            </Button>
          ) : null}
          <Button size="small" onClick={() => void handleCreateTemplate()}>
            {'New email template'}
          </Button>
        </Stack>
        {!templateScreenId ? (
          <TextField
            label="Message"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            size="small"
            multiline
            minRows={4}
            helperText={
              'Personalize with {{firstName|there}}, {{name}}, or {{email}} ' +
              '— resolved per recipient at send time.'
            }
          />
        ) : null}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            variant="contained"
            color="secondary"
            disabled={
              busy ||
              !subject.trim() ||
              (!templateScreenId && !body.trim())
            }
            onClick={handleSend}
          >
            {busy
              ? 'Working…'
              : sendAt
                ? 'Schedule campaign'
                : 'Send campaign'}
          </Button>
          <Button
            size="small"
            disabled={busy || (!templateScreenId && !body.trim())}
            onClick={() => void handleTestSend()}
          >
            {'Send test to me'}
          </Button>
          <TextField
            size="small"
            type="datetime-local"
            label="Send at (optional)"
            slotProps={{ inputLabel: { shrink: true } }}
            value={sendAt}
            onChange={(event) => setSendAt(event.target.value)}
          />
        </Stack>
        {campaigns.length ? (
          <Stack spacing={0.5}>
            <Typography variant="subtitle2">{'History'}</Typography>
            {campaigns.map((campaign: any) => (
              <Stack
                key={campaign.$id}
                direction="row"
                spacing={1}
                sx={{ justifyContent: 'space-between', alignItems: 'center' }}
              >
                <Typography variant="body2" noWrap sx={{ maxWidth: '60%' }}>
                  {campaign.subject}
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  {campaign.status === 'scheduled' ? (
                    <>
                      <Chip
                        size="small"
                        color="info"
                        label={`Scheduled · ${
                          campaign.sendAtMs
                            ? new Date(campaign.sendAtMs).toLocaleString()
                            : ''
                        }`}
                      />
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() =>
                          void handleCancelSchedule(campaign.$id)
                        }
                      >
                        {'Cancel'}
                      </Button>
                    </>
                  ) : campaign.status === 'canceled' ? (
                    <Chip size="small" label="Canceled" />
                  ) : campaign.status === 'failed' ? (
                    <Chip
                      size="small"
                      color="error"
                      label={`Failed${campaign.error ? ` · ${campaign.error}` : ''}`}
                    />
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      {`${campaign.stats?.sent ?? 0}/${
                        campaign.stats?.recipients ?? 0
                      } sent` +
                        // Opens/clicks arrive via the Resend webhook
                        // (AGL-268).
                        (campaign.stats?.opens
                          ? ` · ${campaign.stats.opens} opens`
                          : '') +
                        (campaign.stats?.clicks
                          ? ` · ${campaign.stats.clicks} clicks`
                          : '') +
                        ` · ${campaign.audience}` +
                        (campaign.experimentId ? ' · A/B' : '')}
                    </Typography>
                  )}
                </Stack>
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
