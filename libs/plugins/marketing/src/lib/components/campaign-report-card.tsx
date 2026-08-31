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
  Box,
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
} from '@aglyn/shared-ui-email-campaigns/model/campaign-report'
import {
  campaignRevenueReport,
  type CampaignRevenueRollup,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-revenue'
import {
  campaignConversionsReport,
  type CampaignConversionsRollup,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-conversions'
/*
 * The three renderers every email report shares. Imported rather than kept
 * here, so "a rate prints its denominator" is one implementation and not a
 * convention each new card has to remember.
 */
import {
  Figure,
  MoneyFigure,
  MoneyPerMessageRow,
  percent,
  RateRow,
  Section,
} from '@aglyn/shared-ui-email-campaigns/components/report-figures'
import {
  emailSendTimeMs,
} from '@aglyn/shared-ui-email-campaigns/model/email-record'
import {
  campaignSendDisplay,
  campaignSendProgress,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-container'
import { useEmailsHubPath } from './use-emails-hub-path'

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
    'What one campaign did: delivery, opens, clicks, bounces, complaints, ' +
    'unsubscribes and the revenue it was credited with, each with the ' +
    'population it is measured against.',
})

export interface CampaignReportCardProps {
  hostId: string
  campaignId: string
  /** The marketing hub URL, for the way back to the campaigns list. */
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
 * ## What the page is about comes before how the mail did
 *
 * A campaign of one email is the ordinary shape, and this card is the page it
 * gets: the URL names a send, so there is no container above it and no list of
 * emails to draw. That collapse is honest, but it decided what the page was
 * ABOUT — delivery, engagement and rates are mechanics of a message, and a
 * page that led with them at length read as a mail report wearing the word
 * campaign.
 *
 * So the outcomes lead: what it caused, what it earned, where it sent people.
 * Two of those headings are the ones `campaign-reach-sections.tsx` puts at the
 * top of a campaign holding SEVERAL emails, and they are the same words here
 * deliberately — a merchant who opens a campaign of one and a campaign of six
 * is asking the same question and should not have to learn two vocabularies to
 * find the answer. The email's own figures follow, under a row that names the
 * message they belong to.
 *
 * Nothing about the reads changed with the order. The conversions, revenue and
 * destination figures were already on this page and already came from the four
 * documents below; they were simply underneath the mail.
 *
 * ## Three documents, whatever the campaign's size
 *
 * The whole screen is one campaign document plus one link-rollup document
 * plus one revenue-rollup document. All three are single-document listens, so
 * the cost does not move with the audience — a report over a 50,000-recipient
 * send reads the same three documents as one over ten. Aggregating the
 * per-recipient delivery log on mount would have been the obvious
 * implementation and would have read one document per recipient, every time
 * anybody opened the page; joining orders to campaigns at read time would
 * have been the same mistake one collection along, which is why the join is
 * done once at the sale and stored.
 *
 * ## No per-recipient view here, deliberately
 *
 * Every number on this screen is an aggregate that carries no address, and
 * that is what makes it three single-document reads. A per-recipient list is a
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
  // The sibling hub: the message's own page belongs to the Emails console.
  const emailsHub = useEmailsHubPath()
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
  /*
   * The revenue rollup, a third single-document listen.
   *
   * Its own document beside the link rollup rather than a field on the
   * campaign, for the reason the link rollup is: the campaign document is
   * read by the history list, the glance widget and the send path, and a map
   * that grows with the campaign's sales would enlarge every one of those
   * reads. The cost model in this file's header is unchanged in the way that
   * matters — the page still reads a fixed number of documents whatever the
   * audience, and no per-order or per-recipient read exists anywhere on it.
   */
  const { data: revenue } = useFirestoreDoc<CampaignRevenueRollup>(
    () =>
      doc(
        firestore,
        'hosts',
        hostId,
        'campaigns',
        campaignId,
        'reports',
        'revenue',
      ),
    [firestore, hostId, campaignId],
  )

  /*
   * The conversions rollup, a fourth single-document listen.
   *
   * Beside `reports/revenue` and read the same way, because it is the same
   * join answering the other half of the question: revenue is what a campaign
   * EARNED from people who named themselves at checkout, and this is what it
   * CAUSED among people who were anonymous until the moment they submitted,
   * signed up or booked. The cost model in this file's header is unchanged in
   * the way that matters — a fixed number of documents whatever the audience,
   * and no per-conversion read anywhere on the page.
   */
  const { data: conversions } = useFirestoreDoc<CampaignConversionsRollup>(
    () =>
      doc(
        firestore,
        'hosts',
        hostId,
        'campaigns',
        campaignId,
        'reports',
        'conversions',
      ),
    [firestore, hostId, campaignId],
  )

  const report = campaignReport(campaign?.stats)
  const linkReport = campaignLinkReport(links)
  const revenueReport = campaignRevenueReport({
    rollup: revenue,
    /*
     * The DENOMINATOR, handed over from the same document read at the same
     * instant rather than re-read here. `report.delivered` is `null` when no
     * delivery event was ever recorded, and it is passed as `null` so the
     * revenue figures over it are withheld for exactly the reason every other
     * rate over it is.
     */
    delivered: report.delivered,
    midFlight: campaign
      ? campaignSendProgress(campaign as never).state === 'sending'
      : false,
  })
  /*
   * No denominator is handed in, unlike the revenue report. A conversion RATE
   * over delivered messages would repeat the defect the revenue section
   * refuses for orders — one visitor can submit two forms, so the quotient
   * passes 100% without anything being wrong — and counting distinct people
   * instead needs a document per person per campaign, which is the
   * per-recipient read this screen's cost model exists to refuse.
   */
  const conversionsReport = campaignConversionsReport({ rollup: conversions })
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
          * WHAT THIS CAMPAIGN CAUSED — the page's first section, and the
          * heading a campaign of several emails leads with too.
          *
          * The same join as the revenue below, credited under the same rule,
          * answering it for people who were anonymous until the moment being
          * counted: they arrived from a campaign link, browsed, and only
          * became somebody when they submitted a form, signed up or booked.
          *
          * THE FOUR FIGURES ARE NEVER ADDED. One person filling in one form
          * writes a submission, a contact and a lead, so a total would count
          * that visit three times — and it would look like a bigger version
          * of a real number, which is why the model carries no total for this
          * JSX to reach for and the caveat says so in words above them.
          *
          * They are laid out in a row of independent `Figure`s rather than in
          * a table with a footer, because a footer row is where a reader
          * expects the sum to be.
          *=========================================*/}
        <Section title="What it caused">
          {conversionsReport.caveats.map((caveat) => (
            <Alert key={caveat.id} severity="info">
              {caveat.message}
            </Alert>
          ))}
          {conversionsReport.any ? (
            <Stack spacing={1}>
              <Stack
                direction="row"
                spacing={4}
                useFlexGap
                sx={{ flexWrap: 'wrap' }}
              >
                {conversionsReport.kinds.map((entry) => (
                  <Figure
                    key={entry.kind}
                    label={entry.label}
                    value={entry.value}
                    note={entry.note}
                  />
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {`Credited ${conversionsReport.model === 'last-click' ? 'to the last campaign whose link the visitor clicked' : `under the ${conversionsReport.model} model`}, ` +
                  `within ${conversionsReport.windowDays} days of that click. ` +
                  'Somebody who converted without ever following a campaign ' +
                  'link is credited to no campaign at all — nothing is ' +
                  'inferred from a referrer — so these are a floor rather ' +
                  'than everything this campaign influenced. The ones ' +
                  'credited to nobody are counted under Conversions in the ' +
                  'marketing console.'}
              </Typography>
              {/*
                THE RECORDS BEHIND THE FIGURES. The rollup says how many; the
                list says which, and it is the only place the uncredited half
                is counted. A link rather than a table here — the records are
                a paged read and this page's whole cost model is a fixed
                number of documents whatever the audience.
               */}
              <Box>
                <Button
                  component={AppLink as any}
                  {...({
                    componentVariant: 'naked',
                    nativeButton: false,
                  } as any)}
                  href={`${basePath}/conversions/${campaignId}`}
                  size="small"
                  color="primary"
                >
                  {'See these conversions'}
                </Button>
              </Box>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {conversionsReport.recorded
                ? 'Nothing has been credited to this campaign yet.'
                : 'No conversions have been attributed to this campaign. A ' +
                  'form submission, lead, contact or booking is credited to ' +
                  'the last campaign whose link the visitor clicked, within ' +
                  `${conversionsReport.windowDays} days — a campaign sent ` +
                  'before that was recorded will never show a figure here.'}
            </Typography>
          )}
        </Section>

        <Divider />

        {/*==========================================
          * WHAT THIS CAMPAIGN EARNED.
          *
          * The merchant's second question, and the one every compared
          * product answers by reconstructing revenue probabilistically
          * because it does not own the order. Here it is a join: the click
          * and the order are rows in one database, so there is no tracking
          * script, no catalog sync and nothing estimated except the model.
          *
          * THE MODEL IS ON SCREEN, in a sentence, above the money. A revenue
          * figure whose rule the reader cannot state is worse than no
          * figure, because they will use it anyway — and the two things they
          * have to know to use it are which campaign gets the credit when
          * several touched the buyer, and how long a click stays creditable.
          *
          * NET LEADS. Gross and refunded are both shown beside it, because
          * "this campaign made $4,000" and "this campaign made $4,000 of
          * which $3,100 came back" are different facts about whether to send
          * another one.
          *=========================================*/}
        <Section title="Revenue">
          {revenueReport.caveats.map((caveat) => (
            <Alert key={caveat.id} severity="info">
              {caveat.message}
            </Alert>
          ))}
          {revenueReport.currencies.length ? (
            <Stack spacing={3}>
              {revenueReport.currencies.map((entry) => (
                <Stack key={entry.currency} spacing={1}>
                  {/*
                   * The currency is a HEADING when there is more than one,
                   * and absent when there is one. A per-currency label on a
                   * report that only ever shows dollars is noise; the moment
                   * there are two, the reader has to be able to see at a
                   * glance that the blocks are not addable — which is also
                   * what the caveat above says in words.
                   */}
                  {revenueReport.multiCurrency ? (
                    <Typography variant="subtitle2">
                      {entry.currency.toUpperCase()}
                    </Typography>
                  ) : null}
                  <Stack
                    direction="row"
                    spacing={4}
                    useFlexGap
                    sx={{ flexWrap: 'wrap' }}
                  >
                    <MoneyFigure
                      label="Net revenue"
                      cents={entry.netCents}
                      currency={entry.currency}
                      note="after refunds"
                    />
                    <MoneyFigure
                      label="Gross revenue"
                      cents={entry.grossCents}
                      currency={entry.currency}
                      note="as charged"
                    />
                    <MoneyFigure
                      label="Refunded"
                      cents={entry.refundedCents}
                      currency={entry.currency}
                      note="handed back"
                    />
                    <Figure
                      label="Orders"
                      value={entry.orders}
                      note="credited to this campaign"
                    />
                    <Figure
                      label="Fully refunded"
                      value={entry.refundedOrders}
                      note="of those orders"
                    />
                  </Stack>
                  <MoneyPerMessageRow
                    label="Net revenue per delivered message"
                    figure={entry.netPerDelivered}
                  />
                </Stack>
              ))}
              {/*
               * NO CONVERSION RATE, and this is where a reader would look
               * for one. Orders over delivered is not a rate: one buyer can
               * place two orders, so the quotient passes 100% without
               * anything being wrong — the same defect that keeps `opens`
               * out of the open-rate numerator two sections above. Counting
               * distinct buyers instead would need a document per person per
               * campaign, which is the per-recipient read this screen's cost
               * model exists to refuse. The order count is shown as a count.
               */}
              <Typography variant="caption" color="text.secondary">
                {`Credited ${revenueReport.model === 'last-click' ? 'to the last campaign whose link the buyer clicked' : `under the ${revenueReport.model} model`}, ` +
                  `within ${revenueReport.windowDays} days of that click. ` +
                  'Clicks only — an open is not treated as evidence that ' +
                  'anybody read the email. An order placed by somebody who ' +
                  'never clicked, or who checked out without giving an ' +
                  'address, is credited to no campaign, so this is a floor ' +
                  'rather than every sale this campaign influenced.'}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {revenueReport.recorded
                ? 'No orders have been credited to this campaign.'
                : 'No revenue has been attributed to this campaign. Orders ' +
                  'are credited to the last campaign whose link the buyer ' +
                  `clicked, within ${revenueReport.windowDays} days — a ` +
                  'campaign sent before that was recorded, or one on a site ' +
                  'with no store, will never show a figure here.'}
            </Typography>
          )}
        </Section>

        <Divider />

        <Section title="Where it sent people">
          {/*
            The heading a campaign of several emails carries over the same
            question, so the two shapes of campaign page read alike. A
            campaign owns no page — this is where its mail was actually
            followed to, which is the only account of it the data holds.
           */}
          <Typography variant="body2" color="text.secondary">
            {'The pages this campaign’s links were followed to.'}
          </Typography>
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

        <Divider />

        {/*==========================================
          * THE EMAIL THE FIGURES BELOW CAME FROM — and the hinge between the
          * two halves of this page.
          *
          * This screen is reached at `/marketing/campaigns/{sendId}`, which
          * is a CAMPAIGN url resolving to a send — the fall-through that keeps
          * every unsubscribe footer and every pasted report link working. So
          * a reader arrives from the campaigns table, where the row carries a
          * "Single send" chip, and everything under this row is a fact about
          * a message rather than about the campaign.
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
              {/*
                The MESSAGE's own page, which the Emails console owns — hence
                the sibling hub rather than this surface's `basePath`. Plain
                text until that hub resolves: a link with no destination is
                worse than none, and the subject is what the reader came for
                either way.
               */}
              {emailsHub ? (
                <AppLink href={`${emailsHub}/messages/${campaignId}`}>
                  {subject}
                </AppLink>
              ) : (
                <Typography variant="body2">{subject}</Typography>
              )}
              {/*
                What the email is DOING, not the field it stores. One
                delivering an audience larger than one batch is written back
                as `scheduled` between runs, so a chip rendering the status
                said "Scheduled" at the head of a report of five hundred
                deliveries.
               */}
              <Chip
                size="small"
                label={campaignSendDisplay(campaign as never).label}
              />
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
              {'This campaign is one email, so the sections above are what ' +
                'that one email caused. What follows is the mail itself — ' +
                'how it was delivered and how it was read. Open the message ' +
                'for its body and the people it reached.'}
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
      </Stack>
    </CardDisplay>
  )
}
CampaignReportCard.displayName = 'CampaignReportCard'

export default CampaignReportCard
