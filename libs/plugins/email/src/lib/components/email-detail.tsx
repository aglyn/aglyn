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
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { doc } from 'firebase/firestore'
import { useMemo } from 'react'
import {
  campaignLinkReport,
  campaignReport,
  type CampaignLinkRollup,
  type CampaignStats,
} from '../model/campaign-report'
import { CAMPAIGN_SEND_CONTAINER_FIELD } from '../model/campaign-container'
import {
  emailAudienceLabel,
  emailSendTimeMs,
  emailStateLabel,
} from '../model/email-record'
import EmailDesignPreview from './email-design-preview'
import EmailRecipientsCard from './email-recipients-card'
import { Figure, percent, RateRow, Section } from './report-figures'

const emailDocsHelp = pluginDocsHelp('emailCampaigns', {
  anchor: '#the-campaign-report',
  excerpt:
    'One email: what it looked like, who it went to, what was delivered, ' +
    'and which links were followed — each rate over the population it is ' +
    'measured against.',
})

export interface EmailDetailProps {
  hostId: string
  /** The message document under `hosts/{hostId}/campaigns`. */
  emailId: string
  /** The emails hub URL, for the way back and for sibling links. */
  basePath: string
}

/**
 * ONE MESSAGE: what it looked like, where it went, and what it did.
 *
 * ## The template it was built from, drawn as it stands NOW
 *
 * The preview renders the template's CURRENT version, because the HTML that
 * was actually mailed is not stored — it is rendered per recipient at send
 * time, with that recipient's merge values in it, and keeping a copy per
 * message would be a copy of the whole email per address. So a message sent
 * before its template was last edited previews as the template is today, and
 * the frame says so rather than letting a reader take it for a record of what
 * went out.
 *
 * ## Every rate names its denominator
 *
 * The arithmetic is `campaign-report.ts` — the same pure module the campaign
 * report reads — so open rate over `delivered` and click rate over `delivered`
 * are computed once, carry their own denominator labels, and come back `null`
 * rather than 0% when they cannot honestly be taken. Nothing on this screen
 * divides anything.
 *
 * ## What this page reads
 *
 * Four documents: the message, its link rollup, the template screen and the
 * template's version. None of them grows with the size of the send. The
 * recipient list is the one read that does, and it is its own card with its
 * own request.
 */
export function EmailDetail(props: EmailDetailProps) {
  const { hostId, emailId, basePath } = props
  const firestore = useFirestore()

  const { data: email, status } = useFirestoreDoc<
    Record<string, any> & { stats?: CampaignStats }
  >(
    () => doc(firestore, 'hosts', hostId, 'campaigns', emailId),
    [firestore, hostId, emailId],
  )
  const notFound = status !== 'loading' && !email

  /*
   * The link rollup, its own document rather than a field on the message.
   *
   * A map of destinations grows with the content, and the message document is
   * read by the list, the glance widget and the send path; putting an
   * unbounded map on it would make every one of those reads larger.
   */
  const { data: links } = useFirestoreDoc<CampaignLinkRollup>(
    () =>
      doc(firestore, 'hosts', hostId, 'campaigns', emailId, 'reports', 'links'),
    [firestore, hostId, emailId],
  )

  const templateScreenId: string | undefined = email?.templateScreenId
  const { data: template } = useFirestoreDoc<any>(
    () =>
      templateScreenId
        ? doc(firestore, 'hosts', hostId, 'screens', templateScreenId)
        : null,
    [firestore, hostId, templateScreenId],
  )
  const templateVersionId: string | undefined = template?.versionId
  const { data: templateVersion } = useFirestoreDoc<any>(
    () =>
      templateScreenId && templateVersionId
        ? doc(
            firestore,
            'hosts',
            hostId,
            'screens',
            templateScreenId,
            'versions',
            templateVersionId,
          )
        : null,
    [firestore, hostId, templateScreenId, templateVersionId],
  )

  const report = useMemo(() => campaignReport(email?.stats), [email])
  const linkReport = useMemo(() => campaignLinkReport(links), [links])
  const subject = String(email?.subject || 'Untitled email')
  /*
   * The composed body, kept on the send document. A message written without
   * a template still has a rendered HTML part in the inbox, so this is what
   * the preview draws for one.
   */
  const composedBody = String(email?.body ?? '')
  const sendTimeMs = email ? emailSendTimeMs(email) : 0
  const state = String(email?.status ?? '')

  /*
   * The campaign this message belongs to.
   *
   * `emailCampaignId` — {@link CAMPAIGN_SEND_CONTAINER_FIELD} — is the one
   * linkage, and it is deliberately not spelled `campaignId`: on a message
   * document that name already means the message's OWN id, which is what the
   * report route addresses and what every delivered unsubscribe footer
   * carries as `cid=`.
   *
   * The fallback is the migration. A message written before campaigns grouped
   * anything names no container, and its own id IS the campaign the URL
   * resolves — the campaign detail route answers an id it does not recognize
   * as a container with that message's own report.
   */
  const campaignId = String(email?.[CAMPAIGN_SEND_CONTAINER_FIELD] ?? emailId)

  const headerActions = (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Button
        component={AppLink as any}
        {...({ componentVariant: 'naked', nativeButton: false } as any)}
        href={`${basePath}/emails`}
        size="small"
        color="primary"
      >
        {'All emails'}
      </Button>
      {templateScreenId ? (
        <Button
          component={AppLink as any}
          {...({ componentVariant: 'naked', nativeButton: false } as any)}
          href={`${basePath}/templates/${templateScreenId}`}
          size="small"
          variant="contained"
        >
          {'Open template'}
        </Button>
      ) : null}
    </Stack>
  )

  if (notFound) {
    return (
      <CardDisplay
        header={'Email'}
        help={emailDocsHelp}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: headerActions }}
      >
        {/*
         * Not "no data". An email that cannot be read is a different
         * situation from one with no engagement, and rendering an empty
         * report for the first is how somebody comes to believe a message
         * they sent reached nobody.
         */}
        <Typography variant="body2" color="text.secondary">
          {'This email could not be loaded. It may have been deleted.'}
        </Typography>
      </CardDisplay>
    )
  }

  return (
    <Stack spacing={3}>
      <CardDisplay
        header={subject}
        subheader={'Email'}
        help={emailDocsHelp}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: headerActions }}
      >
        <Stack spacing={3}>
          {report.caveats.map((caveat) => (
            <Alert key={caveat.id} severity="info">
              {caveat.message}
            </Alert>
          ))}

          <Divider />

          <Section title="Where this went">
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>{'State'}</TableCell>
                  <TableCell align="right">
                    <Chip size="small" label={emailStateLabel(state)} />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    {state === 'sent' ? 'Sent' : 'Scheduled for'}
                  </TableCell>
                  <TableCell align="right">
                    {sendTimeMs
                      ? new Date(sendTimeMs).toLocaleString()
                      : 'not recorded'}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{'Campaign'}</TableCell>
                  <TableCell align="right">
                    <AppLink href={`${basePath}/campaigns/${campaignId}`}>
                      {'Open the campaign'}
                    </AppLink>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{'List'}</TableCell>
                  <TableCell align="right">
                    {emailAudienceLabel(email)}
                  </TableCell>
                </TableRow>
                {templateScreenId ? (
                  <TableRow>
                    <TableCell>{'Template'}</TableCell>
                    <TableCell align="right">
                      <AppLink
                        href={`${basePath}/templates/${templateScreenId}`}
                      >
                        {template?.displayName ?? 'Untitled template'}
                      </AppLink>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
            {/*
             * The list is named as the SEND recorded it, and saying so is
             * what stops a renamed or deleted list quietly rewriting the
             * history of a message that went out months ago.
             */}
            <Typography variant="caption" color="text.secondary">
              {'The list is named as it was when this email was sent.'}
            </Typography>
          </Section>

          <Divider />

          <Section title="Delivery">
            <Stack
              direction="row"
              spacing={4}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              <Figure
                label="Addressed"
                value={report.recipients}
                note="after the per-send cap"
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
                note="through this email's link"
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

          {report.populations.length ? (
            <>
              <Divider />
              <Section title="Who this was allowed to reach">
                <Typography variant="body2" color="text.secondary">
                  {'Measured when this email was sent, and stored as it was ' +
                    'then. These figures describe the send, not the audience ' +
                    'as it stands today.'}
                </Typography>
                <Table size="small">
                  <TableBody>
                    {report.populations.map((population) => (
                      <TableRow key={population.id}>
                        <TableCell>{population.label}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                          {population.count.toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="caption" color="text.secondary">
                            {`of ${population.of.toLocaleString()} ${population.ofLabel}`}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Section>
            </>
          ) : null}

          <Divider />

          <Section title="Links">
            {linkReport.rows.length ? (
              <>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Destination'}</TableCell>
                      <TableCell align="right">{'Clicks'}</TableCell>
                      <TableCell align="right">{'Share'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {linkReport.rows.map((row) => (
                      <TableRow key={row.url}>
                        <TableCell sx={{ wordBreak: 'break-all' }}>
                          {row.url}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                          {row.clicks.toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          {row.share
                            ? `${percent(row.share.value)} of ${row.share.denominator.toLocaleString()} ${row.share.denominatorLabel}`
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Typography variant="caption" color="text.secondary">
                  {'Counted by address and path — query strings are dropped, ' +
                    'so two links to the same page with different tracking ' +
                    'parameters count as one row.'}
                </Typography>
                {linkReport.unattributedClicks ? (
                  <Typography variant="caption" color="text.secondary">
                    {`${linkReport.unattributedClicks.toLocaleString()} clicks ` +
                      'arrived without a destination and are not in this table.'}
                  </Typography>
                ) : null}
                {linkReport.overflowClicks ? (
                  <Alert severity="info">
                    {'This email has more distinct destinations than the ' +
                      `rollup keeps. ${linkReport.overflowClicks.toLocaleString()} ` +
                      'clicks landed on links past that limit and are counted ' +
                      'in the click total above but not in this table.'}
                  </Alert>
                ) : null}
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {report.clicks
                  ? 'Clicks were recorded for this email, but none of them ' +
                    'carried a destination, so there is nothing to break down ' +
                    'by link.'
                  : 'No link clicks have been recorded for this email.'}
              </Typography>
            )}
          </Section>
        </Stack>
      </CardDisplay>

      <EmailRecipientsCard hostId={hostId} emailId={emailId} />

      {/*
       * Last, and its own card. The numbers are what a reader came for and
       * the preview is the tallest thing on the page — above them it pushes
       * every figure below the fold.
       */}
      <CardDisplay title="Preview">
        {templateScreenId ? (
          <EmailDesignPreview
            hostId={hostId}
            nodes={templateVersion?.nodes}
            loading={template === undefined || templateVersion === undefined}
            subject={subject}
            preheader={String(template?.emailPreheader ?? '')}
            emptyMessage={
              'The template this email was built from is empty or has ' +
              'been deleted, so there is nothing to draw.'
            }
            note={
              'The template as it stands today. The mail itself is ' +
              'rendered per recipient at send time and not kept, so a ' +
              'template edited since this went out previews as it is now.'
            }
          />
        ) : (
          <EmailDesignPreview
            hostId={hostId}
            nodes={undefined}
            text={composedBody}
            loading={email === undefined}
            subject={subject}
            emptyMessage={
              'This email carries no body, so there is nothing to draw.'
            }
            note={
              'Written as plain text in the composer. Merge tokens are ' +
              'left standing here — the mail itself resolves them per ' +
              'recipient at send time and is not kept.'
            }
          />
        )}
      </CardDisplay>
    </Stack>
  )
}
EmailDetail.displayName = 'EmailDetail'

export default EmailDetail
