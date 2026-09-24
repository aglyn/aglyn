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
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { CreateArtifactDrawer } from '@aglyn/shared-ui-jsx-forms'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import {
  DUPLICATE_MENU_LABEL,
  useDuplicateResource,
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
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
import { useMarketingHubPath } from './use-marketing-hub-path'
import { campaignContainersQuery, campaignSendsQuery } from './campaign-queries'
import {
  orgSiteHubPath,
  orgSiteName,
  orgSiteOptions,
  useMarketingOrgId,
  useMarketingOrgMount,
} from './marketing-org-mount'

/** How many messages one read of this list covers. */
const EMAIL_CEILING = 30

/** How many campaigns the create drawer offers to file a new email under. */
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
 * ## Ordered in the browser, deliberately
 *
 * No SEND date is on every message: a sent one carries `sentAt` and a
 * scheduled one carries `sendAtMs`, written by two different branches of the
 * send path, and a draft carries neither — so `orderBy` on either would not
 * mis-sort this list, it would DROP half of it. `collectionCeiling` reads a
 * bounded window in document-id order and probes one past the ceiling, so the
 * rows are sorted here and the reader is told when there are more.
 *
 * Every writer stamps a `createdAtMs`, which is the field this list could be
 * ordered on in Firestore. Moving it there is a query change with the same
 * hazard as the two above — `orderBy` drops a document missing the field —
 * so it needs the corpus proven to carry one, not just the writers.
 *
 * The page is therefore a SLICE of a window this card already holds, not a
 * query: paging an id-ordered walk and re-sorting each page by date would run
 * in one order within a page and another across them.
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

  const { data: emailDocs } = useFirestoreCollection<any>(
    () => {
      const sends = campaignSendsQuery(firestore, orgId, hostId)
      return sends ? collectionCeiling(sends, EMAIL_CEILING) : null
    },
    [firestore, orgId, hostId],
    { idField: '$id' },
  )
  const { rows: readEmails, truncated } = ceilingedWindow<any>(
    emailDocs,
    EMAIL_CEILING,
  )
  /*
   * Newest first on the time each message SITS at — its send time where it
   * has one, its creation where it does not.
   *
   * A draft has neither `sentAt` nor `sendAtMs`, so sorting on the send time
   * alone gave every draft the key 0 and filed the email a merchant is in the
   * middle of writing at the very bottom of the list, behind whatever paging
   * it has. `emailListTimeMs` is the same ordering with that one gap closed;
   * a SENT message still orders by when it went out, never by when it was
   * drafted.
   */
  const emails = useMemo(
    () =>
      [...readEmails].sort(
        (a: any, b: any) => emailListTimeMs(b) - emailListTimeMs(a),
      ),
    [readEmails],
  )

  /*
   * A message's own pages, beneath the Emails page this list is on — the
   * site's or the organization's. A template is a site's design, so over the
   * org it opens on the site the row is sent as.
   */
  const messagesPath = `${basePath}/messages`
  const emailHref = (email: any) => `${messagesPath}/${email.$id}`
  const templatesHub = (email: any): string | null =>
    orgMount ? orgSiteHubPath(orgMount, email?.hostId, 'emails') : basePath
  /** The site a row is sent as, which every action on it must name. */
  const rowHostId = useCallback(
    (email: any): string | null =>
      hostId ?? (email?.hostId ? String(email.hostId) : null),
    [hostId],
  )
  const hostOfEmail = useMemo(
    () =>
      new Map<string, string | null>(
        readEmails.map((email: any) => [
          String(email.$id),
          email?.hostId ? String(email.hostId) : null,
        ]),
      ),
    [readEmails],
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
    const templates = templatesHub(email)
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
        href:
          templateScreenId && templates
            ? `${templates}/templates/${templateScreenId}`
            : undefined,
        disabled: !templateScreenId || !templates,
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
   * The campaigns a new email may be filed under, read only while the drawer
   * is OPEN.
   *
   * A null query opens no listener, so the list costs what it always did until
   * somebody asks to write something. Mounting this unconditionally would put
   * a second collection read on every reader who came to look at the table,
   * which is the cost the whole surface is routed to avoid.
   */
  const { data: campaignDocs } = useFirestoreCollection<any>(
    () => {
      const containers = createOpen
        ? campaignContainersQuery(firestore, orgId, hostId)
        : null
      return containers ? collectionCeiling(containers, CONTAINER_CEILING) : null
    },
    [firestore, orgId, hostId, createOpen],
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
   * One row per message, in the order above; the whole window is in hand, so
   * the grid pages it. The subject is a link AND the row opens the report: a
   * click handler cannot be middle-clicked or opened in a new tab.
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
      // Sorted on the time the list is ordered by, so a draft sorts by its
      // creation rather than as the oldest thing on the page.
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
        {emails.length === 0 ? (
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
          <ListTable
            aria-label="Messages"
            rows={emails}
            columns={columns}
            rowHeight={TABLE_ROW_HEIGHT}
            onOpen={(_id, row) => router.push(emailHref(row))}
          />
        )}
        {truncated ? (
          <Alert severity="info">
            {`Showing ${EMAIL_CEILING} messages. ${
              hostId ? 'This site' : 'This organization'
            } has sent or ` +
              'scheduled more than that, and the rest are not in this list.'}
          </Alert>
        ) : null}
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
