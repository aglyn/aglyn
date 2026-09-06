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

import * as Aglyn from '@aglyn/aglyn'
import type {
  ContactCampaignEmail,
  ContactInteraction,
  ContactSource,
  CrmActivityRow,
} from '@aglyn/aglyn'
import { CONTACT_SOURCE_LABELS, pluginDocsHelp } from '@aglyn/aglyn'
import {
  mdiAccountEditOutline,
  mdiAccountPlusOutline,
  mdiApi,
  mdiBullhornOutline,
  mdiCalendarCheckOutline,
  mdiCartOutline,
  mdiEmailNewsletter,
  mdiFileImportOutline,
  mdiFormSelect,
} from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { Button, Chip, Stack, Tooltip, Typography } from '@mui/material'
import { useParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { ActivityRow } from './activity-list'
import {
  type ActivityRecordLink,
  type CrmOrg,
  useActivityScope,
  useActivityWindow,
  useCanEditActivity,
} from './activity-queries'
import { LogActivityDialog } from './log-activity-dialog'
import { useContactCampaignEmails } from './use-contact-campaign-emails'

/**
 * One glyph per capture door. Typed against the source union so a door added
 * to it cannot render as the placeholder glyph.
 */
const SOURCE_ICONS: Record<ContactSource, { path: string }> = {
  form: mdiFormSelect,
  member: mdiAccountPlusOutline,
  order: mdiCartOutline,
  booking: mdiCalendarCheckOutline,
  newsletter: mdiEmailNewsletter,
  api: mdiApi,
  manual: mdiAccountEditOutline,
  import: mdiFileImportOutline,
}

/**
 * One thing the platform recorded: the door it came through, what the door
 * wrote, when, and the page the person was on.
 *
 * Read-only by nature — nobody logged it, so nobody edits it. The entry
 * point sits beside the timestamp rather than in the summary, the way the
 * contacts drawer draws it: the summary is the sentence the door wrote, the
 * path is a fact the door recorded, and a long path on the sentence's line
 * pushes out the thing the row is about.
 */
function CapturedRow(props: {
  interaction: ContactInteraction
  nowMs: number
  /** The console page the door's record is read on, when it left one. */
  href: string | null
}) {
  const { interaction, nowMs, href } = props
  const source = interaction.type
  const label = CONTACT_SOURCE_LABELS[source] ?? String(source)
  const icon = SOURCE_ICONS[source]
  const when = new Date(interaction.atMs)
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      <Stack
        sx={{
          color: 'text.secondary',
          pt: 0.25,
          fontSize: (theme) => theme.typography.h6.fontSize,
        }}
      >
        <MdiIcon path={icon?.path} />
      </Stack>
      <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
        >
          <Chip label={label} size="small" />
          <Chip label="Captured" size="small" variant="outlined" />
        </Stack>
        <Typography variant="body2">
          {interaction.summary ?? label}
        </Typography>
        <Tooltip title={when.toLocaleString()}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ alignSelf: 'flex-start' }}
          >
            {interaction.path
              ? `${Aglyn.activityTimeLabel(interaction.atMs, nowMs)} · ${interaction.path}`
              : Aglyn.activityTimeLabel(interaction.atMs, nowMs)}
          </Typography>
        </Tooltip>
        {/*
          The record the door left, where the console reads it (AGL-2622):
          the submission in the Inbox reader, the order in its dialog. A door
          that left nothing to open — a newsletter opt-in, an import — has no
          link, and the caption above is the whole entry.
        */}
        {href ? (
          <Typography variant="caption" sx={{ alignSelf: 'flex-start' }}>
            <AppLink href={href}>
              {Aglyn.INTERACTION_LINK_LABELS[source] ?? 'Open'}
            </AppLink>
          </Typography>
        ) : null}
      </Stack>
    </Stack>
  )
}
CapturedRow.displayName = 'CapturedRow'

/**
 * One campaign email the platform sent this person (AGL-2616): which email,
 * and what became of it — `sent · delivered · opened ×2 · clicked`.
 *
 * Read-only like a captured row, and drawn apart from BOTH the captured and
 * the logged rows: its glyph is the campaign's, never the envelope a logged
 * `email` activity carries, and its chips say "Campaign" and "Sent" where
 * the others say "Captured" and "Logged". The name links to the email's own
 * report when the page can address it; an email the team has deleted, or
 * one a sibling site sent, keeps its name and loses the link.
 */
function CampaignEmailRow(props: {
  email: ContactCampaignEmail
  href: string | null
  nowMs: number
}) {
  const { email, href, nowMs } = props
  const name = email.campaignName ?? email.subject ?? 'Campaign email'
  const summary = Aglyn.campaignEmailSummary(email).join(' · ')
  const when = new Date(email.sentAtMs)
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      <Stack
        sx={{
          color: 'text.secondary',
          pt: 0.25,
          fontSize: (theme) => theme.typography.h6.fontSize,
        }}
      >
        <MdiIcon path={mdiBullhornOutline.path} />
      </Stack>
      <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
        >
          <Chip label="Campaign" size="small" />
          <Chip label="Sent" size="small" variant="outlined" />
        </Stack>
        <Typography variant="body2">
          {href ? <AppLink href={href}>{name}</AppLink> : name}
          {` · ${summary}`}
        </Typography>
        <Tooltip title={when.toLocaleString()}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ alignSelf: 'flex-start' }}
          >
            {email.subject && email.subject !== name
              ? `${Aglyn.activityTimeLabel(email.sentAtMs, nowMs)} · ${email.subject}`
              : Aglyn.activityTimeLabel(email.sentAtMs, nowMs)}
          </Typography>
        </Tooltip>
      </Stack>
    </Stack>
  )
}
CampaignEmailRow.displayName = 'CampaignEmailRow'

export interface ContactTimelineCardProps {
  hostId: string
  org: CrmOrg
  contactId: string
  /**
   * The RAW contact document, as the page's listener hands it back. The card
   * resolves the viewing group and reads that group's facet itself, so a
   * page cannot hand it another holder's timeline by flattening the row
   * through the wrong group.
   */
  contact: Record<string, unknown> | null | undefined
  /**
   * Where a campaign entry links to — the email's report — or `null` for
   * one the page cannot address. Handed in rather than built here because
   * the report lives on another surface whose path is the MOUNT's to know:
   * a site's record page reaches its own Emails hub, an org-level mount
   * holds the org's site list and can reach every site's. No builder means
   * no links, never a guessed one.
   */
  campaignHref?: (email: ContactCampaignEmail) => string | null
}

/**
 * A person's whole history in one newest-first stream (AGL-2600): what the
 * platform CAPTURED — a form, an order, a booking, a sign-up — what a person
 * LOGGED beside it — a call, an email, a meeting, a note — and, since
 * AGL-2616, the campaign mail the platform SENT them and what became of it.
 *
 * ## Why one stream
 *
 * The histories answer one question, "what has happened with this person",
 * and a page showing them as separate lists asks the reader to interleave
 * them by eye. The merge is `mergeContactTimeline`, pure and specced: newest
 * first, stable at a tie, an undated entry last, a campaign at the instant
 * it was sent.
 *
 * Each entry says which it is. A captured entry carries the door's label and
 * a "Captured" chip and offers no controls; a logged entry carries its kind
 * and a "Logged" chip, and its author may edit or delete it; a campaign
 * entry carries "Campaign" and "Sent", links to the email's report, and is
 * nobody's to edit.
 *
 * ## What is read
 *
 * The captured side comes off the contact document the page already holds
 * — THIS group's facet, filtered to the sites the group may see, the same
 * projection the contacts list makes — and costs no read. The logged side is
 * the bounded listener every activity surface uses, filtered to this
 * contact, with a foot for the next hundred. The campaign side is one
 * request to `crm/contact-email-history`, which reads down this person's
 * own delivery log, capped, and never a campaign's recipients. The facet's
 * history is capped at fifty by the platform, so past the window the stream
 * is the logged side alone; the foot says as much by asking for "more
 * activity" rather than "more history".
 */
export function ContactTimelineCard(props: ContactTimelineCardProps) {
  const { hostId, org, contactId, contact, campaignHref } = props
  const scope = useActivityScope(hostId, org)
  const { consentGroup } = scope
  /*
   * THIS holder's captured history, and only the visits this group may see.
   * A read off the top of the document, or of another group's facet, would
   * be another business's records — the disclosure the facet shape ended.
   */
  const interactions = useMemo(() => {
    const facet = Aglyn.readContactFacet(contact, consentGroup.groupId)
    return Aglyn.interactionsForGroup(facet.interactions, consentGroup.hostIds)
  }, [contact, consentGroup])
  const link = useMemo<ActivityRecordLink>(() => ({ contactId }), [contactId])
  const activities = useActivityWindow(scope, link)
  /*
   * Where a captured entry's record is READ (AGL-2622). The site console's
   * two route params are already in the URL this page is on, so the link is
   * built from them rather than from two document reads per timeline. Only
   * an interaction on THIS site links: a sibling site's order is that
   * site's record, read on that site's console, and a link built with this
   * site's segment would 404 or — worse — open the wrong site's row under
   * the same id. An interaction with no site recorded predates the stamp
   * and is left unlinked rather than guessed at. Off a site — the org-level
   * mount — there is no segment to build with, and nothing links.
   */
  const params = useParams<{ orgSlug?: string; host?: string }>()
  const siteContext = useMemo(
    () =>
      params?.orgSlug && params?.host
        ? { orgSlug: String(params.orgSlug), host: String(params.host) }
        : null,
    [params?.orgSlug, params?.host],
  )
  const interactionHref = useCallback(
    (interaction: ContactInteraction): string | null =>
      siteContext && interaction.hostId === hostId
        ? Aglyn.contactInteractionHref(interaction, siteContext)
        : null,
    [siteContext, hostId],
  )
  const campaigns = useContactCampaignEmails(hostId, contactId)
  // One member read for the whole stream, however many rows it has.
  const canEdit = useCanEditActivity(scope.orgId)
  const entries = useMemo(
    () =>
      Aglyn.mergeContactTimeline(interactions, activities.rows, campaigns.emails),
    [interactions, activities.rows, campaigns.emails],
  )
  // One clock for every row of one paint, so two rows logged a second apart
  // cannot read "just now" and "1 min ago" from being rendered across a
  // minute boundary.
  const nowMs = Date.now()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CrmActivityRow | null>(null)
  const openNew = useCallback(() => {
    setEditing(null)
    setDialogOpen(true)
  }, [])
  const openEdit = useCallback((activity: CrmActivityRow) => {
    setEditing(activity)
    setDialogOpen(true)
  }, [])
  const close = useCallback(() => setDialogOpen(false), [])

  const loggedChip = useMemo(
    () => <Chip label="Logged" size="small" variant="outlined" />,
    [],
  )

  return (
    <>
      <CardDisplay
        header={'Timeline'}
        help={pluginDocsHelp('contactActivities', { anchor: '#three-kinds-of-history' })}
        actions={
          <Button
            size="small"
            variant="contained"
            color="primary"
            onClick={openNew}
            disabled={!activities.ready}
          >
            {'Log activity'}
          </Button>
        }
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          {activities.status === 'error' ? (
            <Typography variant="body2" color="error">
              {'Logged activity could not be loaded; what follows is what the platform captured.'}
            </Typography>
          ) : null}
          {campaigns.status === 'error' || campaigns.lookupFailed ? (
            // "Unknown", not "none": an empty campaign history and one that
            // could not be read lead a reader to opposite conclusions.
            <Typography variant="body2" color="error">
              {'Campaign email could not be loaded; the stream below may be missing the mail this person was sent.'}
            </Typography>
          ) : null}
          {entries.length === 0 ? (
            campaigns.status === 'loading' ? (
              // The campaign history is one request on mount; an empty state
              // before it answers would read as "none" for a person who was mailed.
              <Typography variant="body2" color="text.secondary">
                {'Loading…'}
              </Typography>
            ) : (
            <EmptyStateComponent
              compact
              label={'No history yet'}
              description={'What this person does on the site, the campaigns they are sent, and what you log about them, shows here.'}
              action={
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  onClick={openNew}
                  disabled={!activities.ready}
                >
                  {'Log activity'}
                </Button>
              }
            />
            )
          ) : (
            entries.map((entry) =>
              entry.kind === 'captured' ? (
                <CapturedRow
                  key={entry.key}
                  interaction={entry.interaction}
                  nowMs={nowMs}
                  href={interactionHref(entry.interaction)}
                />
              ) : entry.kind === 'campaign' ? (
                <CampaignEmailRow
                  key={entry.key}
                  email={entry.email}
                  href={campaignHref ? campaignHref(entry.email) : null}
                  nowMs={nowMs}
                />
              ) : (
                <ActivityRow
                  key={entry.key}
                  activity={entry.activity}
                  scope={scope}
                  onEdit={openEdit}
                  subject={loggedChip}
                  nowMs={nowMs}
                  editable={canEdit(entry.activity)}
                />
              ),
            )
          )}
          {activities.hasMore ? (
            <Button
              size="small"
              onClick={activities.showMore}
              sx={{ alignSelf: 'flex-start' }}
            >
              {'Show more activity'}
            </Button>
          ) : null}
        </Stack>
      </CardDisplay>
      <LogActivityDialog
        open={dialogOpen}
        onClose={close}
        scope={scope}
        link={link}
        activity={editing}
      />
    </>
  )
}
ContactTimelineCard.displayName = 'ContactTimelineCard'

export default ContactTimelineCard
