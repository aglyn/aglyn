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
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import {
  campaignLinkReport,
  campaignReport,
  type CampaignLinkRollup,
  type CampaignStats,
} from '../model/campaign-report'
/*
 * The three renderers every email report shares. Imported rather than kept
 * here, so "a rate prints its denominator" is one implementation and not a
 * convention each new card has to remember.
 */
import { Figure, percent, RateRow, Section } from './report-figures'
import { emailSendTimeMs, emailStateLabel } from '../model/email-record'

/**
 * The help affordance, hoisted so BOTH headers carry it.
 *
 * The unreadable-campaign branch below renders its own `CardDisplay`, and a
 * header without help is a header a reader has no way out of — which is
 * exactly the state that branch describes.
 */
const reportDocsHelp = pluginDocsHelp('emailCampaigns', {
  anchor: '#the-campaign-report',
  excerpt:
    'What one campaign did: delivery, opens, clicks, bounces, complaints ' +
    'and unsubscribes, each with the population it is measured against.',
})

export interface CampaignReportCardProps {
  hostId: string
  campaignId: string
  /** The emails hub URL, for the way back to the campaigns list. */
  basePath: string
}

/**
 * ONE CAMPAIGN, MEASURED — and every denominator on screen.
 *
 * ## What was missing
 *
 * Opens and clicks have been recorded on the campaign document since AGL-268
 * and displayed as two words in a history row: `12 opens · 3 clicks`. Nothing
 * anywhere showed a rate, a delivery count, a bounce, a complaint or an
 * unsubscribe, and the populations the send itself measured — how large the
 * audience was, how many the consent rule refused, how many were already
 * suppressed — were computed on every send and written nowhere.
 *
 * ## The rule this screen is built around
 *
 * **Every rate names its denominator, in the same breath as the number.**
 *
 * That is not decoration. An open rate over `sent` and an open rate over
 * `delivered` are different numbers that share a label, and the difference
 * between them is exactly the mail that bounced — so a report that showed one
 * while the reader assumed the other would be wrong by however bad the
 * address list is, which is the case where being wrong matters most. Worse,
 * "click rate" is used in the wild for two unrelated quantities — clicks over
 * delivered, and clicks over openers — and they differ by a factor of three
 * or four on ordinary mail.
 *
 * So the arithmetic is not done here at all. `campaign-report.ts` returns
 * each rate as a triple carrying `denominatorLabel`, this file renders that
 * label, and a rate whose denominator is zero or unrecorded comes back `null`
 * and is drawn as "—" with a caveat naming the reason. There is no path
 * through this component that prints a percentage without saying what it is a
 * percentage of.
 *
 * ## Two documents, whatever the campaign's size
 *
 * The whole screen is one campaign document plus one link-rollup document.
 * Both are single-document listens, so the cost does not move with the
 * audience — a report over a 50,000-recipient send reads the same two
 * documents as one over ten. Aggregating the per-recipient delivery log on
 * mount would have been the obvious implementation and would have read one
 * document per recipient, every time anybody opened the page.
 *
 * ## No per-recipient view here, deliberately
 *
 * Every number on this screen is an aggregate that carries no address, and
 * that is what makes it two single-document reads. A per-recipient list is a
 * different read and a different question, so it lives where it is asked:
 * the design report's recipients table, which resolves the campaigns from the
 * design on a server that has already checked the reader's site role, and
 * returns only rows tagged with that site.
 *
 * The other per-recipient view — the staff delivery log on the user detail
 * page — spans every site on the install and is behind a staff claim that
 * records who looked. Neither reaches this card: adding a recipient list here
 * would put an unbounded read behind a widget whose whole cost model is that
 * it has none.
 */
export function CampaignReportCard(props: CampaignReportCardProps) {
  const { hostId, campaignId, basePath } = props
  const firestore = useFirestore()

  const { data: campaign } = useFirestoreDoc<
    Record<string, unknown> & { stats?: CampaignStats }
  >(
    () => doc(firestore, 'hosts', hostId, 'campaigns', campaignId),
    [firestore, hostId, campaignId],
  )
  /*
   * The link rollup, its own document rather than a field on the campaign.
   *
   * A map of destinations grows with the campaign's content and a campaign
   * document is read by the history list, the glance widget and the send
   * path; putting an unbounded map on it would make every one of those reads
   * larger. Split, the rollup is read by exactly the screen that renders it.
   */
  const { data: links } = useFirestoreDoc<CampaignLinkRollup>(
    () => doc(firestore, 'hosts', hostId, 'campaigns', campaignId, 'reports', 'links'),
    [firestore, hostId, campaignId],
  )

  const report = campaignReport(campaign?.stats)
  const linkReport = campaignLinkReport(links)
  const subject = String(campaign?.subject ?? 'Campaign')
  const sendTimeMs = campaign ? emailSendTimeMs(campaign) : 0

  const backButton = (
    <Button
      component={AppLink as any}
      {...({ componentVariant: 'naked', nativeButton: false } as any)}
      href={`${basePath}/campaigns`}
      size="small"
      color="primary"
    >
      {'All campaigns'}
    </Button>
  )

  if (!campaign) {
    return (
      <CardDisplay
        header={'Campaign report'}
        help={reportDocsHelp}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: backButton }}
      >
        {/*
         * Not "no data". A campaign that cannot be read is a different
         * situation from one with no engagement, and rendering an empty
         * report for the first is how somebody comes to believe a campaign
         * they sent reached nobody.
         */}
        <Typography variant="body2" color="text.secondary">
          {'This campaign could not be loaded. It may have been deleted.'}
        </Typography>
      </CardDisplay>
    )
  }

  return (
    <CardDisplay
      header={subject}
      subheader={'Campaign report'}
      help={reportDocsHelp}
      contentGutterX
      contentGutterY
      HeaderProps={{ action: backButton }}
    >
      <Stack spacing={3}>
        {report.caveats.map((caveat) => (
          <Alert key={caveat.id} severity="info">
            {caveat.message}
          </Alert>
        ))}

        {/*==========================================
          * THE EMAIL THESE FIGURES CAME FROM.
          *
          * This screen is reached at `/emails/campaigns/{sendId}`, which is a
          * CAMPAIGN url resolving to a send — the fall-through that keeps
          * every unsubscribe footer and every pasted report link working. So
          * a reader arrives from the campaigns table, where the row carries a
          * "Single send" chip, and lands on a page of delivery and engagement
          * figures with nothing on it naming what was delivered.
          *
          * Figures with no visible source read as a campaign holding no
          * emails while reporting real numbers, which is a contradiction
          * rather than a shortage of detail. Naming the one email — and
          * saying it IS the campaign, which is what the chip already claims
          * and what `campaignListRows` already does at read time — is what
          * makes the page answer the question it raises.
          *
          * One row, from the document this card already read: no query, no
          * second listen, and the two-document cost the header describes is
          * unchanged.
          *=========================================*/}
        <Section title="The email in this campaign">
          <Stack spacing={1}>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <AppLink href={`${basePath}/emails/${campaignId}`}>
                {subject}
              </AppLink>
              <Chip size="small" label={emailStateLabel(campaign.status)} />
              <Chip
                size="small"
                variant="outlined"
                label="Single send"
                title={
                  'One email, sent on its own rather than as part of a ' +
                  'campaign of several. Its report and its unsubscribe links ' +
                  'are unchanged.'
                }
              />
              <Typography variant="caption" color="text.secondary">
                {sendTimeMs
                  ? new Date(sendTimeMs).toLocaleString()
                  : 'not recorded'}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {'This campaign is one email. Everything below is that ' +
                'email — open it for the message itself, the links it ' +
                'carried and the people it reached.'}
            </Typography>
          </Stack>
        </Section>

        <Divider />

        {/*==========================================
          * WHAT HAPPENED TO THE MAIL.
          *
          * Counts first and rates second, in that order and not the other
          * way round, because a rate is only readable once you know what it
          * was taken over — and because the counts are the part that is
          * always true. Every rate below can be absent; none of these can.
          *=========================================*/}
        <Section title="Delivery">
          <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: 'wrap' }}>
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
          {/*
           * BOTH the event count and the distinct count, side by side.
           *
           * `Opens` is every open event — one reader opening four times is
           * four — and it is the number this product has always shown. It
           * cannot be a rate numerator: divided by anything it exceeds 100%
           * the moment somebody reads an email twice. `Readers who opened`
           * is the distinct count, and it is what the rate below divides.
           * Showing only one of them would either hide activity or invite a
           * rate nobody can defend, so both are here with different names.
           */}
          <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: 'wrap' }}>
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
              note="through this campaign's link"
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
            <Section title="Who this went to">
              {/*
               * The populations the SEND measured, recorded at send time.
               *
               * Not recomputed here, and the note under the heading says so:
               * consent records change and addresses get suppressed, so
               * asking the list today produces a number that is true of the
               * list and false of the campaign.
               */}
              <Typography variant="body2" color="text.secondary">
                {'Measured when this campaign was sent, and stored as it was ' +
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
              {/*
               * The normalisation, stated rather than left for somebody to
               * discover from a total that does not add up. Two links to the
               * same page distinguished only by their UTM tags are one row
               * here, and a merchant comparing this table with the campaign
               * they built has to be told that before they conclude a link
               * is missing.
               */}
              <Typography variant="caption" color="text.secondary">
                {'Counted by address and path — query strings are dropped, so ' +
                  'two links to the same page with different tracking ' +
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
                  {`This campaign has more distinct destinations than the ` +
                    `rollup keeps. ${linkReport.overflowClicks.toLocaleString()} ` +
                    'clicks landed on links past that limit and are counted ' +
                    'in the click total above but not in this table.'}
                </Alert>
              ) : null}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {report.clicks
                ? 'Clicks were recorded for this campaign, but none of them ' +
                  'carried a destination, so there is nothing to break down ' +
                  'by link.'
                : 'No link clicks have been recorded for this campaign.'}
            </Typography>
          )}
        </Section>
      </Stack>
    </CardDisplay>
  )
}
CampaignReportCard.displayName = 'CampaignReportCard'

export default CampaignReportCard
