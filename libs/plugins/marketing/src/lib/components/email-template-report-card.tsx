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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { pluginRecordHref } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { mdiBullhornOutline, mdiPageNextOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Figure,
  RateRow,
  Section,
} from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Chip,
  Divider,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  collection,
  documentId,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import {
  CAMPAIGN_SEND_CONTAINER_FIELD,
  campaignSendDisplay,
  campaignSendVisibleTo,
  orgCampaignSendsPath,
} from '../model/campaign-container'
import { emailSendTimeMs } from '../model/email-record'
import { templateReport, type TemplateCampaign } from '../model/template-report'

/**
 * How many of a template's messages one read covers.
 *
 * A CEILING on the read, not a page size: the report is a single figure per
 * quantity, so there is nothing to page through. Past it every total is a
 * floor and the report says so — the same treatment `audienceSizeTruncated`
 * gets, and for the same reason.
 */
export const TEMPLATE_CAMPAIGN_CEILING = 100

const reportDocsHelp = pluginDocsHelp('designedEmails', { anchor: '#template-report' })

/** What the Email plugin's template page hands its report zone. */
export interface EmailTemplateReportCardProps {
  hostId: string
  /** The `kind: 'email'` screen document the template page is about. */
  screenId: string
  /** The Emails page's own path, which every message link hangs beneath. */
  basePath: string
}

/**
 * A message row on this card: what the report needs, plus what the ROW needs.
 *
 * `TemplateCampaign` is the report's shape and stays that — it is the input to
 * `templateReport`, and a field the figures do not read has no business in it.
 * The send time this table sorts on and the campaign its row menu offers are
 * both properties of the row rather than of the report.
 */
type TemplateMessage = TemplateCampaign & {
  scheduledForMs: number
  /** Absent on a message written before campaigns grouped their emails. */
  emailCampaignId?: string
}

/**
 * WHAT ONE TEMPLATE'S EMAILS DID, SUMMED (AGL-3080).
 *
 * The template is the Email plugin's; the messages sent from it are this
 * plugin's campaign sends. So the template's page hosts a zone and this card
 * fills it: the page names the template, and the sends are read here, where
 * their collection is owned.
 *
 * ## What this card reads
 *
 * The messages naming this template, bounded at
 * {@link TEMPLATE_CAMPAIGN_CEILING}. The recipients table is its own card and
 * its own request, so a reader who came for the totals does not pay for the
 * delivery-log query.
 */
export function EmailTemplateReportCard(props: EmailTemplateReportCardProps) {
  const { hostId, screenId, basePath } = props
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)
  /*
   * A campaign's page is published on the record-route seam like every other
   * kind, and read the same way here: one place decides where a `campaign`
   * is read. Null before the console's URL has resolved.
   */
  const campaignHref = (campaignId: string): string | null =>
    orgSlug && subdomain
      ? pluginRecordHref('campaign', { orgSlug, host: subdomain }, campaignId)
      : null
  const firestore = useFirestore()
  const router = useRouter()

  /*
   * The messages sent from this template, ordered by DOCUMENT ID.
   *
   * Not by date, and that is forced rather than chosen: a sent message
   * carries `sentAt`, a scheduled one carries `sendAtMs`, and no writer
   * stamps a `createdAt` — so `orderBy` on either would not mis-sort this
   * list, it would DROP every message written by the other branch. Ordering
   * on the document id is the one ordering every message satisfies, and the
   * rows are sorted by date below over a window this component already holds.
   * The index the filters need is `visibleTo` + `templateScreenId`, declared
   * in `cloud/firebase-firestore.indexes.json`.
   *
   * One MORE than the ceiling, so truncation is a fact rather than a guess.
   *
   * The sends are the ORGANIZATION'S, each stamped with the one site it is
   * sent as. The `visibleTo` clause names this site: it keeps a sibling
   * site's sends of a same-id design out, and it is what makes the read
   * provable for a collaborator scoped to this site — the rules evaluate a
   * list per document, and an unfiltered one is refused whole. Nothing is
   * read until the site's org is known.
   */
  const { orgId } = useOrgDataScope({ hostId })
  const sendScope = useMemo(() => campaignSendVisibleTo(hostId), [hostId])
  const { data: messageDocs } = useFirestoreCollection<any>(
    () =>
      orgId
        ? query(
            collection(firestore, ...orgCampaignSendsPath(orgId)),
            where('visibleTo', 'array-contains-any', sendScope),
            where('templateScreenId', '==', screenId),
            orderBy(documentId()),
            limit(TEMPLATE_CAMPAIGN_CEILING + 1),
          )
        : null,
    [firestore, orgId, sendScope, screenId],
    { idField: '$id' },
  )

  const truncated = (messageDocs?.length ?? 0) > TEMPLATE_CAMPAIGN_CEILING
  const messages = useMemo<TemplateMessage[]>(
    () =>
      (messageDocs ?? [])
        .slice(0, TEMPLATE_CAMPAIGN_CEILING)
        .map((message: any) => ({
          campaignId: String(message.$id),
          subject: String(message.subject || 'Untitled email'),
          /*
           * A message that has not gone out has NO send time, and that is
           * what `null` means here — not "unknown". The report measures
           * engagement over sent messages only, so a scheduled one
           * contributes to the list below and to no figure above it.
           */
          sentAtMs:
            String(message.status ?? '') === 'sent'
              ? emailSendTimeMs(message) || null
              : null,
          status: String(message.status ?? 'sent'),
          audience: String(message.audience ?? ''),
          ...(message.listId ? { listId: String(message.listId) } : {}),
          ...(message.listName ? { listName: String(message.listName) } : {}),
          stats: message.stats,
          scheduledForMs: emailSendTimeMs(message),
          /*
           * The campaign this message belongs to, carried through so the row
           * can offer it. A message written before campaigns grouped anything
           * names no container, which is why it is optional rather than
           * defaulted to the message's own id — a menu item that navigated to
           * the message you are already looking at would be worse than one
           * that says the message belongs to no campaign.
           */
          ...(message[CAMPAIGN_SEND_CONTAINER_FIELD]
            ? {
                emailCampaignId: String(
                  message[CAMPAIGN_SEND_CONTAINER_FIELD],
                ),
              }
            : {}),
        })),
    [messageDocs],
  )
  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => b.scheduledForMs - a.scheduledForMs),
    [messages],
  )
  const report = useMemo(
    () => templateReport(messages, truncated),
    [messages, truncated],
  )

  const messageHref = (message: TemplateMessage) =>
    `${basePath}/messages/${message.campaignId}`

  /**
   * What one message sent from this template can be opened into.
   *
   * Its own report, and the campaign that grouped it. The template is the page
   * the reader is standing on, so it is not offered a third time. A message
   * sent before campaigns existed belongs to no container, and the item says
   * so rather than vanishing.
   */
  const messageActions = (message: TemplateMessage): RowActionsMenuItem[] => [
    {
      key: 'details',
      label: 'Open report',
      icon: <MdiIcon path={mdiPageNextOutline.path} size={0.8} />,
      href: messageHref(message),
    },
    {
      key: 'campaign',
      label: 'Open its campaign',
      icon: <MdiIcon path={mdiBullhornOutline.path} size={0.8} />,
      // The one href here that is not under the Emails page's base path.
      href:
        (message.emailCampaignId && campaignHref(message.emailCampaignId)) ||
        undefined,
      disabled:
        !message.emailCampaignId || !campaignHref(message.emailCampaignId),
      disabledReason: message.emailCampaignId
        ? 'This site’s console URL has not resolved yet'
        : 'Sent before campaigns grouped their emails, so it belongs to none',
    },
  ]

  return (
    <CardDisplay
      header={'Sent from this template'}
      help={reportDocsHelp}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={3}>
        {report.caveats.map((caveat) => (
          <Alert key={caveat.id} severity="info">
            {caveat.message}
          </Alert>
        ))}

        {/*==========================================
          * WHAT HAPPENED TO THE MAIL, SUMMED.
          *
          * Counts first and rates second, because a rate is only readable
          * once you know what it was taken over — and because a count here
          * covers every message while a rate covers only the messages that
          * recorded its denominator. The rate labels say which.
          *=========================================*/}
        <Section title="Delivery">
          <Stack
            direction="row"
            spacing={4}
            useFlexGap
            sx={{ flexWrap: 'wrap' }}
          >
            <Figure
              label="Emails"
              value={report.sentCampaigns}
              note="sent from this template"
            />
            <Figure
              label="Addressed"
              value={report.recipients}
              note="after each send's cap"
            />
            <Figure
              label="Sent"
              value={report.sent}
              note="accepted by the provider"
            />
            <Figure
              label="Delivered"
              value={report.delivered}
              note="accepted by the receiving server"
            />
            <Figure label="Bounced" value={report.bounced} note="of sent" />
            <Figure
              label="Marked as spam"
              value={report.complained}
              note="of delivered"
            />
          </Stack>
        </Section>

        <Divider />

        <Section title="Engagement">
          <Stack
            direction="row"
            spacing={4}
            useFlexGap
            sx={{ flexWrap: 'wrap' }}
          >
            <Figure
              label="Opens"
              value={report.opens}
              note="every open, repeats included"
            />
            <Figure
              label="Readers who opened"
              value={report.uniqueOpens}
              note="distinct recipients"
            />
            <Figure
              label="Clicks"
              value={report.clicks}
              note="every click, repeats included"
            />
            <Figure
              label="Readers who clicked"
              value={report.uniqueClicks}
              note="distinct recipients"
            />
            <Figure
              label="Unsubscribed"
              value={report.unsubscribes}
              note="through these emails' links"
            />
          </Stack>
        </Section>

        <Divider />

        <Section title="Rates">
          <Stack spacing={1}>
            <RateRow label="Delivery rate" rate={report.rates.delivery} />
            <RateRow label="Open rate" rate={report.rates.open} />
            <RateRow label="Click rate" rate={report.rates.click} />
            <RateRow
              label="Click-to-open rate"
              rate={report.rates.clickToOpen}
            />
            <RateRow label="Bounce rate" rate={report.rates.bounce} />
            <RateRow label="Complaint rate" rate={report.rates.complaint} />
            <RateRow
              label="Unsubscribe rate"
              rate={report.rates.unsubscribe}
            />
          </Stack>
        </Section>

        <Divider />

        <Section title="Who this went to">
          {report.audiences.length ? (
            <>
              <ScrollTable size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{'Audience'}</TableCell>
                    <TableCell align="right">{'Emails'}</TableCell>
                    <TableCell align="right">{'Addressed'}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.audiences.map((audience) => (
                    <TableRow key={audience.id}>
                      <TableCell>{audience.label}</TableCell>
                      <TableCell align="right">
                        {audience.campaigns.toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                        {audience.addressed.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ScrollTable>
              {/*
               * The naming rule, stated rather than left to be discovered
               * from a list whose name no longer matches the one in the
               * audiences section.
               */}
              <Typography variant="caption" color="text.secondary">
                {'Each list is named as it was when the email was sent, so ' +
                  'renaming or deleting a list does not rewrite what a past ' +
                  'send went to.'}
              </Typography>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'No email sent from this template has gone out yet.'}
            </Typography>
          )}
        </Section>

        {orderedMessages.length ? (
          <>
            <Divider />
            <Section title="Emails using this template">
              <ScrollTable size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{'Subject'}</TableCell>
                    <TableCell>{'State'}</TableCell>
                    <TableCell>{'When'}</TableCell>
                    <TableCell align="right">{'Addressed'}</TableCell>
                    <TableCell align="right">{'Opens'}</TableCell>
                    <TableCell align="right">{'Clicks'}</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {orderedMessages.map((message) => (
                    <TableRow
                      key={message.campaignId}
                      hover
                      onClick={() => router.push(messageHref(message))}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        {/*
                          The row's own handler would fire too and push the
                          same route twice — one history entry per back
                          press.
                         */}
                        <AppLink
                          href={messageHref(message)}
                          onClick={(event: {
                            stopPropagation: () => void
                          }) => event.stopPropagation()}
                        >
                          {message.subject}
                        </AppLink>
                      </TableCell>
                      <TableCell>
                        {/*
                          What the message is DOING. One delivering an
                          audience larger than one batch is written back as
                          `scheduled` between runs, so the stored status
                          reads "Scheduled" about a send already in progress.
                         */}
                        <Chip
                          size="small"
                          label={campaignSendDisplay(message as never).label}
                        />
                      </TableCell>
                      <TableCell>
                        {message.scheduledForMs
                          ? new Date(message.scheduledForMs).toLocaleString()
                          : '—'}
                      </TableCell>
                      <TableCell align="right">
                        {Number(
                          message.stats?.recipients ?? 0,
                        ).toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        {Number(message.stats?.opens ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        {Number(message.stats?.clicks ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ width: 56 }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <RowActionsMenu
                          label={String(message.subject)}
                          items={messageActions(message)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ScrollTable>
            </Section>
          </>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
EmailTemplateReportCard.displayName = 'EmailTemplateReportCard'

export default EmailTemplateReportCard
