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

import { mdiEyeOutline, mdiPaletteOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { Figure, RateRow, Section } from './report-figures'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { ceilingedWindow } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { pluginDocsHelp } from '@aglyn/aglyn'
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
import {
  collection,
  doc,
  documentId,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useOrgDataScope,
} from '@aglyn/tenant-feature-instance'
import {
  campaignRollup,
  campaignSendAtMs,
  campaignWindowState,
  type CampaignAggregate,
  type CampaignSend,
  type EmailCampaign,
} from '../model'
import CampaignComposer from './campaign-composer'
import CampaignReportCard from './campaign-report-card'

/** How many of a campaign's emails the detail page enumerates. */
const CAMPAIGN_EMAIL_CEILING = 50

const detailDocsHelp = pluginDocsHelp('emailCampaigns', {
  anchor: '#the-campaign-report',
  excerpt:
    'A campaign groups the emails sent to its lists. The figures here are ' +
    'the sum across those emails, and each one keeps its own report.',
})

/**
 * A rolled-up figure, in the shared `Figure`'s shape.
 *
 * The note is where an aggregate differs from a single send's count: a total
 * measured over fewer emails than the campaign holds says which part of the
 * campaign it describes, rather than presenting a partial sum as a complete
 * one. `null` still renders as an em dash and says "not recorded", which is
 * the property the shared component already owns.
 */
const rolled = (
  value: CampaignAggregate,
): { value: number | null; note: string } => ({
  value: value.value,
  note:
    value.value !== null && value.recorded < value.sends
      ? `across ${value.recorded} of ${value.sends} emails`
      : `across ${value.sends} email${value.sends === 1 ? '' : 's'}`,
})

export interface CampaignDetailCardProps {
  hostId: string
  /** A campaign container id, or a send id from before containers existed. */
  campaignId: string
  /** The emails hub URL, for the way back to the campaigns list. */
  basePath: string
}

/**
 * ONE CAMPAIGN: its lists, its emails, and the sum of what they did.
 *
 * ## Why this resolves two kinds of id
 *
 * `/emails/campaigns/{id}` was the report for a single SEND before a campaign
 * became a container, and those URLs are linkable by design — a merchant
 * pastes one into a message about last week's send. So the id in the path may
 * name either thing, and it is answered by reading: a container at
 * `emailCampaigns/{id}` renders this page, and anything else falls through to
 * the send's own report, unchanged.
 *
 * That fallback is what makes the container additive. No send document was
 * rewritten and no id was reassigned, which also means every unsubscribe link
 * already sitting in an inbox — each carrying `cid={sendId}` inside its own
 * signature — resolves exactly as it did.
 *
 * The extra read is one document, and it buys the guarantee that no existing
 * link breaks.
 */
export function CampaignDetailCard(props: CampaignDetailCardProps) {
  const { hostId, campaignId, basePath } = props
  const firestore = useFirestore()
  const router = useRouter()
  const { scope: dataScope } = useOrgDataScope({ hostId })
  const [composing, setComposing] = useState(false)

  const { data: campaign, status } = useFirestoreDoc<EmailCampaign>(
    () => doc(firestore, 'hosts', hostId, 'emailCampaigns', campaignId),
    [firestore, hostId, campaignId],
  )

  /*
   * ONLY WHEN THE ID NAMES A CAMPAIGN.
   *
   * Both queries below are gated on the container having been found, because
   * the other half of this component is the single-send report — and that
   * screen's whole design is that it reads two documents whatever the size of
   * the audience. Listening unconditionally would add two collection reads to
   * every legacy report URL, which is the cost the report route was split out
   * to avoid. Not listening is what a null builder means.
   *
   * The campaign's emails come back by the field each send carries: equality
   * on one field ordered by DOCUMENT NAME, which Firestore's automatic
   * single-field index serves without a composite one. Ordering on a date
   * would need that index AND would drop every send missing that particular
   * date — a sent send carries `sentAt`, a scheduled one `sendAtMs`, and
   * neither is on both. Sorted by date below, over a window this page holds
   * whole.
   *
   * One document past the ceiling, so "this campaign has more emails than are
   * listed" is a fact rather than a guess.
   */
  const { data: sendDocs } = useFirestoreCollection<any>(
    () =>
      campaign
        ? query(
            collection(firestore, 'hosts', hostId, 'campaigns'),
            where('emailCampaignId', '==', campaignId),
            orderBy(documentId()),
            limit(CAMPAIGN_EMAIL_CEILING + 1),
          )
        : null,
    [firestore, hostId, campaignId, Boolean(campaign)],
    { idField: '$id' },
  )

  const { data: listDocs } = useFirestoreCollection<any>(
    () =>
      campaign && dataScope
        ? query(
            collection(firestore, dataScope[0], dataScope[1], 'lists'),
            limit(50),
          )
        : null,
    [firestore, dataScope, Boolean(campaign)],
    { idField: '$id' },
  )

  const { rows: readSends, truncated: sendsTruncated } = ceilingedWindow<any>(
    sendDocs,
    CAMPAIGN_EMAIL_CEILING,
  )
  const sends = useMemo(
    () =>
      [...(readSends as CampaignSend[])].sort(
        (a, b) => (campaignSendAtMs(b) ?? 0) - (campaignSendAtMs(a) ?? 0),
      ),
    [readSends],
  )
  const rollup = useMemo(() => campaignRollup(sends), [sends])
  // The page is a SLICE of a window the card already holds.
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visibleSends = useMemo(
    () => sends.slice(page * pageSize, page * pageSize + pageSize),
    [sends, page, pageSize],
  )

  // Still settling. Falling through to the send report here would flash "this
  // campaign could not be loaded" on every open of a campaign that exists.
  if (!campaign && status === 'loading') return null

  /*
   * NOT A CONTAINER — so it is a send id, and the send's own report is what
   * this URL has always meant.
   */
  if (!campaign) {
    return (
      <CampaignReportCard
        hostId={hostId}
        campaignId={campaignId}
        basePath={basePath}
      />
    )
  }

  const listIds = campaign.listIds ?? []
  const names = new Map<string, string>(
    (listDocs ?? []).map((list: any) => [
      String(list.$id),
      String(list.name ?? list.$id),
    ]),
  )
  /*
   * One email's report.
   *
   * `campaigns/{sendId}` and not `emails/{sendId}`: this URL was the report
   * for a single send before a campaign became a container, links to it are
   * sitting in messages merchants sent each other, and the campaign detail
   * route answers an id it does not recognize as a container with that send's
   * own report. Changing the destination here would be changing which page a
   * link that already exists resolves to.
   */
  const sendHref = (send: CampaignSend) =>
    `${basePath}/campaigns/${send.$id}`

  /**
   * What one of this campaign's emails can be opened into.
   *
   * The same two the Emails tab offers, less the campaign — this page IS the
   * campaign. A message composed inline was built from no template, so that
   * entry is shown DISABLED with the reason rather than hidden: an absent
   * control and an inapplicable one look identical, and only one is honest.
   */
  const sendActions = (send: CampaignSend): RowActionsMenuItem[] => {
    const templateScreenId = String((send as any).templateScreenId ?? '')
    return [
      {
        key: 'details',
        label: 'Open report',
        icon: <MdiIcon path={mdiEyeOutline.path} size={0.8} />,
        href: sendHref(send),
      },
      {
        key: 'template',
        label: 'Open its template',
        icon: <MdiIcon path={mdiPaletteOutline.path} size={0.8} />,
        href: templateScreenId
          ? `${basePath}/templates/${templateScreenId}`
          : undefined,
        disabled: !templateScreenId,
        disabledReason: 'This message was not built from a template',
      },
    ]
  }

  const windowState = campaignWindowState(campaign, Date.now())
  const start = campaign.startAtMs
    ? new Date(campaign.startAtMs).toLocaleDateString()
    : ''
  const end = campaign.endAtMs
    ? new Date(campaign.endAtMs).toLocaleDateString()
    : ''

  return (
    <CardDisplay
      header={campaign.name || 'Campaign'}
      subheader={
        start || end
          ? `${start || 'Open'} – ${end || 'open-ended'}`
          : 'No campaign dates'
      }
      help={detailDocsHelp}
      HeaderProps={{
        action: (
          <Button
            component={AppLink as any}
            {...({ componentVariant: 'naked', nativeButton: false } as any)}
            href={`${basePath}/campaigns`}
            size="small"
            color="primary"
          >
            {'All campaigns'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip size="small" label={windowState} />
          {listIds.length ? (
            listIds.map((id) => (
              <Chip
                key={id}
                size="small"
                variant="outlined"
                label={names.get(id) ?? id}
              />
            ))
          ) : (
            <Typography variant="caption" color="text.secondary">
              {'No lists assigned — its emails pick their own audience'}
            </Typography>
          )}
        </Stack>

        <Divider />
        {/*
          The sum over the campaign's emails, not a second set of counters.
          Nothing is stored per campaign: a rollup document would have to be
          kept true against every delivery event of every email in it, and the
          numbers it duplicates are already on the sends this page reads.

          Drawn by the shared figures so a campaign's rate and a single
          message's read the same way — denominator named on the line, and an
          em dash rather than a zero where nothing was recorded.
         */}
        <Section title="Across this campaign">
          <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
            <Figure label="Addressed" {...rolled(rollup.addressed)} />
            <Figure label="Sent" {...rolled(rollup.sent)} />
            <Figure label="Delivered" {...rolled(rollup.delivered)} />
            <Figure label="Opens" {...rolled(rollup.opens)} />
            <Figure label="Clicks" {...rolled(rollup.clicks)} />
            <Figure label="Unsubscribed" {...rolled(rollup.unsubscribes)} />
          </Stack>
        </Section>
        <Stack spacing={0.5}>
          <RateRow label="Open rate" rate={rollup.openRate} />
          <RateRow label="Click rate" rate={rollup.clickRate} />
          <RateRow label="Unsubscribe rate" rate={rollup.unsubscribeRate} />
        </Stack>

        <Divider />
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Typography variant="subtitle2">
            {`Emails (${sends.length})`}
          </Typography>
          <Button
            size="small"
            variant={composing ? 'text' : 'contained'}
            onClick={() => setComposing((open) => !open)}
          >
            {composing ? 'Close composer' : 'Write an email'}
          </Button>
        </Stack>
        {sends.length ? (
          <Stack spacing={0.5}>
            {/*
              A TABLE, on the surface's own row grammar: the row opens the
              email's report, its subject is also a real link so it can be
              middle-clicked and copied, and the trailing cluster holds the
              actions. It used to be a row of `Stack`s with a `Report` text
              button on the end, which meant the campaign's emails and the
              Emails tab's — the same documents — read as two different kinds
              of thing.
             */}
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Subject'}</TableCell>
                  <TableCell>{'State'}</TableCell>
                  <TableCell align="right">{'Sent'}</TableCell>
                  <TableCell align="right">{'Opens'}</TableCell>
                  <TableCell align="right">{'Clicks'}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleSends.map((send) => (
                  <TableRow
                    key={send.$id}
                    hover
                    onClick={() => router.push(sendHref(send))}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      {/*
                        The row's own handler would fire too and push the same
                        route twice — one history entry per back press.
                       */}
                      <AppLink
                        href={sendHref(send)}
                        onClick={(event: { stopPropagation: () => void }) =>
                          event.stopPropagation()
                        }
                      >
                        {send.subject || send.$id}
                      </AppLink>
                    </TableCell>
                    <TableCell>
                      {send.status === 'scheduled' ? (
                        <Chip
                          size="small"
                          color="info"
                          label={`Scheduled · ${
                            send.sendAtMs
                              ? new Date(send.sendAtMs).toLocaleString()
                              : ''
                          }`}
                        />
                      ) : send.status === 'canceled' ? (
                        <Chip size="small" label="Canceled" />
                      ) : send.status === 'failed' ? (
                        <Chip size="small" color="error" label="Failed" />
                      ) : (
                        <Chip size="small" label="Sent" />
                      )}
                    </TableCell>
                    {/*
                      Sent over addressed, on one line: the two figures only
                      mean anything beside each other, and the gap between
                      them is the suppression list doing its work.
                     */}
                    <TableCell align="right">
                      {`${send.stats?.sent ?? 0}/${
                        send.stats?.recipients ?? 0
                      }`}
                    </TableCell>
                    <TableCell align="right">
                      {Number(send.stats?.opens ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell align="right">
                      {Number(send.stats?.clicks ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ width: 56 }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <RowActionsMenu
                        label={String(send.subject || send.$id)}
                        items={sendActions(send)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={visibleSends.length}
              // The emails the card HOLDS — bounded by the ceiling, which the
              // notice below owns up to when it bites.
              count={sends.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
            {sendsTruncated ? (
              <Alert severity="info">
                {`Showing ${CAMPAIGN_EMAIL_CEILING} of this campaign's ` +
                  'emails. It has sent more — the ones listed are not ' +
                  'necessarily the most recent, because a send carries no ' +
                  'date field that every writer stamps, and the figures above ' +
                  'cover the emails listed.'}
              </Alert>
            ) : null}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'No emails in this campaign yet.'}
          </Typography>
        )}

        {/*
          THE COMPOSER, ON DEMAND.

          It opens listens of its own — the site's email designs, the org's
          lists and segments, the running experiments — and this page is also
          where somebody arrives to read numbers. Mounting it unasked would
          make every reader pay for a composer they did not open, which is the
          same cost the campaign report was split onto its own route to avoid.
         */}
        {composing ? (
          <Box>
            <Divider sx={{ mb: 2 }} />
            <CampaignComposer
              hostId={hostId}
              emailCampaignId={campaignId}
              campaignListIds={listIds}
              campaignTopicId={campaign.topicId}
              onSent={() => setComposing(false)}
            />
          </Box>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
CampaignDetailCard.displayName = 'CampaignDetailCard'

export default CampaignDetailCard
