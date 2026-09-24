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
  type ConsolePluginOrgMount,
  PageHeaderRecord,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { crmOrgRecordHref, crmRecordHref } from '@aglyn/aglyn/app-utils/console-record-links'
import {
  mdiAccountCancelOutline,
  mdiAccountOutline,
  mdiAccountPlusOutline,
  mdiAlertCircleOutline,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiClipboardCheckOutline,
  mdiContentCopy,
  mdiCursorDefaultClickOutline,
  mdiEmailAlertOutline,
  mdiEmailOffOutline,
  mdiEmailOutline,
  mdiHandBackLeftOutline,
  mdiPauseCircleOutline,
  mdiPencilOutline,
  mdiPlayCircleOutline,
  mdiReply,
  mdiShieldSearch,
  mdiStopCircleOutline,
} from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import RowActionsMenu from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useOrgCampaigns, useOrgMemberOptions } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Collapse,
  Divider,
  IconButton,
  Link,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { OUTREACH_MAIL_GATEWAY_LABELS } from '../engine/mail-gateway'
import { outreachClickSummary } from '../model/enrollment-engagement'
import {
  outreachEnrollmentFigures,
  outreachEnrollmentTimeline,
  outreachStepName,
  type OutreachTimelineEntry,
  type OutreachTimelineKind,
  type OutreachTimelineTone,
} from '../model/enrollment-timeline'
import {
  OUTREACH_ATTESTATION_KINDS,
  OUTREACH_ATTESTATION_LABELS,
  type OutreachDomainIntel,
  type OutreachEnrollment,
  type OutreachMailbox,
  type OutreachSequence,
} from '../model/outreach.types'
import {
  OUTREACH_ENROLLMENT_ACTION_LABELS,
  outreachEnrollmentActionsFor,
  type OutreachEnrollmentRowAction,
  useOutreachEnrollmentActions,
} from './enrollment-actions'
import { outreachCurrentStepLabel, outreachStepIsCurated, outreachStopLabel } from './enrollments-table'
import {
  formatOutreachTime,
  OutreachEnrollmentStatusChip,
  OutreachLoading,
  OutreachLoadProblem,
} from './outreach-ui'
import { OutreachFigure } from './sequence-report-card'
import { useOutreachApi } from './use-outreach-api'
import { useOutreachSequence } from './use-outreach-data'
import {
  useOutreachDomainIntel,
  useOutreachEnrollment,
  useOutreachEnrollmentHistory,
} from './use-outreach-enrollment'
import type { OutreachMailboxesResult } from './use-outreach-mailboxes'

/*==========================================
 * ONE PERSON IN ONE SEQUENCE (AGL-3332):
 * `/[orgSlug]/outreach/sequences/{sequenceId}/enrollments/{enrollmentId}`.
 *
 * A row of the Enrollments tab opens it, and its URL is the person's: a
 * comment or a message can link straight to them.
 *
 * Laid out the way every record page in the console is (the CRM's
 * `CrmRecordHeader` grammar): the page heading names the person; the first
 * card says what the record is, with the way back and the actions in its
 * HEADER — the one that changes things as a button, the rest and the
 * destructive ones behind the menu — and the facts that identify it as
 * chips. Under the chips, five numbers.
 *
 * Then ONE timeline, newest first, which is the page: every send, click,
 * reply, bounce, stop, hold and resume, from `model/enrollment-timeline.ts`.
 * Everything else stored on the enrollment is under Details, closed until
 * asked for — nothing is left out, and nothing is in the way.
 *=========================================*/

export interface OutreachEnrollmentDetailProps {
  orgId: string
  /** The org the hub is mounted under: its slug and sites, for the CRM record's address. */
  orgMount?: ConsolePluginOrgMount
  /** `/[orgSlug]/outreach/sequences`. */
  sectionPath: string
  sequenceId: string
  enrollmentId: string
  mailboxes: OutreachMailboxesResult
}

/** Where the CRM record the person is lives — the site's own CRM when the site is known. */
export function outreachCrmRecordHref(
  kind: 'lead' | 'contact',
  id: string | null | undefined,
  hostId: string,
  orgMount: Pick<ConsolePluginOrgMount, 'orgSlug' | 'hosts'> | undefined,
): string | null {
  if (!id || !orgMount?.orgSlug) return null
  const host = orgMount.hosts.find((entry) => entry.id === hostId)?.subdomain
  return host
    ? crmRecordHref({ orgSlug: orgMount.orgSlug, host }, kind, id)
    : crmOrgRecordHref(orgMount.orgSlug, kind, id)
}

/** A Gmail thread, opened in the mailbox's own account. */
export function outreachGmailThreadUrl(threadId: string, mailboxEmail: string | null | undefined): string {
  const account = mailboxEmail ? `?authuser=${encodeURIComponent(mailboxEmail)}` : ''
  return `https://mail.google.com/mail/${account}#all/${encodeURIComponent(threadId)}`
}

const KIND_ICONS: Record<OutreachTimelineKind, { path: string }> = {
  enrolled: mdiAccountPlusOutline,
  curated: mdiPencilOutline,
  sent: mdiEmailOutline,
  task: mdiClipboardCheckOutline,
  click: mdiCursorDefaultClickOutline,
  scanner: mdiShieldSearch,
  'earlier-clicks': mdiCursorDefaultClickOutline,
  paused: mdiPauseCircleOutline,
  resumed: mdiPlayCircleOutline,
  stopped: mdiStopCircleOutline,
  'do-not-contact': mdiAccountCancelOutline,
  replied: mdiReply,
  bounced: mdiEmailAlertOutline,
  'opted-out': mdiEmailOffOutline,
  held: mdiHandBackLeftOutline,
  released: mdiPlayCircleOutline,
  failed: mdiAlertCircleOutline,
  finished: mdiCheckCircleOutline,
}

const TONE_COLORS: Record<OutreachTimelineTone, string> = {
  default: 'text.secondary',
  success: 'success.main',
  info: 'info.main',
  warning: 'warning.main',
  error: 'error.main',
}

/** A destination, whole, opening in a new tab. */
function Destination(props: { url: string; label?: string }) {
  return (
    <Typography variant="body2" component="span" sx={{ display: 'block', wordBreak: 'break-all' }}>
      {props.label ? `${props.label}: ` : null}
      <Link href={props.url} target="_blank" rel="noopener noreferrer" underline="hover">
        {props.url}
      </Link>
    </Typography>
  )
}

/** One line of the timeline. */
function TimelineRow(props: {
  entry: OutreachTimelineEntry
  timeZone: string | null
  mailboxEmail: string | null
  divider: boolean
}) {
  const { entry } = props
  return (
    <ListItem alignItems="flex-start" divider={props.divider} disableGutters data-kind={entry.kind}>
      <ListItemIcon sx={{ minWidth: 36, mt: 0.75, color: TONE_COLORS[entry.tone] }}>
        <MdiIcon path={KIND_ICONS[entry.kind].path} fontSize="small" />
      </ListItemIcon>
      <ListItemText
        disableTypography
        primary={
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 0, sm: 1 }}
            sx={{ justifyContent: 'space-between', alignItems: { sm: 'baseline' } }}
          >
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {entry.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              {formatOutreachTime(entry.atMs, props.timeZone)}
            </Typography>
          </Stack>
        }
        secondary={
          <Stack spacing={0.25} sx={{ mt: 0.25 }}>
            {entry.url ? <Destination url={entry.url} label={entry.urlLabel} /> : null}
            {entry.detail ? (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {entry.detail}
              </Typography>
            ) : null}
            {entry.facts.length || entry.gmailThreadId ? (
              <Typography variant="caption" color="text.secondary" component="div">
                {entry.facts.join(' · ')}
                {entry.gmailThreadId ? (
                  <>
                    {entry.facts.length ? ' · ' : null}
                    <Link
                      href={outreachGmailThreadUrl(entry.gmailThreadId, props.mailboxEmail)}
                      target="_blank"
                      rel="noopener noreferrer"
                      underline="hover"
                    >
                      Open thread in Gmail
                    </Link>
                  </>
                ) : null}
              </Typography>
            ) : null}
          </Stack>
        }
      />
    </ListItem>
  )
}

/** One fact of the Details list. */
function Fact(props: { label: string; children: ReactNode }) {
  return (
    <>
      <Typography component="dt" variant="body2" color="text.secondary">
        {props.label}
      </Typography>
      <Box component="dd" sx={{ m: 0, minWidth: 0, typography: 'body2', wordBreak: 'break-word' }}>
        {props.children}
      </Box>
    </>
  )
}

/** What the organization's mail met at the person's domain, in a line. */
function gatewaySentence(intel: OutreachDomainIntel, timeZone: string | null): string {
  const parts = [
    OUTREACH_MAIL_GATEWAY_LABELS[intel.gateway],
    intel.mx.length ? `MX ${intel.mx.join(', ')}` : null,
    `${intel.sent} sent, ${intel.delivered} delivered, ${intel.blocked} refused from this organization`,
    intel.lastBlockedAtMs ? `last refused ${formatOutreachTime(intel.lastBlockedAtMs, timeZone)}` : null,
    intel.resolvedAtMs ? `looked up ${formatOutreachTime(intel.resolvedAtMs, timeZone)}` : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

/**
 * Everything else the enrollment holds, all of it, behind one toggle.
 */
function EnrollmentDetails(props: {
  enrollment: OutreachEnrollment
  sequence: OutreachSequence
  mailbox: OutreachMailbox | null
  intel: OutreachDomainIntel | null
  campaignName: (id: string) => string
  memberName: (uid: string) => string
  orgMount?: ConsolePluginOrgMount
  timeZone: string | null
}) {
  const { enrollment, sequence, memberName, timeZone } = props
  const { enqueueSnackbar } = useSnackbar()
  const time = (ms: number | null | undefined) => formatOutreachTime(ms, timeZone)
  const leadHref = outreachCrmRecordHref('lead', enrollment.leadId, enrollment.hostId, props.orgMount)
  const contactHref = outreachCrmRecordHref('contact', enrollment.contactId, enrollment.hostId, props.orgMount)
  const clicks = outreachClickSummary(enrollment.engagement)
  const overrides = Object.entries(enrollment.stepOverrides ?? {}).sort(
    ([a], [b]) => Number(a) - Number(b),
  )
  const attested = OUTREACH_ATTESTATION_KINDS.filter((kind) => enrollment.attestations?.[kind])
  const threads = enrollment.gmailThreadIds.length
    ? enrollment.gmailThreadIds
    : enrollment.gmailThreadId
      ? [enrollment.gmailThreadId]
      : []
  const copyId = () => {
    void navigator.clipboard
      ?.writeText(enrollment.id)
      .then(() => enqueueSnackbar('Enrollment id copied.', { variant: 'success' }))
      .catch(() => enqueueSnackbar('The id could not be copied.', { variant: 'error' }))
  }
  const link = (href: string | null, label: string) =>
    href ? (
      <Link {...({ component: AppLink, componentVariant: 'naked' } as object)} href={href} underline="hover">
        {label}
      </Link>
    ) : (
      label
    )

  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'minmax(160px, 220px) 1fr' },
        columnGap: 2,
        rowGap: 1.25,
      }}
    >
      <Fact label="Personal line">
        {enrollment.personalLine ? (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {enrollment.personalLine}
          </Typography>
        ) : (
          '—'
        )}
      </Fact>
      <Fact label="Enrolled as">
        {enrollment.target === 'lead' ? (
          link(leadHref, 'Lead')
        ) : enrollment.leadId ? (
          <>
            {link(contactHref, 'Contact')}
            {', converted from a '}
            {link(leadHref, 'lead')}
          </>
        ) : (
          link(contactHref, 'Contact')
        )}
      </Fact>
      <Fact label="Enrolled">
        {`${time(enrollment.createdAtMs)}${enrollment.enrolledByUid ? ` by ${memberName(enrollment.enrolledByUid)}` : ''}`}
      </Fact>
      <Fact label="Cold contact">
        {enrollment.cold
          ? 'Yes — no inbound capture behind them, so the member confirmed the address before enrolling'
          : 'No'}
      </Fact>
      <Fact label="Attestations">
        {attested.length ? (
          <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2.5 }}>
            {attested.map((kind) => {
              const entry = enrollment.attestations?.[kind]
              return (
                <li key={kind}>
                  {`${OUTREACH_ATTESTATION_LABELS[kind]} — ${memberName(entry?.uid ?? '')}, ${time(entry?.atMs)}`}
                </li>
              )
            })}
          </Stack>
        ) : (
          '—'
        )}
      </Fact>
      <Fact label="Mailbox">
        {props.mailbox
          ? `${props.mailbox.sendAs || props.mailbox.email}${props.mailbox.sendAs && props.mailbox.sendAs !== props.mailbox.email ? ` (${props.mailbox.email})` : ''}`
          : enrollment.mailboxId
            ? 'No longer connected'
            : '—'}
      </Fact>
      <Fact label="Campaigns">
        {enrollment.campaignIds?.length
          ? enrollment.campaignIds.map(props.campaignName).join(', ')
          : '—'}
      </Fact>
      <Fact label="Mail gateway">
        {props.intel ? gatewaySentence(props.intel, timeZone) : 'Not looked up yet'}
      </Fact>
      <Fact label="Gateway hold">
        {enrollment.gatewayHold
          ? [
              OUTREACH_MAIL_GATEWAY_LABELS[enrollment.gatewayHold.gateway],
              enrollment.gatewayHold.heldAtMs ? `held ${time(enrollment.gatewayHold.heldAtMs)}` : 'never held',
              enrollment.gatewayHold.releasedAtMs
                ? `released ${time(enrollment.gatewayHold.releasedAtMs)}${enrollment.gatewayHold.releasedByUid ? ` by ${memberName(enrollment.gatewayHold.releasedByUid)}` : ''}`
                : 'not released',
            ].join(' · ')
          : '—'}
        {enrollment.gatewayDeliveredSteps
          ? ` (${enrollment.gatewayDeliveredSteps} of their emails counted as delivered on the gateway ledger)`
          : null}
      </Fact>
      <Fact label="Clicks">
        {clicks.clicks || clicks.machineClicks
          ? [
              `${clicks.clicks} by the person`,
              `${clicks.machineClicks} by scanners, not counted`,
              `${clicks.clicks - clicks.unloggedClicks + clicks.machineClicks - clicks.unloggedMachineClicks} listed one by one`,
              enrollment.engagement?.firstClickAtMs ? `first ${time(enrollment.engagement.firstClickAtMs)}` : null,
              enrollment.engagement?.lastClickAtMs ? `last ${time(enrollment.engagement.lastClickAtMs)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : '—'}
        {clicks.followed.length ? (
          <Box sx={{ mt: 0.5 }}>
            {clicks.followed.map((url) => (
              <Destination key={url} url={url} />
            ))}
          </Box>
        ) : null}
      </Fact>
      <Fact label="Curated steps">
        {overrides.length ? (
          <Stack spacing={1.5}>
            {overrides.map(([key, override]) => (
              <Box key={key}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {outreachStepName(sequence.steps, Number(key))}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {[
                    override.source === 'ai' ? (override.edited ? 'AI draft, edited' : 'AI draft') : 'Written by a member',
                    override.draftedByUid ? `confirmed by ${memberName(override.draftedByUid)}` : null,
                    override.draftedAtMs ? time(override.draftedAtMs) : null,
                    override.model ? `model ${override.model}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
                {override.subject !== undefined ? (
                  <Typography variant="body2">{`Subject: ${override.subject}`}</Typography>
                ) : null}
                {override.body !== undefined ? (
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: 'pre-wrap', mt: 0.5, pl: 1.5, borderLeft: 2, borderColor: 'divider' }}
                  >
                    {override.body}
                  </Typography>
                ) : null}
                {override.prompt ? (
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>
                    {`Prompt: ${override.prompt}`}
                  </Typography>
                ) : null}
              </Box>
            ))}
          </Stack>
        ) : (
          '—'
        )}
      </Fact>
      <Fact label="Gmail threads">
        {threads.length ? (
          <Stack spacing={0.25}>
            {threads.map((thread) => (
              <span key={thread}>
                <Link
                  href={outreachGmailThreadUrl(thread, props.mailbox?.email)}
                  target="_blank"
                  rel="noopener noreferrer"
                  underline="hover"
                >
                  {thread}
                </Link>
                {thread === enrollment.gmailThreadId ? ' (current)' : null}
              </span>
            ))}
            {enrollment.threadSubject ? (
              <Typography variant="caption" color="text.secondary">{`Started as “${enrollment.threadSubject}”`}</Typography>
            ) : null}
            {enrollment.messageIds.length ? (
              <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                {`Message-IDs in the current thread: ${enrollment.messageIds.join(' ')}`}
              </Typography>
            ) : null}
          </Stack>
        ) : (
          '—'
        )}
      </Fact>
      <Fact label="Stop">
        {enrollment.stopReason
          ? `${outreachStopLabel(enrollment)} · ${time(enrollment.stoppedAtMs)}${enrollment.stoppedByUid ? ` · by ${memberName(enrollment.stoppedByUid)}` : ''}`
          : '—'}
      </Fact>
      <Fact label="Created · updated">{`${time(enrollment.createdAtMs)} · ${time(enrollment.updatedAtMs)}`}</Fact>
      <Fact label="Enrollment id">
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {enrollment.id}
          </Typography>
          <Tooltip title="Copy the id">
            <IconButton size="small" aria-label="Copy the enrollment id" onClick={copyId}>
              <MdiIcon path={mdiContentCopy.path} fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Fact>
    </Box>
  )
}

export function OutreachEnrollmentDetail(props: OutreachEnrollmentDetailProps) {
  const { orgId, sectionPath, sequenceId, enrollmentId, orgMount } = props
  const api = useOutreachApi(orgId)
  const loadedSequence = useOutreachSequence(orgId, sequenceId)
  const loaded = useOutreachEnrollment(orgId, enrollmentId)
  const history = useOutreachEnrollmentHistory(orgId, enrollmentId)
  const intel = useOutreachDomainIntel(orgId, loaded.data?.email ?? null)
  const roster = useOrgMemberOptions(orgId, { enabled: true })
  const [detailsOpen, setDetailsOpen] = useState(false)
  const enrollment = loaded.data
  const sequence = loadedSequence.data
  const campaigns = useOrgCampaigns(orgId, {
    enabled: detailsOpen && Boolean(enrollment?.campaignIds?.length),
  })
  const steps = useMemo(() => sequence?.steps ?? [], [sequence])
  const actions = useOutreachEnrollmentActions({ api, steps })

  const memberName = useCallback(
    (uid: string) => roster.options.find((option) => option.uid === uid)?.label ?? 'a member',
    [roster.options],
  )
  const campaignName = useCallback(
    (id: string) => campaigns.options.find((option) => option.value === id)?.label ?? id,
    [campaigns.options],
  )

  const enrollmentsPath = `${sectionPath}/${sequenceId}/enrollments`
  const mailbox =
    props.mailboxes.mailboxes.find((entry) => entry.id === (enrollment?.mailboxId || sequence?.mailboxId)) ?? null
  const timeZone = mailbox?.timezone ?? null
  const time = (ms: number | null | undefined) => formatOutreachTime(ms, timeZone)
  const timeline = useMemo(
    () =>
      enrollment
        ? outreachEnrollmentTimeline({
            enrollment,
            steps,
            history: history.status === 'ready' ? history.data : null,
            memberName,
            formatTime: (ms) => formatOutreachTime(ms, timeZone),
            gateway: intel.data?.gateway ?? null,
          })
        : [],
    [enrollment, steps, history, memberName, timeZone, intel.data],
  )

  const back = (
    <Button
      // A real link, as the CRM record header's is: it opens in a new tab when asked.
      {...({ component: AppLink, componentVariant: 'naked', nativeButton: false } as object)}
      href={enrollmentsPath}
      size="small"
      color="primary"
    >
      Back to enrollments
    </Button>
  )

  if (loaded.status === 'loading' || loadedSequence.status === 'loading') {
    return <OutreachLoading label="Loading this person…" />
  }
  if (loaded.status === 'error' || loaded.status === 'refused') {
    return <OutreachLoadProblem status={loaded.status} what="enrollment" />
  }
  if (loadedSequence.status === 'error' || loadedSequence.status === 'refused') {
    return <OutreachLoadProblem status={loadedSequence.status} what="sequence" />
  }
  // An id from another sequence reads as not here: the URL names both.
  if (!enrollment || !sequence || enrollment.sequenceId !== sequenceId) {
    return (
      <Card variant="outlined">
        <EmptyStateComponent
          label="This person isn’t in this sequence"
          description="They may have been removed from the workspace, or the link names a different sequence."
          action={back}
        />
      </Card>
    )
  }

  const name = enrollment.contactName || enrollment.email
  const kind = enrollment.target === 'lead' ? 'lead' : 'contact'
  const recordHref = outreachCrmRecordHref(
    kind,
    kind === 'lead' ? enrollment.leadId : enrollment.contactId,
    enrollment.hostId,
    orgMount,
  )
  const figures = outreachEnrollmentFigures(enrollment)
  const trackClicks = sequence.settings.trackClicks || sequence.stats?.clickTracked === true
  const open = enrollment.status === 'active' || enrollment.status === 'paused'
  const held = enrollment.status === 'paused' && enrollment.stopReason === 'gateway_blocked_here'

  /*
   * The one act that moves the person forward is the button: resuming a
   * paused one, else curating the next email. Everything else is in the
   * menu, the destructive acts included, as on every record page.
   */
  const available = outreachEnrollmentActionsFor(enrollment, steps)
  const primary: OutreachEnrollmentRowAction | null = available.includes('resume')
    ? 'resume'
    : available.includes('curate')
      ? 'curate'
      : null
  const menu = actions.menuItems(enrollment, (action) => action !== primary)
  const dash = (value: number) => (value ? value.toLocaleString() : '—')
  const notTracked = !trackClicks && !figures.clicks && !figures.scannerClicks ? 'Not tracked' : undefined
  const thread = enrollment.gmailThreadId ?? enrollment.gmailThreadIds.at(-1) ?? null
  const nothingYet =
    enrollment.status === 'active' && enrollment.nextDueAtMs
      ? `Nothing yet — step ${enrollment.stepIndex + 1} sends ${time(enrollment.nextDueAtMs)}.`
      : 'Nothing yet.'

  return (
    <Stack spacing={2}>
      {/* The page heading and the trail name the person; the card says what they are in. */}
      <PageHeaderRecord title={name} />
      <CardDisplay
        header="Enrollment"
        subheader={
          <>
            {enrollment.contactName ? `${enrollment.email} · ` : ''}
            {`In ${sequence.name || 'Untitled'}`}
          </>
        }
        help={pluginDocsHelp('sequences', { anchor: '#person-history' })}
        contentGutterX
        contentGutterY
        HeaderProps={{
          action: (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
              {back}
              {primary ? (
                <Button
                  variant="outlined"
                  size="small"
                  disabled={actions.busy === enrollment.id}
                  onClick={() => actions.choose(enrollment, primary)}
                >
                  {held ? 'Resume and send' : OUTREACH_ENROLLMENT_ACTION_LABELS[primary]}
                </Button>
              ) : null}
              {menu.length ? <RowActionsMenu label={name} items={menu} /> : null}
            </Stack>
          ),
        }}
      >
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <Tooltip
              describeChild
              title={recordHref ? `Open the ${kind} in the CRM` : `The ${kind}’s record can’t be linked`}
            >
              <Chip
                size="small"
                variant="outlined"
                color={recordHref ? 'primary' : 'default'}
                icon={<MdiIcon path={mdiAccountOutline.path} fontSize="small" />}
                label={kind === 'lead' ? 'Lead' : 'Contact'}
                {...(recordHref
                  ? ({ component: AppLink, href: recordHref, clickable: true, componentVariant: 'naked' } as object)
                  : {})}
              />
            </Tooltip>
            <OutreachEnrollmentStatusChip status={enrollment.status} />
            <Chip size="small" variant="outlined" label={outreachCurrentStepLabel(enrollment, steps)} />
            {outreachStepIsCurated(enrollment) ? (
              <Chip size="small" variant="outlined" color="success" label="Curated" />
            ) : null}
            {open && enrollment.nextDueAtMs ? (
              <Chip size="small" variant="outlined" label={`Next send ${time(enrollment.nextDueAtMs)}`} />
            ) : null}
          </Stack>
          {held ? (
            <Alert severity="warning">
              {enrollment.stopDetail ||
                'Their mail gateway refused this sender, so the next email is held. Resume to send it anyway.'}
            </Alert>
          ) : null}
          {figures.anything ? (
            <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', rowGap: 2 }} role="group" aria-label="In numbers">
              <OutreachFigure label="Emails sent" value={dash(figures.emailsSent)} />
              <OutreachFigure label="Clicks" value={dash(figures.clicks)} hint={notTracked} />
              <OutreachFigure
                label="Links followed"
                value={
                  figures.linksFollowed.count
                    ? `${figures.linksFollowed.count}${figures.linksFollowed.atLeast ? '+' : ''}`
                    : '—'
                }
                hint={
                  notTracked ??
                  (figures.linksFollowed.atLeast && figures.linksFollowed.count
                    ? 'Earlier clicks kept the last link only'
                    : undefined)
                }
              />
              <OutreachFigure label="Scanner clicks" value={dash(figures.scannerClicks)} hint={notTracked ?? 'Not counted'} />
              <OutreachFigure label="Replies" value={dash(figures.replies)} />
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {nothingYet}
            </Typography>
          )}
        </Stack>
      </CardDisplay>

      <CardDisplay
        header="Activity"
        subheader="Newest first"
        contentGutterX
        contentGutterY
        HeaderProps={
          thread
            ? {
                action: (
                  <Button
                    size="small"
                    href={outreachGmailThreadUrl(thread, mailbox?.email)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open thread in Gmail
                  </Button>
                ),
              }
            : undefined
        }
      >
        <Stack spacing={1}>
          {history.status === 'loading' ? <OutreachLoading label="Loading their clicks…" /> : null}
          {history.status === 'error' || history.status === 'refused' ? (
            <OutreachLoadProblem
              status={history.status}
              what="list of their clicks"
              // Only the one-by-one list is missing: the totals, the sends and
              // every stop above come from the enrollment, which was read.
              message={
                history.status === 'refused'
                  ? 'Their clicks can’t be listed one by one here; the numbers above still count them.'
                  : 'Their clicks couldn’t be listed one by one. Reload the page to try again.'
              }
            />
          ) : null}
          <List disablePadding aria-label="Activity">
            {timeline.map((entry, index) => (
              <TimelineRow
                key={entry.key}
                entry={entry}
                timeZone={timeZone}
                mailboxEmail={mailbox?.email ?? null}
                divider={index < timeline.length - 1}
              />
            ))}
          </List>
        </Stack>
      </CardDisplay>

      <CardDisplay
        header="Details"
        contentGutterX
        HeaderProps={{
          action: (
            <Button
              size="small"
              aria-expanded={detailsOpen}
              aria-controls="outreach-enrollment-details"
              endIcon={<MdiIcon path={(detailsOpen ? mdiChevronUp : mdiChevronDown).path} fontSize="small" />}
              onClick={() => setDetailsOpen((was) => !was)}
            >
              {detailsOpen ? 'Hide' : 'Show'}
            </Button>
          ),
        }}
      >
        <Collapse in={detailsOpen} unmountOnExit>
          <Box id="outreach-enrollment-details" sx={{ pb: 2 }}>
            <Divider sx={{ mb: 2 }} />
            <EnrollmentDetails
              enrollment={enrollment}
              sequence={sequence}
              mailbox={mailbox}
              intel={intel.data}
              campaignName={campaignName}
              memberName={memberName}
              orgMount={orgMount}
              timeZone={timeZone}
            />
          </Box>
        </Collapse>
      </CardDisplay>

      {actions.dialogs}
    </Stack>
  )
}
OutreachEnrollmentDetail.displayName = 'OutreachEnrollmentDetail'

export default OutreachEnrollmentDetail
