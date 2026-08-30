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
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { CreateArtifactDrawer } from '@aglyn/shared-ui-jsx-forms'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { collection } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import {
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
  hostId: string
  /** The emails hub URL, so a row can link to the message's own page. */
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
 * Every writer now stamps a `createdAtMs`, which is the field this list could
 * eventually be ordered on in Firestore — but not yet, and for the same
 * reason: messages written before that stamp existed do not carry it, and
 * `orderBy` would drop every one of them. Server ordering waits on
 * `tools/scripts/backfill-email-created-at.mjs` having run.
 *
 * The page is therefore a SLICE of a window this card already holds, not a
 * query: paging an id-ordered walk and re-sorting each page by date would run
 * in one order within a page and another across them.
 */
export function EmailsListCard(props: EmailsListCardProps) {
  const { hostId, basePath } = props
  const firestore = useFirestore()
  // The sibling hub: a campaign's page belongs to the Marketing console.
  const marketingHub = useMarketingHubPath()
  const router = useRouter()

  const { data: emailDocs } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'campaigns'),
        EMAIL_CEILING,
      ),
    [firestore, hostId],
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

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visible = useMemo(
    () => emails.slice(page * pageSize, page * pageSize + pageSize),
    [emails, page, pageSize],
  )

  const emailHref = (email: any) => `${basePath}/emails/${email.$id}`

  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()
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
    [confirm, discardingId, enqueueSnackbar, manageApi],
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
        href: templateScreenId
          ? `${basePath}/templates/${templateScreenId}`
          : undefined,
        disabled: !templateScreenId,
        disabledReason: 'This message was not built from a template',
      },
      {
        key: 'discard',
        label: 'Discard draft',
        icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
        destructive: true,
        disabled: state !== 'draft' || Boolean(discardingId),
        disabledReason: DISCARD_REFUSAL[state] ?? 'Only a draft can be discarded',
        onClick: () => void handleDiscard(email),
      },
    ]
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const campaignSendApi = useCampaignSendApi(hostId)

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
    () =>
      createOpen
        ? collectionCeiling(
            collection(firestore, 'hosts', hostId, 'emailCampaigns'),
            CONTAINER_CEILING,
          )
        : null,
    [firestore, hostId, createOpen],
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
      setCreating(true)
      try {
        const { response, payload } = await campaignSendApi({
          action: 'draft',
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
        router.push(`${basePath}/emails/${payload.campaignId}`)
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
    [basePath, campaignSendApi, creating, enqueueSnackbar, router],
  )

  return (
    <CardDisplay
      header={'Emails'}
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
          <>
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
                {visible.map((email: any) => {
                  const at = emailSendTimeMs(email)
                  const display = campaignSendDisplay(email)
                  return (
                    <TableRow
                      key={email.$id}
                      hover
                      onClick={() => router.push(emailHref(email))}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        {/*
                          The row's own handler would fire too and push the
                          same route twice — one history entry per back press.
                         */}
                        <AppLink
                          href={emailHref(email)}
                          onClick={(event: { stopPropagation: () => void }) =>
                            event.stopPropagation()
                          }
                        >
                          {email.subject || 'Untitled email'}
                        </AppLink>
                      </TableCell>
                      {/*
                        WHAT THIS EMAIL IS DOING, not what field it stores.

                        An email delivering an audience larger than one batch
                        is written back as `scheduled` between runs, so a chip
                        rendering the status said "Scheduled" about a send
                        that had already reached five hundred people. The
                        derivation reads the counters beside the status and
                        says which of the two it is.
                       */}
                      <TableCell>
                        <Chip
                          size="small"
                          color={STATE_COLOR[display.state]}
                          label={display.label}
                        />
                      </TableCell>
                      <TableCell>
                        {at ? new Date(at).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell align="right">
                        {Number(
                          email.stats?.recipients ?? 0,
                        ).toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        {Number(email.stats?.opens ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        {Number(email.stats?.clicks ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ width: 56 }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <RowActionsMenu
                          label={String(email.subject || 'Untitled email')}
                          items={rowActions(email)}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={visible.length}
              count={emails.length}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setPageSize(next)
                setPage(0)
              }}
            />
          </>
        )}
        {truncated ? (
          <Alert severity="info">
            {`Showing ${EMAIL_CEILING} messages. This site has sent or ` +
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
