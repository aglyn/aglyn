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

import { buildRoute, checkQuota, pluginDocsHelp, Route } from '@aglyn/aglyn'
/*
 * The MODULE, not the barrel, for the two PURE helpers — a spec that mocks
 * `@aglyn/tenant-feature-instance` wholesale to stage its Firestore hooks
 * would otherwise lose them, and neither is a hook.
 */
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query } from 'firebase/firestore'
import { createEmailScreen } from '../utils/create-email-screen'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useOrgDataScope,
  useOrgPlan,
  useHostResourceApi,
  useHostVersionApi,
  useUser,
} from '@aglyn/tenant-feature-instance'

// The besigner route is `/[orgSlug]/hosts/[host]/screens/[screenId]/
// versions/[versionId]/besigner`. This built `/{hostDocId}/screens/…`, the
// pre-AGL-621/622 shape — so every "Edit"/"Design" jump out of the Emails
// page landed on a 404, including the one right after creating a new email
// (AGL-685). Takes the resolved org slug + subdomain, not a host doc id.
const besignerHref = (
  orgSlug: string,
  host: string,
  screenId: string,
  versionId: string,
) => buildRoute(Route.SCREEN_BESIGNER, { orgSlug, host, screenId, versionId })

/**
 * Email campaigns (AGL-161): compose + send to leads or site members via
 * the env-gated Resend route (per-tier monthly caps, signed unsubscribe
 * links, suppression list). History lists past sends with stats.
 */
/**
 * How many campaigns the history reads.
 *
 * A CEILING, not a page size — see the query, which explains why this list
 * cannot be paged by the server until a campaign carries one date field every
 * writer stamps.
 */
const CAMPAIGN_CEILING = 30

export function HostCampaignsCard(props: { hostId: string }) {
  const { hostId } = props
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)
  // Org-shared data root (AGL-237). Null until the org lookup settles
  // (AGL-1061), and for a host with no owning org — the pre-migration host
  // path is gone (AGL-1050), so the audience picker offers the built-ins
  // alone rather than segments and lists from a dead path.
  const { scope: dataScope } = useOrgDataScope({ hostId })
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const createHostVersion = useHostVersionApi()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  /*
   * ORDERED AND CEILINGED, and not orderable on any DATE (AGL-2501, AGL-272).
   *
   * No field here is on every campaign: a sent one is written
   * `{status:'sent', sentAt}` and a scheduled one `{status:'scheduled',
   * sendAtMs}`, by the two branches of `campaign-send.ts`, and there is no
   * `createdAt` at all. `orderBy` on either would not mis-sort the history, it
   * would DROP half of it — which is what the note this replaces was about.
   *
   * What that note did not say is that the alternative was not "no order": a
   * bare `limit(30)` is answered in DOCUMENT-ID order, so the history is
   * thirty campaigns chosen by id and then sorted by date, which reads as the
   * most recent thirty and is not. `collectionCeiling` returns that same
   * thirty — document-id order is what the bare cap already gave — but it says
   * so, which is what stops the next edit reaching for `sentAt`, and it probes
   * one past the ceiling so the reader is told the history is longer.
   *
   * The sort stays because these rows are the WHOLE window rather than a slice
   * of one, and chronology is what a history list is for. Paging the query
   * would break that: a page of an id-ordered walk re-sorted by date runs in
   * one order within a page and another across pages. Ordering the history
   * properly needs one field every writer stamps, which is a change to
   * `campaign-send.ts` and a backfill, not to this card.
   */
  const { data: campaignDocs } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'campaigns'),
        CAMPAIGN_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: readCampaigns, truncated: campaignsTruncated } =
    ceilingedWindow<any>(campaignDocs, CAMPAIGN_CEILING)
  const campaigns = useMemo(
    () =>
      [...readCampaigns].sort(
        (a: any, b: any) =>
          (b.sentAt?.seconds ?? (b.sendAtMs ?? 0) / 1000) -
          (a.sentAt?.seconds ?? (a.sendAtMs ?? 0) / 1000),
      ),
    [readCampaigns],
  )
  // The page is a SLICE of a window the card already holds.
  const [historyPage, setHistoryPage] = useState(0)
  const [historyPageSize, setHistoryPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visibleCampaigns = useMemo(
    () =>
      campaigns.slice(
        historyPage * historyPageSize,
        historyPage * historyPageSize + historyPageSize,
      ),
    [campaigns, historyPage, historyPageSize],
  )

  // Contact segments (AGL-199) join the built-in audiences.
  const { data: segmentDocs } = useFirestoreCollection<any>(
    () =>
      dataScope
        ? query(
            collection(
              firestore,
              dataScope[0],
              dataScope[1],
              'contactSegments',
            ),
            limit(50),
          )
        : null,
    [firestore, dataScope],
    { idField: '$id' },
  )
  const segments = [...(segmentDocs ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  // Org email lists (AGL-254) join the audiences.
  const { data: listDocs } = useFirestoreCollection<any>(
    () =>
      dataScope
        ? query(
            collection(firestore, dataScope[0], dataScope[1], 'lists'),
            limit(50),
          )
        : null,
    [firestore, dataScope],
    { idField: '$id' },
  )
  const lists = [...(listDocs ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  /**
   * The monthly campaign allowance, standing rather than only on refusal.
   *
   * `emailSendsPerMonth` is enforced in `campaign-send.ts` against
   * `hosts/{hostId}/counters/campaignEmailSends[YYYY-MM]` and nothing else,
   * and until now that number reached the customer in exactly two places:
   * the 403 that refuses a send, and the usage-alert email that fires at
   * 80%. The composer showed `Recipients 1,240` with no hint that the plan
   * allows 500 a month — so the cap arrived as a rejection after the
   * campaign was written, which is the defect AGL-2113 fixed for five
   * per-site quotas and AGL-2246 for `templatesPerHost`.
   *
   * READ THE ENFORCEABLE METER, NOT THE COST ONE. `emailSends` beside it
   * counts every receipt, booking reminder and password reset the site sent
   * (AGL-1438); showing that total against this cap would tell a merchant
   * they had spent their campaign allowance on order confirmations.
   *
   * Per HOST because enforcement is per host — `campaign-send.ts` reads this
   * host's counter. The usage-alert cron sums the org's hosts against the
   * same cap, so on a multi-site org the alert can fire while no single site
   * has been refused; that discrepancy is the cron's, and a readout that
   * quietly averaged the two would agree with neither.
   */
  const { org, ready: orgReady } = useOrgPlan(hostId)
  const campaignMonthKey = new Date().toISOString().slice(0, 7)
  const { data: campaignSendCounter } = useFirestoreDoc<
    Record<string, unknown>
  >(
    () => doc(firestore, 'hosts', hostId, 'counters', 'campaignEmailSends'),
    [firestore, hostId],
  )
  // A host that has never sent a campaign has no counter document at all;
  // that is a settled zero, and the same zero `campaignEmailSendsForMonth`
  // resolves it to on the server.
  const campaignSendsUsed = Number(
    campaignSendCounter?.[campaignMonthKey] ?? 0,
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
        hostId,
        createHostResource,
        createHostVersion,
      )
      if (orgSlug && subdomain) {
        void router.push(besignerHref(orgSlug, subdomain, screenId, versionId))
      }
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Creating the email template failed', {
        variant: 'error',
      })
    }
  }, [
    hostId,
    createHostResource,
    createHostVersion,
    orgSlug,
    subdomain,
    router,
    enqueueSnackbar,
  ])

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

  /*
   * The audience select's value packs the kind and the id into one string
   * (`list:abc`). Decomposed ONCE here so the preview and the send cannot
   * disagree about what they are asking for — they had two copies of this
   * split, which is how a preview counts a segment while the send resolves
   * a list.
   */
  const audienceKind = audience.startsWith('segment:')
    ? 'segment'
    : audience.startsWith('list:')
      ? 'list'
      : audience
  const segmentId = audience.startsWith('segment:')
    ? audience.slice('segment:'.length)
    : ''
  const listId = audience.startsWith('list:')
    ? audience.slice('list:'.length)
    : ''

  /**
   * `Recipients 1,240` (AGL-2178) — the readout the campaign composer
   * mockup puts beside the audience picker, and the number the console
   * only ever produced AFTER a send, in a snackbar.
   *
   * It comes from a dry run of the real send path, so it has already
   * been through audience resolution, de-duplication, the per-send cap,
   * the suppression list and the monthly quota. Counting the audience
   * here instead would be a second set of rules to drift from the one
   * that decides what actually goes out — on the one number a merchant
   * checks before pressing Send.
   */
  const [preview, setPreview] = useState<
    | { sendable: number; suppressed: number }
    | { error: string }
    | null
  >(null)
  useEffect(() => {
    let active = true
    setPreview(null)
    // Debounced: switching audience with the keyboard walks the whole
    // list, and each stop would otherwise be a full audience resolution.
    const timer = setTimeout(async () => {
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
            action: 'preview',
            audience: audienceKind,
            ...(segmentId ? { segmentId } : {}),
            ...(listId ? { listId } : {}),
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!active) return
        if (!response.ok) {
          // The refusals are useful, not noise: "The audience is empty"
          // and the monthly-cap message are exactly what a merchant needs
          // BEFORE writing the email rather than after.
          return setPreview({ error: String(payload?.error ?? '') })
        }
        setPreview({
          sendable: Number(payload?.sendable ?? 0),
          suppressed: Number(payload?.suppressed ?? 0),
        })
      } catch {
        if (active) setPreview(null)
      }
    }, 400)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [hostId, user, audienceKind, segmentId, listId])

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
          audience: audienceKind,
          ...(segmentId ? { segmentId } : {}),
          ...(listId ? { listId } : {}),
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
  }, [
    subject,
    body,
    audience,
    experimentId,
    templateScreenId,
    sendAt,
    busy,
    user,
    hostId,
    confirm,
    enqueueSnackbar,
  ])

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
    <CardDisplay
      header={'Email campaigns'}
      help={pluginDocsHelp('emailCampaigns', {
        anchor: '#recipient-count',
        excerpt:
          'Compose and send to an audience. The recipient count under the ' +
          'picker is the real send path with nothing written, so duplicates, ' +
          'unsubscribes and your monthly cap are already in the number.',
      })}
      contentGutterX
      contentGutterY
    >
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
        </Stack>
        {/*
          The readout the mockup puts beside the audience picker
          (AGL-2178). It reports what the SEND resolved, so an empty
          audience or a monthly cap is said here — before the email is
          written — instead of after the Send button.
         */}
        <Typography variant="caption" color="text.secondary">
          {preview === null
            ? 'Counting recipients…'
            : 'error' in preview
              ? preview.error || 'Could not count this audience'
              : `Recipients ${preview.sendable.toLocaleString()}` +
                (preview.suppressed
                  ? ` · ${preview.suppressed.toLocaleString()} unsubscribed`
                  : '')}
        </Typography>
        {/*
          The monthly campaign cap, standing rather than only on refusal.
          `campaignSendsUsed` is the same counter+month `campaign-send.ts`
          reads, and the limit comes from the same `checkQuota` call, so
          the readout and the gate cannot disagree — the AGL-2113 rule.
          `period` says "this month" because this allowance resets; without
          it the shared readout says "on your plan", which for a monthly
          quota reads as a lifetime allowance.
         */}
        <QuotaReadoutComponent
          ready={orgReady}
          used={campaignSendsUsed}
          limit={
            checkQuota(org as never, 'emailSendsPerMonth', campaignSendsUsed)
              .limit
          }
          noun="campaign email"
          nounPlural="campaign emails"
          period="this month"
        />
        <Stack direction="row" spacing={1}>
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
              disabled={!orgSlug || !subdomain}
              onClick={() =>
                void router.push(
                  besignerHref(
                    orgSlug,
                    subdomain,
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
            color="primary"
            disabled={
              busy || !subject.trim() || (!templateScreenId && !body.trim())
            }
            onClick={handleSend}
          >
            {busy ? 'Working…' : sendAt ? 'Schedule campaign' : 'Send campaign'}
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
            {visibleCampaigns.map((campaign: any) => (
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
                        onClick={() => void handleCancelSchedule(campaign.$id)}
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
            <ListPagination
              page={historyPage}
              pageSize={historyPageSize}
              rowCount={visibleCampaigns.length}
              // The campaigns the card HOLDS — bounded by the ceiling, which
              // the notice below owns up to when it bites.
              count={campaigns.length}
              onPageChange={setHistoryPage}
              onPageSizeChange={setHistoryPageSize}
            />
            {campaignsTruncated ? (
              <Alert severity="info">
                {`Showing ${CAMPAIGN_CEILING} campaigns. This site has sent ` +
                  'more — the ones listed are not necessarily the most ' +
                  'recent, because a campaign carries no date field that ' +
                  'every send stamps.'}
              </Alert>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
HostCampaignsCard.displayName = 'HostCampaignsCard'

export default HostCampaignsCard
