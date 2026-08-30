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
  mdiEyeOutline,
  mdiPaletteOutline,
} from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { CreateArtifactDrawer } from '@aglyn/shared-ui-jsx-forms'
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
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
import { collection } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { CAMPAIGN_SEND_CONTAINER_FIELD } from '../model/campaign-container'
import { emailSendTimeMs, emailStateLabel } from '../model/email-record'
import CampaignComposer from './campaign-composer'

/** How many messages one read of this list covers. */
const EMAIL_CEILING = 30

/** How many campaigns the create drawer offers to file a new email under. */
const CONTAINER_CEILING = 50

/**
 * What the create drawer is composing, or `null` when it is not open.
 *
 * `emailCampaignId` empty is a SINGLE SEND, not a missing value — see the
 * comment on the drawer below for why that is a real answer rather than a
 * deferred one.
 */
interface Composing {
  displayName: string
  emailCampaignId: string
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
 * There is no date field on every message. A sent one carries `sentAt` and a
 * scheduled one carries `sendAtMs`, written by two different branches of the
 * send path, and there is no `createdAt` at all — so `orderBy` on either
 * would not mis-sort this list, it would DROP half of it. `collectionCeiling`
 * reads a bounded window in document-id order and probes one past the
 * ceiling, so the rows are sorted here and the reader is told when there are
 * more. Ordering this list in Firestore needs one field every writer stamps,
 * which is a change to the send path and a backfill.
 *
 * The page is therefore a SLICE of a window this card already holds, not a
 * query: paging an id-ordered walk and re-sorting each page by date would run
 * in one order within a page and another across them.
 */
export function EmailsListCard(props: EmailsListCardProps) {
  const { hostId, basePath } = props
  const firestore = useFirestore()
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
  const emails = useMemo(
    () =>
      [...readEmails].sort(
        (a: any, b: any) => emailSendTimeMs(b) - emailSendTimeMs(a),
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
   */
  const rowActions = (email: any): RowActionsMenuItem[] => {
    const containerId = String(email?.[CAMPAIGN_SEND_CONTAINER_FIELD] ?? '')
    const templateScreenId = String(email?.templateScreenId ?? '')
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
        href: containerId
          ? `${basePath}/campaigns/${containerId}`
          : undefined,
        disabled: !containerId,
        disabledReason:
          'Sent before campaigns grouped their emails, so it belongs to none',
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

  const [createOpen, setCreateOpen] = useState(false)
  const [composing, setComposing] = useState<Composing | null>(null)

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

  const handleCreate = useCallback((values: Record<string, any>) => {
    setComposing({
      displayName: String(values.displayName ?? '').trim(),
      emailCampaignId: String(values.emailCampaignId ?? ''),
    })
    setCreateOpen(false)
  }, [])

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
                      <TableCell>
                        <Chip
                          size="small"
                          label={emailStateLabel(email.status)}
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

        {/*
          THE COMPOSER, ON DEMAND, EXACTLY AS THE CAMPAIGN PAGE MOUNTS IT.

          The create FORM is the drawer, per the console's rule; this is the
          working surface the form hands off to, and it opens listens of its
          own — the site's email designs, the org's lists and segments, the
          running experiments. A reader who came to look at the table must not
          pay for a composer they did not open, which is the same reason the
          campaign detail page keeps it behind a flag rather than mounting it
          with the page.
        */}
        {composing ? (
          <Box>
            <Divider sx={{ mb: 2 }} />
            <CampaignComposer
              hostId={hostId}
              displayName={composing.displayName}
              emailCampaignId={composing.emailCampaignId || undefined}
              onSent={() => setComposing(null)}
            />
          </Box>
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
        submitLabel="Start writing"
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
