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
  mdiDeleteOutline,
  mdiEyeOutline,
  mdiPaletteOutline,
  mdiPencilOutline,
} from '@aglyn/shared-data-mdi'
import {
  AppLink,
  CardDisplay,
  MdiIcon,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import {
  Figure,
  RateRow,
  Section,
} from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { ceilingedWindow } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { PageHeaderRecord, pluginDocsHelp } from '@aglyn/aglyn'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  deleteField,
  documentId,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
} from '@aglyn/tenant-feature-instance'
import {
  campaignRollup,
  campaignSendDisplay,
  campaignSiteIds,
  campaignVisibleTo,
  campaignWindowState,
  emailListTimeMs,
  type CampaignAggregate,
  type CampaignSend,
  type EmailCampaign,
} from '@aglyn/shared-ui-email-campaigns/model'
import CampaignComposer from './campaign-composer'
import CampaignEditDrawer, {
  type CampaignEditValues,
} from './campaign-edit-drawer'
import {
  CampaignConversionsSection,
  CampaignDestinationsSection,
  CampaignRevenueSection,
  CampaignSequencesSection,
} from './campaign-reach-sections'
import CampaignMembersSection from './campaign-members-section'
import CampaignReportCard from './campaign-report-card'
import { campaignContainerDoc, campaignSendsQuery } from './campaign-queries'
import {
  orgSiteHubPath,
  orgSiteName,
  orgSiteOptions,
  topicCatalogHostId,
  useMarketingOrgId,
  useMarketingOrgMount,
} from './marketing-org-mount'
import { useCampaignManageApi } from './use-campaign-send-api'
import { useEmailsHubPath } from './use-emails-hub-path'
import { useCampaignTopicOptions } from './use-campaign-topic-options'

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
  /** The site, or `null` on the org Marketing hub. */
  hostId: string | null
  /** A campaign container id, or a send id from before containers existed. */
  campaignId: string
  /** The marketing hub URL, for the way back to the campaigns list. */
  basePath: string
}

/**
 * ONE CAMPAIGN: its lists, what it caused, what it earned, where it sent
 * people, and the emails it did all of that with.
 *
 * ## Why the emails are a section rather than the page
 *
 * A campaign reaches people by email, which is not the same as a campaign
 * BEING a list of emails. It runs over a window, against a set of audiences,
 * and the pages its links land on, the money credited to it and the
 * conversions credited to it are facts about the campaign that no single
 * message in it holds. So the body is sectioned — what it caused, what it
 * earned, where it sent people, then the mail's own figures, then its emails
 * — and each section names the population it describes.
 *
 * The ORDER is the part that says which of those the page is about. Delivery,
 * engagement and rates are mechanics of a message; a page that met the reader
 * with them and reached the outcomes only after scrolling was a mail report
 * whatever its headings claimed. `campaign-report-card.tsx` — the page a
 * campaign of one email gets — carries the same two outcome headings first,
 * for the same reason and in the same words.
 *
 * The three middle sections live in `campaign-reach-sections.tsx`, which is
 * also where the reason a campaign cannot simply DECLARE the screens and
 * forms it runs across is written down: no such edge is stored, attribution
 * is the mechanism, and all three sections join on this campaign's send ids.
 *
 * ## Why this resolves two kinds of id
 *
 * The id in `campaigns/{id}` may name a campaign CONTAINER or a single SEND,
 * and which it is is answered by reading: a container at `emailCampaigns/{id}`
 * renders this page, and anything else falls through to that send's own
 * report.
 *
 * Not every send belongs to a container. One written before campaigns grouped
 * their emails names none, its own id is the only id the URL can carry, and
 * that id is also inside the HMAC of every unsubscribe footer already
 * delivered — so a send id has to go on addressing a page rather than a 404.
 * The fall-through is what makes the container additive: no send document is
 * rewritten and no id is reassigned.
 *
 * The extra read is one document, and it buys the guarantee that a pasted
 * report link resolves whichever kind of id it carries.
 *
 * ## Under a site, and over the organization
 *
 * The container and its sends are the org's, so the same page renders on the
 * org hub with `hostId` null. What changes there is everything that is a SITE
 * fact: the emails listed are every site's rather than the ones sent as this
 * site, the forms and screens filed under the campaign are gathered from each
 * site it is placed on, the conversions are one chosen site's (they are
 * recorded per site), and writing an email first asks which site it is sent
 * as — its sender, its designs and its consent all belong to that site.
 */
export function CampaignDetailCard(props: CampaignDetailCardProps) {
  const { hostId, campaignId, basePath } = props
  const firestore = useFirestore()
  // The sibling hub, for the two records this page links to but does not own:
  // each message's report and the template it was built from.
  const emailsHub = useEmailsHubPath()
  const router = useRouter()
  const orgMount = useMarketingOrgMount()
  const { orgId } = useMarketingOrgId(hostId)
  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()
  const manageApi = useCampaignManageApi(hostId, orgId)
  /*
   * The site an email written here is sent AS. Under a site it is that site
   * and never asked; on the org hub it is chosen before the composer opens.
   * Empty means nobody has chosen yet.
   */
  const [composeHostId, setComposeHostId] = useState('')
  /** The site whose conversions the org hub is showing; empty until chosen. */
  const [conversionsHostId, setConversionsHostId] = useState('')
  const [composing, setComposing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { data: campaign, status } = useFirestoreDoc<EmailCampaign>(
    () => (orgId ? campaignContainerDoc(firestore, orgId, campaignId) : null),
    [firestore, orgId, campaignId],
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
   * on one field ordered by DOCUMENT NAME. On the org hub that is all the
   * query says, and the automatic single-field index serves it. Under a site
   * the sends are also narrowed to the ones sent as that site — the scope
   * filter that makes the read provable for a site collaborator — and that
   * pair is the one composite index this page needs. Ordering on a date
   * would need that index AND would drop every send missing that particular
   * date — a sent send carries `sentAt`, a scheduled one `sendAtMs`, and
   * neither is on both. Sorted by date below, over a window this page holds
   * whole.
   *
   * One document past the ceiling, so "this campaign has more emails than are
   * listed" is a fact rather than a guess.
   */
  const { data: sendDocs } = useFirestoreCollection<any>(
    () => {
      const sends = campaign
        ? campaignSendsQuery(firestore, orgId, hostId)
        : null
      return sends
        ? query(
            sends,
            where('emailCampaignId', '==', campaignId),
            orderBy(documentId()),
            limit(CAMPAIGN_EMAIL_CEILING + 1),
          )
        : null
    },
    [firestore, orgId, hostId, campaignId, Boolean(campaign)],
    { idField: '$id' },
  )

  const { data: listDocs } = useFirestoreCollection<any>(
    () =>
      campaign && orgId
        ? query(collection(firestore, 'orgs', orgId, 'lists'), limit(50))
        : null,
    [firestore, orgId, Boolean(campaign)],
    { idField: '$id' },
  )

  /*
   * The org's topic catalog, read only while the EDIT DRAWER is open.
   *
   * It fills one picker in that drawer and is drawn nowhere else on this
   * page, so reading it on mount would charge every reader who came for the
   * campaign's numbers for a field they are not looking at. The composer
   * carries its own read of the same catalog, behind its own button, for the
   * same reason.
   */
  const { topics, source: topicSource } = useCampaignTopicOptions(
    topicCatalogHostId(hostId, orgMount),
    { enabled: editing },
  )
  const topicOptions = useMemo(
    () =>
      topics.map((topic) => ({
        value: topic.id,
        label: topic.name,
      })),
    [topics],
  )

  const { rows: readSends, truncated: sendsTruncated } = ceilingedWindow<any>(
    sendDocs,
    CAMPAIGN_EMAIL_CEILING,
  )
  /*
   * Newest first on the time each email SITS at — its send time where it has
   * one, its creation where it does not. A draft has neither `sentAt` nor
   * `sendAtMs`, so ordering on the send time alone gave every draft the key 0
   * and filed the email a merchant is in the middle of writing below mail
   * sent years ago.
   */
  const sends = useMemo(
    () =>
      [...(readSends as CampaignSend[])].sort(
        (a, b) => emailListTimeMs(b) - emailListTimeMs(a),
      ),
    [readSends],
  )
  const rollup = useMemo(() => campaignRollup(sends), [sends])
  // The ids the two sections beneath the figures join on. Derived from the
  // window this card already holds, so neither of them reads the send list
  // again to find out which emails the campaign has.
  const sendIds = useMemo(
    () => sends.map((send) => String(send.$id)).filter(Boolean),
    [sends],
  )

  /*==========================================
   * SAVING THE CONTAINER, WITH THE CLIENT SDK.
   *
   * The same door the create drawer already uses. `emailCampaigns` is
   * deliberately outside the security rules' server-only exclusion list — a
   * container holds no counter, no consent record and no entitlement input,
   * so an editor who writes one cannot buy themselves a send — and giving the
   * edit a route of its own would be a second writer to keep in step with the
   * create.
   *
   * `updateDoc` rather than a merge-set, because this is an edit of a
   * document that exists: a set would CREATE a campaign at this id for
   * somebody who deleted it in another tab, which is the shape the delivery
   * webhook is careful about on the send collection for the same reason.
   *
   * A cleared date is written as `null` — the absence the model already
   * spells — and a cleared topic REMOVES the field, because the model has no
   * null topic and `campaignTopicId` is handed to the composer as one.
   *
   * `visibleTo` is written only from the org hub, and only when its drawer
   * says the placement changed. A site hub never touches it: the rules let a
   * site collaborator edit a campaign only while its scope is unchanged, and
   * a site hub has no field for it anyway.
   *=========================================*/
  const handleSave = useCallback(
    async (values: CampaignEditValues) => {
      if (saving || !orgId) return
      setSaving(true)
      setSaveError(null)
      try {
        await updateDoc(campaignContainerDoc(firestore, orgId, campaignId), {
          name: values.name,
          startAtMs: values.startAtMs,
          endAtMs: values.endAtMs,
          listIds: values.listIds,
          topicId: values.topicId ? values.topicId : deleteField(),
          ...(!hostId && values.siteIds !== undefined
            ? { visibleTo: campaignVisibleTo(values.siteIds) }
            : {}),
        })
        setEditing(false)
        enqueueSnackbar('Campaign updated', {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        console.error(error)
        setSaveError('The campaign could not be saved')
      } finally {
        setSaving(false)
      }
    },
    [campaignId, enqueueSnackbar, firestore, hostId, orgId, saving],
  )

  /*==========================================
   * DELETING THE CONTAINER, WHICH IS NOT DELETING ITS MAIL.
   *
   * The route detaches every email first and then removes the campaign, so
   * what a merchant is agreeing to is the grouping going away — the emails
   * stay, keep their ids, keep their reports, and read afterwards as single
   * sends. Their unsubscribe links carry those ids inside an HMAC and go on
   * working, which is why the container can never take them with it.
   *
   * The confirmation says the count and says what a delete does NOT do. A
   * scheduled email inside the campaign still goes out at its time — stopping
   * somebody's mail is `cancel`, on that email's own page — and a merchant
   * who reads "delete campaign" as "stop the campaign" has to be told
   * otherwise before they press it, not after.
   *=========================================*/
  const handleDelete = useCallback(async () => {
    if (deleting) return
    /*
     * Emails with mail still to go: the ones waiting for their time AND the
     * ones part way through an audience larger than one batch. Both are what
     * a merchant needs warning about, and counting only `scheduled` would
     * miss the case that needs it most — a campaign that is delivering right
     * now is stored as `scheduled` too, but `rollup.scheduled` is the
     * narrower reading that excludes it.
     */
    const unfinished = rollup.scheduled + rollup.sending
    const agreed = await confirm({
      title: 'Delete this campaign?',
      description:
        (sends.length
          ? `The ${sends.length.toLocaleString()} ` +
            `${sends.length === 1 ? 'email' : 'emails'} in it are kept — ` +
            'each keeps its own report and its unsubscribe links, and they ' +
            'appear in the campaigns list as single sends. '
          : 'It holds no emails. ') +
        (unfinished
          ? `${unfinished.toLocaleString()} of them ${
              unfinished === 1 ? 'is' : 'are'
            } still going out or still due, and deleting the campaign does ` +
            'not stop that — the sender picks each one up from its own ' +
            'record. Stop a send from its own page. '
          : '') +
        'Any screens, forms and contacts assigned to it come out of it and ' +
        'are otherwise untouched. Only the campaign itself goes.',
      confirmationText: 'Delete campaign',
    })
      .then(() => true)
      .catch(() => false)
    if (!agreed) return
    setDeleting(true)
    try {
      const { response, payload } = await manageApi({
        action: 'deleteCampaign',
        campaignId,
      })
      if (!response.ok) {
        return void enqueueSnackbar(
          payload?.error ?? 'The campaign could not be deleted',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      enqueueSnackbar('Campaign deleted', { variant: 'success', persist: false })
      router.push(`${basePath}/campaigns`)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('The campaign could not be deleted', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setDeleting(false)
    }
  }, [
    basePath,
    campaignId,
    confirm,
    deleting,
    enqueueSnackbar,
    manageApi,
    rollup.scheduled,
    rollup.sending,
    router,
    sends.length,
  ])

  // Still settling. Falling through to the send report here would flash "this
  // campaign could not be loaded" on every open of a campaign that exists —
  // and under a site nothing is read at all until the site's org is known.
  if (!campaign && (status === 'loading' || !orgId)) return null

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
  /*==========================================
   * ONE EMAIL'S PAGE — the same one every other route to that record opens.
   *
   * The Emails hub's `emails/{sendId}`, which is where the messages list and
   * a template's messages table also send a reader. One record has one page:
   * a link that resolved somewhere else depending on which list it was
   * clicked in would give the same message two pages, and the reader would
   * have no way to tell which one they were on.
   *
   * `campaigns/{sendId}` on THIS hub goes on resolving as well, through the
   * fall-through at the top of this file. That is not a convenience — every
   * unsubscribe footer already delivered carries `cid={sendId}`, those
   * messages sit in inboxes forever, and merchants paste report URLs into
   * their own mail. Which link the console GENERATES and which URLs ANSWER
   * are two separate questions, and only the first is decided here.
   *
   * Nor is a redirect the answer to the second. A redirect would be another
   * thing to be wrong about an id that is inside an HMAC; a page that keeps
   * working has nothing to get wrong, and it costs nothing to leave standing.
   *=========================================*/
  /*
   * A message opens on the Emails page: the site's under a site, and over the
   * org the organization's own, which lists every site's messages.
   */
  const messagesPath = emailsHub ? `${emailsHub}/messages` : null
  const sendHref = (send: CampaignSend) =>
    messagesPath ? `${messagesPath}/${send.$id}` : undefined
  /** A template is a site's design, so it opens on the site the send used. */
  const templatesPath = (send: CampaignSend): string | null => {
    const hub = orgMount ? orgSiteHubPath(orgMount, send.hostId, 'emails') : emailsHub
    return hub ? `${hub}/templates` : null
  }

  /**
   * What one of this campaign's emails can be opened into.
   *
   * The same two the Emails hub offers, less the campaign — this page IS the
   * campaign. Both destinations are records the Emails console owns, so they
   * are built from {@link useEmailsHubPath} rather than from this surface's
   * own `basePath`.
   *
   * A message composed inline was built from no template, so that entry is
   * shown DISABLED with the reason rather than hidden: an absent control and
   * an inapplicable one look identical, and only one is honest.
   */
  const sendActions = (send: CampaignSend): RowActionsMenuItem[] => {
    const templateScreenId = String((send as any).templateScreenId ?? '')
    const templates = templatesPath(send)
    return [
      {
        key: 'details',
        label: 'Open report',
        icon: <MdiIcon path={mdiEyeOutline.path} size={0.8} />,
        href: sendHref(send),
        disabled: !sendHref(send),
        disabledReason: 'This site’s console URL has not resolved yet',
      },
      {
        key: 'template',
        label: 'Open its template',
        icon: <MdiIcon path={mdiPaletteOutline.path} size={0.8} />,
        href:
          templateScreenId && templates
            ? `${templates}/${templateScreenId}`
            : undefined,
        disabled: !templateScreenId || !templates,
        disabledReason: templateScreenId
          ? 'This site’s console URL has not resolved yet'
          : 'This message was not built from a template',
      },
    ]
  }

  /*
   * The campaign's emails, on the surface's own row grammar: the row opens
   * the email's report, its subject is also a real link so it can be
   * middle-clicked and copied, and the trailing cluster holds the actions.
   * The window is one the card already holds, so the grid pages it.
   */
  const sendColumns: GridColDef<CampaignSend>[] = [
    {
      field: 'subject',
      headerName: 'Subject',
      flex: 1,
      minWidth: 220,
      valueGetter: (_value, send) => send.subject || send.$id,
      /*
        Plain text until the Emails hub resolves: a link with no destination
        is worse than none, and this cell is the message's subject either way.
       */
      renderCell: ({ row: send, value }) => {
        const href = sendHref(send)
        return href ? (
          <AppLink
            href={href}
            // The row's own handler would fire too and push the same route
            // twice — one history entry per back press.
            onClick={(event: { stopPropagation: () => void }) =>
              event.stopPropagation()
            }
          >
            {value}
          </AppLink>
        ) : (
          value
        )
      },
    },
    {
      /*
        WHAT THE EMAIL IS DOING, not the field it stores.

        This branched on the status, which reads "Scheduled" about an email
        that has delivered five hundred messages and is between batches — the
        stored state the processor claims to resume it. The derivation reads
        the counters beside the status; the due date is appended only where
        there is genuinely nothing delivered yet, which is the one case a time
        answers.
       */
      field: 'state',
      headerName: 'State',
      width: 220,
      valueGetter: (_value, send) => {
        const display = campaignSendDisplay(send)
        return display.state === 'pending' && send.sendAtMs
          ? `${display.label} · ${new Date(send.sendAtMs).toLocaleString()}`
          : display.label
      },
      renderCell: ({ row: send, value }) => {
        const state = campaignSendDisplay(send).state
        return (
          <Chip
            size="small"
            color={
              state === 'sending' ? 'info' : state === 'stopped' ? 'warning' : undefined
            }
            label={value}
          />
        )
      },
    },
    {
      /*
        Sent over addressed, on one line: the two figures only mean anything
        beside each other, and the gap between them is the suppression list
        doing its work.
       */
      field: 'sent',
      headerName: 'Sent',
      type: 'number',
      align: 'right',
      headerAlign: 'right',
      width: 110,
      valueGetter: (_value, send) => Number(send.stats?.sent ?? 0),
      renderCell: ({ row: send }) =>
        `${send.stats?.sent ?? 0}/${send.stats?.recipients ?? 0}`,
    },
    {
      field: 'opens',
      headerName: 'Opens',
      type: 'number',
      align: 'right',
      headerAlign: 'right',
      width: 100,
      valueGetter: (_value, send) => Number(send.stats?.opens ?? 0),
      valueFormatter: (value: number) => value.toLocaleString(),
    },
    {
      field: 'clicks',
      headerName: 'Clicks',
      type: 'number',
      align: 'right',
      headerAlign: 'right',
      width: 100,
      valueGetter: (_value, send) => Number(send.stats?.clicks ?? 0),
      valueFormatter: (value: number) => value.toLocaleString(),
    },
    listActionsColumn(
      (send: CampaignSend) => (
        <ListRowActions
          label={String(send.subject || send.$id)}
          items={sendActions(send)}
        />
      ),
      { width: 72 },
    ),
  ]

  const windowState = campaignWindowState(campaign, Date.now())
  const start = campaign.startAtMs
    ? new Date(campaign.startAtMs).toLocaleDateString()
    : ''
  const end = campaign.endAtMs
    ? new Date(campaign.endAtMs).toLocaleDateString()
    : ''

  /*
   * THE SITES IT IS PLACED ON, which the org hub needs three times over: the
   * forms and screens filed under it are gathered from each of them, its
   * conversions are read for one of them, and an email written here is sent
   * as one of them. Every site when it is placed everywhere. Under a site the
   * answer is that site, and none of this is read.
   */
  const placedIds = campaignSiteIds(campaign)
  const placedSites = orgMount
    ? orgMount.hosts.filter(
        (site) => placedIds === null || placedIds.includes(site.id),
      )
    : []
  const conversionsHost =
    hostId ?? (conversionsHostId || placedSites[0]?.id || '')
  const conversionsBasePath = hostId
    ? basePath
    : orgSiteHubPath(orgMount, conversionsHost, 'marketing')
  /** Asked only when there is a choice to make; one site answers itself. */
  const writeAsHostId =
    hostId ??
    (placedSites.length === 1 ? placedSites[0].id : composeHostId)

  /* The card, named so the page chrome above it is a plain list of
     what this surface publishes upward. */
  const card = (
    <CardDisplay
      header={'Campaign'}
      subheader={
        start || end
          ? `${start || 'Open'} – ${end || 'open-ended'}`
          : 'No campaign dates'
      }
      help={detailDocsHelp}
      HeaderProps={{
        /*
          NAVIGATION, THEN THE OVERFLOW.

          Editing and deleting a campaign live here rather than on the
          campaigns table, because a record is edited on its own page in this
          console. `RowActionsMenu` is named for table rows and its rendering
          is not — a kebab and a menu whose items carry `destructive` and
          `disabled` — so reusing it is what keeps this overflow behaving like
          every other one on the surface, including the email page's.
         */
        action: (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button
              component={AppLink as any}
              {...({ componentVariant: 'naked', nativeButton: false } as any)}
              href={`${basePath}/campaigns`}
              size="small"
              color="primary"
            >
              {'All campaigns'}
            </Button>
            <RowActionsMenu
              label={campaign.name || 'Campaign'}
              items={[
                {
                  key: 'edit',
                  label: 'Edit campaign',
                  icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
                  onClick: () => {
                    setSaveError(null)
                    setEditing(true)
                  },
                },
                {
                  key: 'delete',
                  label: 'Delete campaign',
                  icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
                  destructive: true,
                  disabled: deleting,
                  disabledReason: 'This campaign is being deleted',
                  onClick: () => void handleDelete(),
                },
              ]}
            />
          </Stack>
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
        {orgMount ? (
          <Typography variant="body2" color="text.secondary">
            {placedIds === null
              ? 'Offered on every site'
              : placedIds.length
                ? `Offered on ${placedIds
                    .map((id) => orgSiteName(orgMount, id))
                    .join(', ')}`
                : 'Not offered on any site yet — edit the campaign to place it'}
          </Typography>
        ) : null}

        <Divider />
        {/*
          A CAMPAIGN IS NOT ONLY ITS MAIL, and it leads with the part that
          is not.

          What the campaign CAUSED and where it SENT people are facts about the
          campaign; delivery, engagement and rates are mechanics of the
          messages it used, and the list of those messages is one section among
          several rather than the page. Ordering the mail first said the
          opposite in the only way a page can — by what a reader meets before
          they scroll — and a campaign of ONE email says it loudest, which is
          why `campaign-report-card.tsx` carries these two headings in this
          order too.

          All three sections join on the campaign's own send ids, which is the
          only handle the attribution, revenue and click-report collections
          offer — see `campaign-reach-sections.tsx` for why no other join
          exists, and why the web channel is named there rather than quietly
          omitted.
         */}
        {/*
          Conversions are recorded per SITE — they are that site's visitors —
          so the org hub reads them for one site at a time, defaulting to the
          first site the campaign is placed on.
         */}
        {orgMount && placedSites.length > 1 ? (
          <TextField
            select
            size="small"
            label="Conversions on"
            value={conversionsHost}
            onChange={(event) => setConversionsHostId(event.target.value)}
            sx={{ maxWidth: 320 }}
          >
            {placedSites.map((site) => (
              <MenuItem key={site.id} value={site.id}>
                {site.name || site.subdomain || site.id}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        {conversionsHost ? (
          <CampaignConversionsSection
            key={conversionsHost}
            hostId={conversionsHost}
            sendIds={sendIds}
            truncated={sendsTruncated}
            basePath={conversionsBasePath}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'Conversions are counted per site, and this campaign is not ' +
              'placed on one yet.'}
          </Typography>
        )}

        <Divider />
        {/*
          WHAT ITS SEQUENCES PRODUCED (AGL-3254), beside what its mail caused:
          a sequence in this campaign is a rep's one-to-one outreach, and its
          enrollments, sends, replies, meetings and conversions are the
          campaign's numbers too. Joined on the container's own id, since a
          sequence's emails are not the campaign's sends.
         */}
        <CampaignSequencesSection orgId={orgId} campaignId={campaignId} />

        <Divider />
        {/*
          WHAT IT EARNED, between what it caused and where it sent people —
          the order `campaign-report-card.tsx` puts these three in, so a
          campaign of one email and a campaign of ten answer the merchant's
          questions in the same sequence.

          How many messages a container holds is not a fact about whether its
          revenue is knowable, so the money question is answered here whatever
          the count. Reading it costs one record per email, so it asks first —
          see `campaign-reach-sections.tsx` for that bargain, and for why the
          currencies are reported apart and never totalled.
         */}
        <CampaignRevenueSection
          orgId={orgId}
          sendIds={sendIds}
          truncated={sendsTruncated}
        />

        <Divider />
        <CampaignDestinationsSection
          orgId={orgId}
          sendIds={sendIds}
          truncated={sendsTruncated}
        />

        <Divider />
        {/*
          WHAT THE MERCHANT SAID BELONGS HERE, under what the visitors did.

          Everything above this line is measured — the conversions, the money
          and the pages the mail's own links pointed at, all joined on this
          campaign's send ids. This section is the only one on the page that
          reports a DECLARATION: a screen or a form carrying this campaign's
          id in its own document because somebody put it there.

          It sits after the evidence deliberately. A reader who met the
          assigned list first would take it for the campaign's reach, and the
          two are not the same list — a landing page can be assigned to a
          campaign no email ever linked to, and a campaign's mail can drive
          traffic to a page assigned to nothing.

          The dates go with it. A form's counters are lifetime, so a campaign
          with a window has to be able to confine them to its own months; a
          campaign without one is told so, and says its figures are lifetime
          rather than implying they are its own.
         */}
        {hostId ? (
          <CampaignMembersSection
            hostId={hostId}
            campaignId={campaignId}
            startAtMs={campaign.startAtMs}
            endAtMs={campaign.endAtMs}
          />
        ) : (
          /*
           * Forms and screens are a site's records, so on the org hub each
           * site the campaign is placed on answers for its own. One section
           * per site keeps each one's figures and ceilings its own rather
           * than merging lists that were bounded separately.
           */
          placedSites.map((site) => (
            <CampaignMembersSection
              key={site.id}
              hostId={site.id}
              siteName={site.name || site.subdomain || site.id}
              campaignId={campaignId}
              startAtMs={campaign.startAtMs}
              endAtMs={campaign.endAtMs}
            />
          ))
        )}

        <Divider />
        {/*
          THE MAIL'S OWN FIGURES, under the outcomes rather than over them.

          The sum over the campaign's emails, not a second set of counters.
          Nothing is stored per campaign: a rollup document would have to be
          kept true against every delivery event of every email in it, and the
          numbers it duplicates are already on the sends this page reads.

          Drawn by the shared figures so a campaign's rate and a single
          message's read the same way — denominator named on the line, and an
          em dash rather than a zero where nothing was recorded.
         */}
        <Section title="The mail, across this campaign">
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
          {/*
            The section rail's own heading style, so this reads as one section
            among the others rather than as the page's subject.
           */}
          <Typography variant="overline" color="text.secondary">
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
            <ListTable
              aria-label="The campaign's emails"
              rows={sends}
              columns={sendColumns}
              rowHeight={TABLE_ROW_HEIGHT}
              onOpen={(_id, send) => {
                const href = sendHref(send)
                if (href) router.push(href)
              }}
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
            {/*
              WHICH SITE IT IS SENT AS, asked first on the org hub. The sender,
              the designs, the consent a recipient gave and the unsubscribe
              signature are all one site's, so the composer cannot open
              without one — and the choice is limited to the sites this
              campaign is placed on.
             */}
            {!hostId && placedSites.length > 1 ? (
              <TextField
                select
                size="small"
                label="Send as"
                value={composeHostId}
                onChange={(event) => setComposeHostId(event.target.value)}
                helperText="The site this email is sent from — its sender, designs and unsubscribe page"
                sx={{ mb: 2, maxWidth: 420 }}
                fullWidth
              >
                {placedSites.map((site) => (
                  <MenuItem key={site.id} value={site.id}>
                    {site.name || site.subdomain || site.id}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            {writeAsHostId ? (
              <CampaignComposer
                key={writeAsHostId}
                hostId={writeAsHostId}
                emailCampaignId={campaignId}
                campaignListIds={listIds}
                campaignTopicId={campaign.topicId}
                onSent={() => setComposing(false)}
              />
            ) : !placedSites.length && !hostId ? (
              <Typography variant="body2" color="text.secondary">
                {'Place this campaign on a site before writing an email in ' +
                  'it — every email is sent as one site.'}
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </Stack>
      {/*
        THE EDIT DRAWER, on the campaign's own page.

        Its list picker reads the same `listDocs` the chips above already
        cost, so opening it adds one read — the topic catalog — and only
        while it is open.
       */}
      {/* Draws nothing: the zone the topic catalog's owner answers through. */}
      {topicSource}
      <CampaignEditDrawer
        open={editing}
        onClose={() => setEditing(false)}
        campaign={campaign}
        lists={(listDocs ?? []).map((list: any) => ({
          value: String(list.$id),
          label: String(list.name ?? list.$id),
        }))}
        topics={topicOptions}
        sites={orgMount ? orgSiteOptions(orgMount) : undefined}
        busy={saving}
        error={saveError}
        onSubmit={(values) => void handleSave(values)}
      />
    </CardDisplay>
  )

  return (
    <>
      {/* The page heading and the trail name the campaign; this card is
          then free to say what it holds rather than repeating the title. */}
      <PageHeaderRecord title={campaign.name || campaignId} />
      {card}
    </>
  )
}
CampaignDetailCard.displayName = 'CampaignDetailCard'

export default CampaignDetailCard
