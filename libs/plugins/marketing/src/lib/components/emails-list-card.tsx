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
import {
  mdiBullhornOutline,
  mdiContentCopy,
  mdiDeleteOutline,
  mdiEyeOutline,
  mdiPaletteOutline,
} from '@aglyn/shared-data-mdi'
import {
  AppLink,
  CardDisplay,
  MdiIcon,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { hiddenFilterVisibility } from '@aglyn/shared-ui-jsx/const/list-filter'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { CreateArtifactDrawer } from '@aglyn/shared-ui-jsx-forms'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { collectionCeiling } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import {
  DUPLICATE_MENU_LABEL,
  useDuplicateResource,
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { Button, Chip, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import {
  campaignPlacedOnHost,
  campaignSendDisplay,
  CAMPAIGN_SEND_CONTAINER_FIELD,
  type CampaignSendDisplayState,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-container'
import {
  emailListTimeMs,
  emailSendTimeMs,
} from '@aglyn/shared-ui-email-campaigns/model/email-record'
import {
  useCampaignManageApi,
  useCampaignSendApi,
} from './use-campaign-send-api'
import {
  CAMPAIGN_SEND_STATUS_OPTIONS,
  SINGLE_SEND_FILTER_VALUE,
  campaignEmailsListQuery,
  campaignSendsScope,
  emailCampaignQueryClauses,
} from '../model/campaign-list-query'
import { useMarketingHubPath } from './use-marketing-hub-path'
import { siteRecordRouteContext, useRecordRouteContext } from './record-route-context'
import {
  campaignContainersQuery,
  campaignSendsCollection,
} from './campaign-queries'
import {
  orgSiteName,
  orgSiteOptions,
  useMarketingOrgId,
  useMarketingOrgMount,
} from './marketing-org-mount'

/**
 * How many campaigns the Campaign filter and the create drawer offer — the
 * same read serves both. A picker's options, not a list.
 */
const CONTAINER_CEILING = 50

/**
 * Why discard is refused, keyed by the state that refuses it.
 *
 * The KEYS are persisted status values written by the send path. Each line
 * says what to do instead, because "you cannot" on its own leaves a merchant
 * with an email they wanted rid of and no next step — and for a scheduled one
 * the next step is a different act with a different consequence, so naming it
 * is the difference between withdrawing mail and losing the record of it.
 *
 * A state absent from here falls through to the generic refusal rather than
 * being flattened into one of these: a state this list cannot name is worth
 * seeing.
 */
const DISCARD_REFUSAL: Record<string, string> = {
  sent: 'This email has been sent. Its report and its unsubscribe links have to go on resolving.',
  scheduled: 'Cancel the send first — cancelling takes it off the clock and keeps the email.',
  sending: 'This email is being sent right now.',
  canceled: 'A canceled email is kept as the record that it was withdrawn.',
}

/**
 * The chip color for one display state.
 *
 * `sending` is the one worth a color: an email part way through an audience
 * larger than one batch is doing something right now, and a merchant scanning
 * the list for what needs attention should find it without reading. The rest
 * are neutral, because a finished send and a draft are not events.
 */
const STATE_COLOR: Partial<
  Record<CampaignSendDisplayState, 'info' | 'warning'>
> = {
  sending: 'info',
  stopped: 'warning',
  // Waiting on staff, not on the merchant (AGL-3356): worth finding on a scan.
  held: 'warning',
}

/*
 * What the messages grid's Filters panel offers, each clause and the search
 * on the list's Firestore query (AGL-3321, `campaignEmailsListQuery`). The
 * State column is what the email is DOING (`campaignSendDisplay`), which no
 * query can ask, so the panel offers the Status it STORES instead.
 */
const EMAIL_FILTER_HEADERS: Readonly<Record<string, string>> = {
  subject: 'Subject',
  status: 'Status',
  emailCampaignId: 'Campaign',
  site: 'Site',
  createdAtMs: 'Created',
}

const emailsDocsHelp = pluginDocsHelp('emailCampaigns', {
  anchor: '#opens--clicks',
  excerpt:
    'Every message this site has sent or has scheduled, each with its own ' +
    'report: what was delivered, who opened it, and which links they followed.',
})

export interface EmailsListCardProps {
  /** The site, or `null` on the organization's Emails page. */
  hostId: string | null
  /**
   * The Emails page's own URL, under the site or the organization, so a row
   * can link to the message's own page beneath it.
   */
  basePath: string
}

/**
 * EVERY MESSAGE, AS AGAINST EVERY CAMPAIGN.
 *
 * A campaign groups messages; this is the messages. The two are different
 * questions — "how did the spring promotion do" and "what went out on the
 * 14th, and to whom" — and they were previously the same list because a
 * campaign document WAS a single send.
 *
 * ## Asked of Firestore, a page at a time
 *
 * No SEND date is on every message — a sent one carries `sentAt`, a
 * scheduled one `sendAtMs`, a draft neither — so the list is ordered on
 * `createdAtMs`, the one date every writer stamps when it mints a record
 * (and `backfill-campaign-list-fields.mjs` stamped on the ones before).
 * Newest first, paged by the query itself.
 *
 * The Filters panel and the search box are the grid's; every clause and the
 * search word go onto that ONE query (AGL-3321, `campaignEmailsListQuery`),
 * so each page is a page of matches — an email that matches on page four is
 * found — and a combination one query cannot hold is refused by name above
 * the table, never answered over the rows that happen to be loaded.
 *
 * ## Under a site, and over the organization
 *
 * Sends are the org's. Under a site this lists the ones sent as that site;
 * on the organization's Emails page it lists every site's, with a Site column,
 * and every action on a row names the site that row is sent as — the only
 * site that can duplicate it, discard it or open its template. Creating one
 * there first asks which site it is sent as.
 */
export function EmailsListCard(props: EmailsListCardProps) {
  const { hostId, basePath } = props
  const firestore = useFirestore()
  const orgMount = useMarketingOrgMount()
  const { orgId } = useMarketingOrgId(hostId)
  // The sibling hub: a campaign's page belongs to the Marketing console —
  // over the org, the organization's own Marketing page the mount names.
  const siteMarketingHub = useMarketingHubPath()
  const marketingHub = orgMount ? orgMount.basePath : siteMarketingHub
  const router = useRouter()

  /*
   * The Filters panel and the search, bound to the grid. Held here rather
   * than in a saved view: this list keeps no views.
   */
  const declaration = campaignEmailsListQuery(!hostId)
  const gridFilter = useListGridFilter({
    selectFields: ['status', 'emailCampaignId', 'site'],
  })
  const emailPage = useListQuery<any>({
    collection: campaignSendsCollection(firestore, orgId),
    declaration,
    request: {
      clauses: emailCampaignQueryClauses(gridFilter.clauses),
      search: gridFilter.searchWords,
      base: campaignSendsScope(hostId),
    },
    deps: [firestore, orgId, hostId],
    idField: '$id',
  })
  const emails = emailPage.rows
  const filtering =
    gridFilter.clauses.length > 0 ||
    gridFilter.searchWords.some((word) => word.trim())

  /*
   * A message's own pages, beneath the Emails page this list is on — the
   * site's or the organization's. A template is a site's design, so over the
   * org it opens on the site the row is sent as.
   */
  const messagesPath = `${basePath}/messages`
  const emailHref = (email: any) => `${messagesPath}/${email.$id}`
  const routeContext = useRecordRouteContext()
  const templateHref = (email: any, templateScreenId: string): string | null => {
    const siteContext = siteRecordRouteContext(routeContext, orgMount, email?.hostId)
    return siteContext ? pluginRecordHref('emailTemplate', siteContext, templateScreenId) : null
  }
  /** The site a row is sent as, which every action on it must name. */
  const rowHostId = useCallback(
    (email: any): string | null =>
      hostId ?? (email?.hostId ? String(email.hostId) : null),
    [hostId],
  )
  const hostOfEmail = useMemo(
    () =>
      new Map<string, string | null>(
        emails.map((email: any) => [
          String(email.$id),
          email?.hostId ? String(email.hostId) : null,
        ]),
      ),
    [emails],
  )

  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()
  // Duplicate (AGL-2936): a new draft with the message and its design, and
  // nobody to send to until the person chooses — through the manage door,
  // which is the plugin's own.
  const manageForCopy = useCampaignManageApi(hostId)
  const duplicate = useDuplicateResource({
    hostId: hostId ?? '',
    perform: async ({ sourceId, name, attemptKey }) => {
      const { response, payload } = await manageForCopy({
        action: 'duplicate',
        campaignId: sourceId,
        name,
        attemptKey,
        // The copy is made as the site the source is sent as.
        ...(hostId ? {} : { hostId: hostOfEmail.get(sourceId) ?? undefined }),
      })
      if (!response.ok) throw new Error(payload?.error ?? 'Duplicate failed')
      return {
        id: String(payload.emailId),
        versionId: null,
        name: String(payload.name ?? name),
      }
    },
    onDuplicated: (_kind, copy) =>
      enqueueSnackbar(`Duplicated as “${copy.name}” — a draft with no audience yet`, {
        variant: 'success',
      }),
  })
  const manageApi = useCampaignManageApi(hostId)
  /** The email a discard is in flight for, so its row menu can say so. */
  const [discardingId, setDiscardingId] = useState('')

  /*==========================================
   * THROWING AWAY A DRAFT.
   *
   * The one removal this surface has, and it is deliberately the narrowest
   * one: an email that was never sent, whose record nobody outside the
   * console has ever seen. Everything else on this list is evidence — a sent
   * message's report is what a merchant answers a complaint with, and its id
   * is inside the HMAC of every unsubscribe footer it delivered — and a
   * scheduled one is withdrawn with Cancel, which keeps the record and takes
   * it off the clock.
   *
   * The menu already refuses anything but a draft, and so does the route.
   * That is not belt and braces: the state on screen is a snapshot that can
   * be seconds old, and the record can be claimed by `sendNow` in between.
   * The route's refusal is the one that decides, inside the transaction that
   * does the delete.
   *=========================================*/
  const handleDiscard = useCallback(
    async (email: any) => {
      if (discardingId) return
      const id = String(email?.$id ?? '')
      const name = String(email?.subject || email?.displayName || 'this draft')
      const agreed = await confirm({
        title: 'Discard this draft?',
        description:
          `${name} has not been sent to anybody, and discarding it removes ` +
          'it for good — the subject, the message and everything else ' +
          'written on it. There is no undo.',
        confirmationText: 'Discard',
      })
        .then(() => true)
        .catch(() => false)
      if (!agreed) return
      setDiscardingId(id)
      try {
        const { response, payload } = await manageApi({
          action: 'discardEmail',
          campaignId: id,
          ...(hostId ? {} : { hostId: rowHostId(email) ?? undefined }),
        })
        if (!response.ok) {
          return void enqueueSnackbar(
            payload?.error ?? 'This draft could not be discarded',
            { variant: 'warning', allowDuplicate: true },
          )
        }
        enqueueSnackbar('Draft discarded', {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('This draft could not be discarded', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setDiscardingId('')
      }
    },
    [confirm, discardingId, enqueueSnackbar, hostId, manageApi, rowHostId],
  )

  /**
   * What a message can be opened INTO, from the list.
   *
   * All three are places the message's own report already links to, moved one
   * screen earlier: the report itself, the campaign it belongs to, and the
   * template it was rendered from. A message need have neither of the last
   * two — one sent before campaigns grouped anything names no container, and
   * one composed inline was built from no template — so those entries are
   * shown DISABLED with the reason rather than hidden. A control that
   * disappears and a control that does not apply look identical, and only one
   * of them tells the reader which case they are in.
   *
   * DISCARD is the fourth entry and is offered on the same terms: a draft can
   * be thrown away, and nothing else can. It stays visible on a sent or
   * scheduled message carrying the reason it is refused, because that is the
   * honest answer to “how do I get rid of this” — and the route refuses it
   * too, so the menu is describing a rule rather than being one.
   */
  const rowActions = (email: any): RowActionsMenuItem[] => {
    const containerId = String(email?.[CAMPAIGN_SEND_CONTAINER_FIELD] ?? '')
    const templateScreenId = String(email?.templateScreenId ?? '')
    const state = String(email?.status ?? '')
    const templates = templateScreenId ? templateHref(email, templateScreenId) : null
    /** On the org hub, a send that names no site has nothing to act as. */
    const siteless = !rowHostId(email)
    const sitelessReason =
      'This email does not record which site it was sent as. Manage it from ' +
      'that site’s own Emails page.'
    return [
      {
        key: 'details',
        label: 'Open report',
        icon: <MdiIcon path={mdiEyeOutline.path} size={0.8} />,
        href: emailHref(email),
      },
      {
        key: 'campaign',
        label: 'Open its campaign',
        icon: <MdiIcon path={mdiBullhornOutline.path} size={0.8} />,
        // The campaign's page belongs to the Marketing console, so this one
        // href is built from the sibling hub rather than this surface's own.
        href:
          containerId && marketingHub
            ? `${marketingHub}/campaigns/${containerId}`
            : undefined,
        disabled: !containerId || !marketingHub,
        disabledReason: containerId
          ? 'This site’s console URL has not resolved yet'
          : 'Sent before campaigns grouped their emails, so it belongs to none',
      },
      {
        key: 'template',
        label: 'Open its template',
        icon: <MdiIcon path={mdiPaletteOutline.path} size={0.8} />,
        href: templates ?? undefined,
        disabled: !templates,
        disabledReason: templateScreenId
          ? 'This site’s console URL has not resolved yet'
          : 'This message was not built from a template',
      },
      {
        key: 'duplicate',
        label: DUPLICATE_MENU_LABEL,
        icon: <MdiIcon path={mdiContentCopy.path} size={0.8} />,
        disabled: siteless,
        disabledReason: sitelessReason,
        onClick: () =>
          duplicate.request('campaign', {
            id: String(email.$id),
            name: String(email?.displayName ?? email?.subject ?? ''),
          }),
      },
      {
        key: 'discard',
        label: 'Discard draft',
        icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
        destructive: true,
        disabled: siteless || state !== 'draft' || Boolean(discardingId),
        disabledReason: siteless
          ? sitelessReason
          : (DISCARD_REFUSAL[state] ?? 'Only a draft can be discarded'),
        onClick: () => void handleDiscard(email),
      },
    ]
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const campaignSendApi = useCampaignSendApi(hostId)
  /*
   * The sites a new email can be sent as, on the org hub. One site answers
   * the question itself, so the field is asked only when there is a choice.
   */
  const orgSites = useMemo(
    () => (orgMount ? orgSiteOptions(orgMount) : []),
    [orgMount],
  )
  const askSite = !hostId && orgSites.length > 1

  /*
   * The campaigns, read while the list is shown: the Campaign filter offers
   * them by name, and the create drawer offers them to file a new email
   * under. One capped read of the containers serves both.
   */
  const { data: campaignDocs } = useFirestoreCollection<any>(
    () => {
      const containers = campaignContainersQuery(firestore, orgId, hostId)
      return containers ? collectionCeiling(containers, CONTAINER_CEILING) : null
    },
    [firestore, orgId, hostId],
    { idField: '$id' },
  )
  const campaignOptions = useMemo(
    () =>
      [...(campaignDocs ?? [])]
        .map((campaign: any) => ({
          value: String(campaign.$id),
          label: String(campaign.name || 'Untitled campaign'),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [campaignDocs],
  )

  const filterOptions = useMemo(
    () => ({
      status: CAMPAIGN_SEND_STATUS_OPTIONS,
      emailCampaignId: [
        { value: SINGLE_SEND_FILTER_VALUE, label: 'Single send' },
        ...campaignOptions,
      ],
      ...(hostId ? {} : { site: orgSites }),
    }),
    [campaignOptions, hostId, orgSites],
  )

  /*==========================================
   * CREATE, THEN GO TO THE EMAIL'S OWN PAGE.
   *
   * The drawer collects only what it takes to MINT the record — the friendly
   * name, and the campaign it belongs to. Everything else about the email is
   * written on the email's own page, which is where a record is edited
   * throughout this console: a list page carries no form.
   *
   * The record is real from this moment: `/marketing/campaigns/{id}` resolves,
   * the row appears in the table below as a Draft, and the id it is created
   * under is the id it keeps when it is eventually sent. It costs nothing to
   * exist — the route reserves no allowance and moves no meter for a draft,
   * and the scheduled processor only ever picks up `scheduled`.
   *=========================================*/
  const handleCreate = useCallback(
    async (values: Record<string, any>) => {
      if (creating) return
      const sendAs =
        hostId ?? (askSite ? String(values.hostId ?? '') : orgSites[0]?.value)
      if (!sendAs) {
        return void enqueueSnackbar('Choose the site this email is sent as', {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
      /*
       * The organization hub offers every campaign, because the site is
       * chosen in the same form. An email can only join a campaign placed on
       * the site it is sent as — the send route refuses anything else — so
       * the mismatch is named here, where it can be fixed, rather than
       * arriving as the route's bare refusal. A site hub lists only the
       * campaigns placed on it, so there is nothing to check there.
       */
      const chosenCampaign =
        !hostId && values.emailCampaignId
          ? (campaignDocs ?? []).find(
              (campaign: any) =>
                String(campaign.$id) === String(values.emailCampaignId),
            )
          : null
      if (chosenCampaign && !campaignPlacedOnHost(chosenCampaign, sendAs)) {
        return void enqueueSnackbar(
          'That campaign is not offered on the site this email is sent as. ' +
            'Choose another, or add the site to the campaign first.',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      setCreating(true)
      try {
        const { response, payload } = await campaignSendApi({
          action: 'draft',
          ...(hostId ? {} : { hostId: sendAs }),
          displayName: String(values.displayName ?? '').trim(),
          ...(values.emailCampaignId
            ? { emailCampaignId: String(values.emailCampaignId) }
            : {}),
        })
        if (!response.ok || !payload?.campaignId) {
          return void enqueueSnackbar(
            payload?.error ?? 'This email could not be created',
            { variant: 'warning', allowDuplicate: true },
          )
        }
        setCreateOpen(false)
        /*
         * Straight to where it is WRITTEN. The drawer collected the name and
         * the campaign; the record now exists and holds nothing else, so the
         * next thing to do with it is compose it — and its own page is a
         * report of a send that has not happened.
         */
        router.push(`${messagesPath}/${payload.campaignId}/edit`)
      } catch (error) {
        console.error(error)
        enqueueSnackbar('This email could not be created', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setCreating(false)
      }
    },
    [
      askSite,
      campaignDocs,
      campaignSendApi,
      creating,
      enqueueSnackbar,
      hostId,
      messagesPath,
      orgSites,
      router,
    ],
  )

  /*
   * One row per message, in the query's order. The subject is a link AND the
   * row opens the report: a click handler cannot be middle-clicked or opened
   * in a new tab.
   */
  const columns: GridColDef[] = [
    {
      field: 'subject',
      headerName: 'Subject',
      flex: 1,
      minWidth: 220,
      valueGetter: (_value, row) => row.subject || 'Untitled email',
      renderCell: ({ row, value }) => (
        <AppLink
          href={emailHref(row)}
          // The row's own handler would fire too and push the same route
          // twice — one history entry per back press.
          onClick={(event: { stopPropagation: () => void }) =>
            event.stopPropagation()
          }
        >
          {value}
        </AppLink>
      ),
    },
    // Which site each row is sent as, on the org hub only.
    ...(orgMount
      ? [
          {
            field: 'site',
            headerName: 'Site',
            width: 150,
            valueGetter: (_value: unknown, row: any) =>
              row?.hostId ? orgSiteName(orgMount, row.hostId) : '—',
          } satisfies GridColDef,
        ]
      : []),
    {
      /*
       * WHAT THIS EMAIL IS DOING, not what field it stores.
       *
       * An email delivering an audience larger than one batch is written back
       * as `scheduled` between runs, so a chip rendering the status said
       * "Scheduled" about a send that had already reached five hundred people.
       * The derivation reads the counters beside the status and says which of
       * the two it is.
       */
      field: 'state',
      headerName: 'State',
      width: 150,
      valueGetter: (_value, row) => campaignSendDisplay(row).label,
      renderCell: ({ row }) => {
        const display = campaignSendDisplay(row)
        return (
          <Chip
            size="small"
            color={STATE_COLOR[display.state]}
            label={display.label}
          />
        )
      },
    },
    {
      field: 'when',
      headerName: 'When',
      width: 190,
      valueGetter: (_value, row) => emailListTimeMs(row),
      renderCell: ({ row }) => {
        const at = emailSendTimeMs(row)
        return at ? new Date(at).toLocaleString() : '—'
      },
    },
    ...(
      [
        ['recipients', 'Addressed'],
        ['opens', 'Opens'],
        ['clicks', 'Clicks'],
      ] as const
    ).map(
      ([stat, headerName]): GridColDef => ({
        field: stat,
        headerName,
        type: 'number',
        align: 'right',
        headerAlign: 'right',
        width: 110,
        valueGetter: (_value, row) => Number(row.stats?.[stat] ?? 0),
        valueFormatter: (value: number) => value.toLocaleString(),
      }),
    ),
    listActionsColumn(
      (row) => (
        <ListRowActions
          label={String(row.subject || 'Untitled email')}
          items={rowActions(row)}
        />
      ),
      { width: 72 },
    ),
  ]

  const gridColumns = listFilterGridColumns(
    columns,
    declaration.fields,
    filterOptions,
    EMAIL_FILTER_HEADERS,
  )
  /** Nothing stored at all — not a filter that matched nothing. */
  const none =
    emailPage.status !== 'loading' &&
    emails.length === 0 &&
    !filtering &&
    emailPage.page === 0

  return (
    <CardDisplay
      header={'Messages'}
      help={emailsDocsHelp}
      HeaderProps={{
        action: (
          <Button
            size="small"
            variant="contained"
            onClick={() => setCreateOpen(true)}
          >
            {'New email'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      {duplicate.dialog}
      <Stack spacing={2}>
        {none ? (
          <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
            <Typography variant="body2" color="text.secondary">
              {'Nothing has been sent or scheduled yet. Write one here, or ' +
                'from a campaign, and it appears in this list with its own ' +
                'report.'}
            </Typography>
            <Button variant="contained" onClick={() => setCreateOpen(true)}>
              {'New email'}
            </Button>
          </Stack>
        ) : (
          <>
            <ListFilterChips
              fields={declaration.fields}
              headers={EMAIL_FILTER_HEADERS}
              clauses={gridFilter.clauses}
              onChange={gridFilter.setClauses}
              options={filterOptions}
            />
            <ListQueryNotices
              refused={listQueryRefusals(emailPage.plan.refused, {
                fields: declaration.fields,
                headers: EMAIL_FILTER_HEADERS,
                options: filterOptions,
              })}
              notices={emailPage.plan.notices}
            />
            <ListTable
              aria-label="Messages"
              rows={emails}
              columns={gridColumns}
              rowHeight={TABLE_ROW_HEIGHT}
              onOpen={(_id, row) => router.push(emailHref(row))}
              loading={emailPage.status === 'loading'}
              /*
               * The panel and the search are the grid's; every clause and
               * the search word are on the list's query (AGL-3321), and the
               * grid neither filters nor sorts the page it is handed: the
               * query's one order, newest first, is the list's.
               */
              filterMode="server"
              filterModel={gridFilter.filterModel}
              onFilterModelChange={gridFilter.onFilterModelChange}
              quickFilter
              disableColumnSorting
              hideFooter
              initialState={{
                columns: {
                  columnVisibilityModel: hiddenFilterVisibility(
                    declaration.fields,
                    columns.map((column) => column.field),
                  ),
                },
              }}
              noRowsLabel="No messages match these filters"
            />
            <ListPagination
              page={emailPage.page}
              pageSize={emailPage.pageSize}
              rowCount={emails.length}
              hasMore={emailPage.hasMore}
              onPageChange={emailPage.setPage}
              onPageSizeChange={emailPage.setPageSize}
            />
          </>
        )}
      </Stack>
      {/*
        AN EMAIL WRITTEN HERE BELONGS TO A CAMPAIGN, OR TO NO CAMPAIGN.

        The second is a real answer and not a gap in the model. A send with no
        container is what the product has always had — every message that
        predates campaigns is one — and `campaignListRows` adopts each of them
        as a campaign of one at read time, which is the "Single send" chip on
        the campaigns table. So composing from this list mints nothing, files
        nothing, and requires nobody to invent a campaign first: it leaves the
        container empty, and the send that results is presented the way every
        containerless send already is.

        Offering the campaigns anyway is what stops the opposite mistake — a
        merchant who DOES have a spring campaign writing its third email into
        a single send that never joins the rollup.
      */}
      <CreateArtifactDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New email"
        submitLabel={creating ? 'Creating…' : 'Start writing'}
        includeDescription={false}
        onSubmit={handleCreate}
        extraFields={[
          ...(askSite
            ? [
                {
                  component: 'select',
                  name: 'hostId',
                  label: 'Send as',
                  isRequired: true,
                  initialValue: '',
                  helperText:
                    'The site this email is sent from — its sender, designs ' +
                    'and unsubscribe page',
                  disableDefaultOption: true,
                  options: orgSites,
                },
              ]
            : []),
          {
            component: 'select',
            name: 'emailCampaignId',
            label: 'Campaign',
            initialValue: '',
            helperText:
              'Leave this as a single send unless the email belongs with ' +
              'others',
            disableDefaultOption: true,
            options: [
              { value: '', label: 'Single send — not part of a campaign' },
              ...campaignOptions,
            ],
          },
        ]}
      />
    </CardDisplay>
  )
}
EmailsListCard.displayName = 'EmailsListCard'

export default EmailsListCard
