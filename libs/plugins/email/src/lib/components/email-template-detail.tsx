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

import { buildRoute, pluginDocsHelp, Route } from '@aglyn/aglyn'
import { ICON_VARIANT_BESIGNER } from '@aglyn/shared-data-enums'
import { mdiBullhornOutline, mdiEyeOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
} from '@aglyn/tenant-feature-instance'
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
import {
  collection,
  doc,
  documentId,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { CAMPAIGN_SEND_CONTAINER_FIELD } from '../model/campaign-container'
import { emailSendTimeMs } from '../model/email-record'
import { campaignSendDisplay } from '../model/campaign-container'
import { templateProvenance } from '../model/template-provenance'
import {
  templateReport,
  type TemplateCampaign,
} from '../model/template-report'
import EmailDesignPreview from './email-design-preview'
import EmailRecipientsCard from './email-recipients-card'
import { Figure, RateRow, Section } from './report-figures'

/**
 * How many of a template's messages one read covers.
 *
 * A CEILING on the read, not a page size: the report is a single figure per
 * quantity, so there is nothing to page through. Past it every total is a
 * floor and the report says so — the same treatment `audienceSizeTruncated`
 * gets, and for the same reason.
 */
export const TEMPLATE_CAMPAIGN_CEILING = 100

const templateDocsHelp = pluginDocsHelp('designedEmails', {
  anchor: '#send-it',
  excerpt:
    'One email template: what it looks like, every message sent from it, ' +
    'and what those messages did — each rate over the population it was ' +
    'measured against.',
})

export interface EmailTemplateDetailProps {
  hostId: string
  /** The `kind: 'email'` screen document this page is about. */
  screenId: string
  /** The emails hub URL, for the way back to the templates list. */
  basePath: string
}

/**
 * A message row on this page: what the report needs, plus what the ROW needs.
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
 * ONE EMAIL TEMPLATE: what it looks like, and what it has done.
 *
 * ## What was missing
 *
 * A template had a row in a list and no page. The only way to see one was to
 * open the besigner, which is the editor — it draws canvas nodes in a
 * browser, not the HTML an inbox receives — and the only way to see how it
 * performed was to find each message sent from it and read those reports one
 * at a time. A template used by six messages had its engagement in six places
 * and nowhere.
 *
 * ## Not necessarily this org's template
 *
 * A template can be installed from a marketplace listing, in which case its
 * content is versioned by somebody else and can be withdrawn. Provenance and
 * standing are read off the document itself — see `template-provenance.ts` —
 * so this page costs no marketplace read and still never presents an
 * installed template as locally authored.
 *
 * ## What this page reads
 *
 * The screen document, its published version, and the messages naming this
 * template — bounded at {@link TEMPLATE_CAMPAIGN_CEILING}. The recipients
 * table is its own card and its own request, so a reader who came for the
 * preview does not pay for the delivery-log query.
 */
export function EmailTemplateDetail(props: EmailTemplateDetailProps) {
  const { hostId, screenId, basePath } = props
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)
  const firestore = useFirestore()
  const router = useRouter()

  const { data: screen, status } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'screens', screenId),
    [firestore, hostId, screenId],
    { idField: '$id' },
  )
  // Three states, not two: a document still loading and one that does not
  // exist both arrive as `undefined`, and rendering an empty report for the
  // second is how a mistyped id reads as a template nobody ever sent.
  const notFound = status !== 'loading' && !screen
  const versionId: string | undefined = screen?.versionId

  const { data: version } = useFirestoreDoc<any>(
    () =>
      versionId
        ? doc(
            firestore,
            'hosts',
            hostId,
            'screens',
            screenId,
            'versions',
            versionId,
          )
        : null,
    [firestore, hostId, screenId, versionId],
  )

  /*
   * The messages sent from this template, ordered by DOCUMENT ID.
   *
   * Not by date, and that is forced rather than chosen: a sent message
   * carries `sentAt`, a scheduled one carries `sendAtMs`, and no writer
   * stamps a `createdAt` — so `orderBy` on either would not mis-sort this
   * list, it would DROP every message written by the other branch. Ordering
   * on the document id is the one ordering every message satisfies, it needs
   * no composite index beside the equality filter, and the rows are sorted by
   * date below over a window this component already holds.
   *
   * One MORE than the ceiling, so truncation is a fact rather than a guess.
   */
  const { data: messageDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'campaigns'),
        where('templateScreenId', '==', screenId),
        orderBy(documentId()),
        limit(TEMPLATE_CAMPAIGN_CEILING + 1),
      ),
    [firestore, hostId, screenId],
    { idField: '$id' },
  )

  const truncated = (messageDocs?.length ?? 0) > TEMPLATE_CAMPAIGN_CEILING
  const messages = useMemo<TemplateCampaign[]>(
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
        })) as TemplateMessage[],
    [messageDocs],
  )
  const orderedMessages = useMemo(
    () =>
      [...(messages as TemplateMessage[])].sort(
        (a, b) => b.scheduledForMs - a.scheduledForMs,
      ),
    [messages],
  )
  const report = useMemo(
    () => templateReport(messages, truncated),
    [messages, truncated],
  )
  const provenance = useMemo(() => templateProvenance(screen), [screen])

  const messageHref = (message: TemplateMessage) =>
    `${basePath}/emails/${message.campaignId}`

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
      icon: <MdiIcon path={mdiEyeOutline.path} size={0.8} />,
      href: messageHref(message),
    },
    {
      key: 'campaign',
      label: 'Open its campaign',
      icon: <MdiIcon path={mdiBullhornOutline.path} size={0.8} />,
      href: message.emailCampaignId
        ? `${basePath}/campaigns/${message.emailCampaignId}`
        : undefined,
      disabled: !message.emailCampaignId,
      disabledReason:
        'Sent before campaigns grouped their emails, so it belongs to none',
    },
  ]

  const listUrl = `${basePath}/templates`
  const besignerUrl =
    orgSlug && subdomain && versionId
      ? buildRoute(Route.SCREEN_BESIGNER, {
          orgSlug,
          host: subdomain,
          screenId,
          versionId,
        })
      : ''

  /*
   * The header's actions: the way back, and the way in.
   *
   * The same pair the screen, component, template and layout detail pages
   * carry — a link to the listing and a contained button into the besigner
   * wearing the besigner icon. It hangs off `CardDisplay`'s header rather
   * than the dashboard hero because this page is contributed by a plugin: the
   * console shell owns the hero, and a `scope:lib` plugin may not reach into
   * a `scope:app` layout to put a button in it.
   */
  const headerActions = (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Button
        component={AppLink as any}
        {...({ componentVariant: 'naked', nativeButton: false } as any)}
        href={listUrl}
        size="small"
        color="primary"
      >
        {'All templates'}
      </Button>
      {/*
        * A LINK once there is somewhere to go, and a plain disabled button
        * until then.
        *
        * Not one control with `disabled` on it: `disabled` renders an anchor
        * greyed out and still followable, so a template that has never been
        * saved would offer a besigner URL missing its version — a 404, which
        * reads as a broken console rather than as an empty template.
        */}
      {besignerUrl ? (
        <Button
          component={AppLink as any}
          {...({ componentVariant: 'naked', nativeButton: false } as any)}
          href={besignerUrl}
          size="small"
          variant="contained"
          startIcon={
            <MdiIcon color="inherit" path={ICON_VARIANT_BESIGNER.path} />
          }
        >
          {'Edit in besigner'}
        </Button>
      ) : (
        <Button
          size="small"
          variant="contained"
          disabled
          startIcon={
            <MdiIcon color="inherit" path={ICON_VARIANT_BESIGNER.path} />
          }
        >
          {'Edit in besigner'}
        </Button>
      )}
    </Stack>
  )

  if (notFound) {
    return (
      <CardDisplay
        header={'Email template'}
        help={templateDocsHelp}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: headerActions }}
      >
        <Typography variant="body2" color="text.secondary">
          {'This template could not be loaded. It may have been deleted.'}
        </Typography>
      </CardDisplay>
    )
  }

  return (
    <Stack spacing={3}>
      <CardDisplay
        header={screen?.displayName ?? 'Untitled template'}
        subheader={'Email template'}
        help={templateDocsHelp}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: headerActions }}
      >
        <Stack spacing={3}>
          {provenance.note ? (
            <Alert severity={provenance.warn ? 'warning' : 'info'}>
              {provenance.note}
            </Alert>
          ) : null}
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
                <Table size="small">
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
                </Table>
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
                <Table size="small">
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
                            ? new Date(
                                message.scheduledForMs,
                              ).toLocaleString()
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
                </Table>
              </Section>
            </>
          ) : null}
        </Stack>
      </CardDisplay>

      <EmailRecipientsCard hostId={hostId} screenId={screenId} />

      {/*
       * Last, and its own card — the same order the email's own page uses.
       * The figures are what a reader opens either page for and the frame is
       * the tallest thing on both, so at the top it pushes every number below
       * the fold.
       */}
      <CardDisplay header={'Preview'} contentGutterX contentGutterY>
        <EmailDesignPreview
          hostId={hostId}
          nodes={version?.nodes}
          loading={version === undefined && Boolean(versionId)}
          subject={String(screen?.emailSubject ?? '')}
          preheader={String(screen?.emailPreheader ?? '')}
          emptyMessage={
            'This template has nothing in it yet. Open it in the ' +
            'besigner to build the email.'
          }
        />
      </CardDisplay>
    </Stack>
  )
}
EmailTemplateDetail.displayName = 'EmailTemplateDetail'

export default EmailTemplateDetail
