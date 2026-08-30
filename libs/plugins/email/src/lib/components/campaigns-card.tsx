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

import { buildRoute, createResourceUid, pluginDocsHelp, Route } from '@aglyn/aglyn'
/*
 * The MODULE, not the barrel, for the two PURE helpers — a spec that mocks
 * `@aglyn/tenant-feature-instance` wholesale to stage its Firestore hooks
 * would otherwise lose them, and neither is a hook.
 */
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { mdiEyeOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
import { collection, doc, limit, query, setDoc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  campaignListRows,
  type CampaignAggregate,
  type CampaignListRow,
  type CampaignSend,
  type EmailCampaign,
} from '../model'
import { CreateArtifactDrawer } from '@aglyn/shared-ui-jsx-forms'
import { activeEmailTopics } from '@aglyn/aglyn'
import { useOrgEmailTopics } from './use-org-email-topics'

/**
 * How many sends the list reads.
 *
 * A CEILING, not a page size — see the query, which explains why this list
 * cannot be paged by the server until a send carries one date field every
 * writer stamps.
 */
const CAMPAIGN_CEILING = 30

/** How many campaign containers the list reads. */
const CONTAINER_CEILING = 50

const formatDay = (ms: number | null): string =>
  ms === null ? '' : new Date(ms).toLocaleDateString()

/** A rolled-up figure, or an em dash where nothing recorded one. */
const figure = (value: CampaignAggregate): string =>
  value.value === null ? '—' : value.value.toLocaleString()

const WINDOW_LABEL: Record<CampaignListRow['windowState'], string> = {
  undated: 'No dates',
  upcoming: 'Upcoming',
  running: 'Running',
  ended: 'Ended',
}

/**
 * THE CAMPAIGNS LIST.
 *
 * A campaign is a container — a name, a window, the lists it is aimed at, and
 * the emails sent inside it — so this is a table of campaigns and not of
 * messages. Composing is not here: a message belongs to a campaign, and the
 * campaign's own page is where one is written.
 *
 * The rows come from two collections, and the second is why this reads
 * without a migration. `emailCampaigns` holds the containers.
 * `campaigns` holds every send, including thousands written before containers
 * existed; those carry no container id, and `campaignListRows` presents each
 * as a campaign of one rather than dropping it. Nothing is rewritten, so no
 * unsubscribe link and no pasted report URL stops resolving.
 */
export function HostCampaignsCard(props: {
  hostId: string
  /**
   * The emails hub URL, when the caller already has it.
   *
   * Resolved from the host route when it does not: the inbox console page
   * embeds this card on a tab of its own, and its `basePath` names the INBOX
   * hub. Deriving one hub's URL from another's by string surgery is the kind
   * of link that breaks silently when a surface moves.
   */
  basePath?: string
}) {
  const { hostId, basePath } = props
  const firestore = useFirestore()
  const router = useRouter()
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)
  const hubPath =
    basePath ??
    (orgSlug && subdomain
      ? buildRoute(Route.HOST_PLUGIN, {
          orgSlug,
          host: subdomain,
          pluginSlug: 'emails',
        })
      : null)
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { scope: dataScope } = useOrgDataScope({ hostId })

  /*
   * ORDERED AND CEILINGED, and not orderable on any DATE.
   *
   * No field here is on every send: a sent one is written `{status:'sent',
   * sentAt}` and a scheduled one `{status:'scheduled', sendAtMs}`, by the two
   * branches of `campaign-send.ts`, and there is no `createdAt` at all.
   * `orderBy` on either would not mis-sort the list, it would DROP half of it.
   *
   * A bare `limit(30)` is answered in DOCUMENT-ID order, so the window is
   * thirty sends chosen by id and then sorted by date, which reads as the most
   * recent thirty and is not. `collectionCeiling` returns that same thirty —
   * document-id order is what the bare cap already gave — but it says so,
   * which is what stops the next edit reaching for `sentAt`, and it probes one
   * past the ceiling so the reader is told the history is longer.
   */
  const { data: sendDocs } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'campaigns'),
        CAMPAIGN_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: readSends, truncated: sendsTruncated } = ceilingedWindow<any>(
    sendDocs,
    CAMPAIGN_CEILING,
  )

  const { data: campaignDocs } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'emailCampaigns'),
        CONTAINER_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: readCampaigns, truncated: campaignsTruncated } =
    ceilingedWindow<any>(campaignDocs, CONTAINER_CEILING)

  // Org email lists, so a row can name what it is aimed at rather than
  // showing ids.
  const { data: listDocs } = useFirestoreCollection<any>(
    () =>
      dataScope
        ? query(
            collection(firestore, dataScope[0], dataScope[1], 'lists'),
            limit(50),
          )
        : null,
    [firestore, dataScope],
    { idField: '$id' },
  )
  // The org's topic catalog, so a campaign can be created under the stream it
  // belongs to rather than defaulting its emails to `marketing`.
  const { topics } = useOrgEmailTopics(hostId)
  const topicOptions = useMemo(
    () =>
      activeEmailTopics(topics).map((topic) => ({
        value: topic.id,
        label: topic.name,
      })),
    [topics],
  )

  const listNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const list of listDocs ?? []) {
      names.set(String(list.$id), String(list.name ?? list.$id))
    }
    return names
  }, [listDocs])

  const listOptions = useMemo(
    () =>
      (listDocs ?? []).map((list: any) => ({
        value: String(list.$id),
        label: String(list.name ?? list.$id),
      })),
    [listDocs],
  )

  const rows = useMemo(() => {
    const campaigns = (readCampaigns as EmailCampaign[]).filter(
      (campaign: any) => !campaign.deletedAt,
    )
    return campaignListRows(
      campaigns,
      readSends as CampaignSend[],
      Date.now(),
    ).map((row) => ({ ...row, $id: row.id }))
  }, [readCampaigns, readSends])

  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const openCampaign = useCallback(
    (id: string) => {
      if (hubPath) void router.push(`${hubPath}/campaigns/${id}`)
    },
    [hubPath, router],
  )

  const handleCreate = useCallback(
    async (values: Record<string, any>) => {
      if (creating) return
      /*
       * `displayName` is the shared drawer's own field, and every artifact
       * create in the console collects a name under that key. The campaign
       * stores it as `name` — the container has one name and no second
       * internal label — so the mapping happens here rather than by giving
       * this one drawer a field the others do not have.
       */
      const name = String(values.displayName ?? '').trim()
      if (!name) return
      const startAtMs = values.startAt ? Date.parse(String(values.startAt)) : null
      const endAtMs = values.endAt ? Date.parse(String(values.endAt)) : null
      // Refused here rather than stored and rendered as a campaign that ends
      // before it starts, which no window state describes.
      if (startAtMs !== null && endAtMs !== null && endAtMs < startAtMs) {
        return setCreateError('The end date is before the start date')
      }
      setCreating(true)
      setCreateError(null)
      const id = createResourceUid()
      try {
        await setDoc(doc(firestore, 'hosts', hostId, 'emailCampaigns', id), {
          name,
          ...(Number.isFinite(startAtMs) && startAtMs !== null
            ? { startAtMs }
            : {}),
          ...(Number.isFinite(endAtMs) && endAtMs !== null ? { endAtMs } : {}),
          listIds: Array.isArray(values.listIds)
            ? values.listIds.map(String)
            : [],
          ...(values.topicId ? { topicId: String(values.topicId) } : {}),
          createdAtMs: Date.now(),
          createdBy: String((user as any)?.uid ?? ''),
        })
        setCreateOpen(false)
        openCampaign(id)
      } catch (error) {
        console.error(error)
        setCreateError('The campaign could not be created')
        enqueueSnackbar('Could not create the campaign', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setCreating(false)
      }
    },
    [creating, firestore, hostId, user, enqueueSnackbar, openCampaign],
  )

  const campaignHref = useCallback(
    (id: string) => (hubPath ? `${hubPath}/campaigns/${id}` : null),
    [hubPath],
  )

  const columns = useMemo(
    () => [
      {
        field: 'name',
        headerName: 'Campaign',
        flex: 1,
        minWidth: 180,
        renderCell: ({ row }: any) => (
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', minWidth: 0 }}
          >
            {/*
              The name is a real anchor as well as the row being clickable, so
              a campaign can be middle-clicked into a tab or copied out of the
              context menu — affordances a row handler cannot offer. The grid's
              own row click fires too, so the link stops the event rather than
              pushing the same route twice.
             */}
            {campaignHref(row.id) ? (
              <AppLink
                href={campaignHref(row.id) as string}
                onClick={(event: { stopPropagation: () => void }) =>
                  event.stopPropagation()
                }
              >
                <Typography variant="body2" noWrap>
                  {row.name}
                </Typography>
              </AppLink>
            ) : (
              <Typography variant="body2" noWrap>
                {row.name}
              </Typography>
            )}
            {row.legacy ? (
              <Chip
                size="small"
                variant="outlined"
                label="Single send"
                title={
                  'Sent before campaigns grouped their emails. Its report ' +
                  'and its unsubscribe links are unchanged.'
                }
              />
            ) : null}
          </Stack>
        ),
      },
      {
        field: 'windowState',
        headerName: 'Window',
        width: 170,
        renderCell: ({ row }: any) => {
          const start = formatDay(row.startAtMs)
          const end = formatDay(row.endAtMs)
          const range =
            start && end && start !== end
              ? `${start} – ${end}`
              : start || end || ''
          return (
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {WINDOW_LABEL[row.windowState as CampaignListRow['windowState']]}
              </Typography>
              {range ? (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {range}
                </Typography>
              ) : null}
            </Stack>
          )
        },
      },
      {
        field: 'listIds',
        headerName: 'Lists',
        width: 160,
        sortable: false,
        renderCell: ({ row }: any) => (
          <Typography variant="body2" noWrap>
            {row.listIds.length
              ? row.listIds
                  .map((id: string) => listNames.get(id) ?? id)
                  .join(', ')
              : '—'}
          </Typography>
        ),
      },
      /*
        THE FOUR COUNTS, RIGHT-ALIGNED HEAD AND BODY.
        A figure is read by its last digit, so a column of them lines up on
        the right or it does not line up at all. `headerAlign` has to be said
        as well as `align`: a grid column defaults its header to the column
        type's alignment rather than to the cell's, which is how these came to
        sit with left headers over figures nobody could compare down the page.
       */
      {
        field: 'emails',
        headerName: 'Emails',
        width: 110,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ row }: any) => (
          <Typography variant="body2">
            {row.rollup.scheduled
              ? `${row.rollup.sends} · ${row.rollup.scheduled} scheduled`
              : String(row.rollup.sends)}
          </Typography>
        ),
      },
      {
        field: 'sent',
        headerName: 'Sent',
        width: 100,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ row }: any) => (
          <Typography variant="body2">{figure(row.rollup.sent)}</Typography>
        ),
      },
      {
        field: 'opens',
        headerName: 'Opens',
        width: 100,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ row }: any) => (
          <Typography variant="body2">{figure(row.rollup.opens)}</Typography>
        ),
      },
      {
        field: 'clicks',
        headerName: 'Clicks',
        width: 100,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ row }: any) => (
          <Typography variant="body2">{figure(row.rollup.clicks)}</Typography>
        ),
      },
      /*
        THE TRAILING CLUSTER, through the grid's own actions column.
        `listActionsColumn` is what every other grid list in the console
        renders, so the reader cannot tell which family of table they are
        standing in — the hand-rolled tables on this surface reach the same
        `RowActionsMenu` from the other direction.

        Opening the campaign is the only action a campaign row has today:
        there is no campaign edit page and no delete path, so the menu is one
        entry rather than several invented ones. It is restated here even
        though the row click does the same thing, for the reason the screens
        table restates its own: the menu is where a row's actions are NAMED,
        and an action absent from it reads as an action the row does not have.
       */
      listActionsColumn(
        (row: any) => (
          <ListRowActions
            label={String(row.name ?? row.id)}
            items={[
              {
                key: 'details',
                label: 'Open campaign',
                icon: <MdiIcon path={mdiEyeOutline.path} size={0.8} />,
                href: campaignHref(row.id) ?? undefined,
                disabled: !campaignHref(row.id),
                disabledReason: campaignHref(row.id)
                  ? undefined
                  : 'This site’s console URL has not resolved yet',
              },
            ]}
          />
        ),
        { width: 72 },
      ),
    ],
    [listNames, campaignHref],
  )

  return (
    <CardDisplay
      header={'Campaigns'}
      help={pluginDocsHelp('emailCampaigns', {
        anchor: '#campaigns-group-emails',
        excerpt:
          'A campaign groups the emails you send to a set of lists over a ' +
          'window of dates. Open one to write and send an email inside it.',
      })}
      HeaderProps={{
        action: (
          <Button
            size="small"
            variant="contained"
            disabled={creating}
            onClick={() => {
              setCreateError(null)
              setCreateOpen(true)
            }}
          >
            {creating ? 'Creating…' : 'Create campaign'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <ListTable
          rows={rows}
          columns={columns as any}
          onOpen={(id) => openCampaign(id)}
          noRowsLabel="No campaigns yet"
          noRowsDescription="A campaign groups the emails you send to a set of lists."
          noRowsAction={
            <Button variant="contained" onClick={() => setCreateOpen(true)}>
              {'Create campaign'}
            </Button>
          }
        />
        {sendsTruncated || campaignsTruncated ? (
          <Alert severity="info">
            {`Showing the most recent ${CONTAINER_CEILING} campaigns and ` +
              `${CAMPAIGN_CEILING} sends. This site has more — the ones ` +
              'listed are not necessarily the most recent, because a send ' +
              'carries no date field that every writer stamps.'}
          </Alert>
        ) : null}
      </Stack>
      {/*
        The console's own create drawer, from the shared library rather than a
        second one that looks like it. What a campaign collects beyond a name
        is its window, the lists it is aimed at and the stream its emails open
        on; the description box is left off because the container stores none,
        and a field the writer discards is worse than one never offered.
       */}
      <CreateArtifactDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create campaign"
        submitLabel="Create campaign"
        includeDescription={false}
        onSubmit={handleCreate}
        extraFields={campaignFields(listOptions, topicOptions)}
        errorSlot={
          createError ? (
            <Alert severity="error" sx={{ mt: 2, mb: 1 }}>
              {createError}
            </Alert>
          ) : null
        }
      />
    </CardDisplay>
  )
}
/**
 * What a campaign collects beyond its name.
 *
 * Data-driven-forms field descriptors, built from the org's own lists and
 * topics so the drawer offers what this workspace actually has. Dates are
 * plain `date` inputs: a campaign window is a day at each end, and a time of
 * day would be a precision the model does not carry.
 */
function campaignFields(
  lists: Array<{ value: string; label: string }>,
  topics: Array<{ value: string; label: string }>,
): any[] {
  return [
    {
      component: 'text-field',
      name: 'startAt',
      label: 'Starts',
      type: 'date',
      helperText: 'When the campaign window opens',
      // The label would otherwise sit on top of the browser's own date
      // placeholder, which a date input paints whether or not it is focused.
      InputLabelProps: { shrink: true },
    },
    {
      component: 'text-field',
      name: 'endAt',
      label: 'Ends',
      type: 'date',
      helperText: 'Leave empty for an open-ended campaign',
      InputLabelProps: { shrink: true },
    },
    {
      component: 'select',
      name: 'listIds',
      label: 'Lists',
      multiple: true,
      initialValue: [],
      // A campaign with no list is legitimate: its emails can go to leads, to
      // site members, or to a segment. The lists are what it is AIMED at.
      helperText: 'The lists this campaign is aimed at',
      disableDefaultOption: true,
      options: lists,
    },
    {
      component: 'select',
      name: 'topicId',
      label: 'Topic',
      helperText: 'The stream its emails open on — each one can change it',
      disableDefaultOption: true,
      options: topics,
    },
  ]
}

HostCampaignsCard.displayName = 'HostCampaignsCard'

export default HostCampaignsCard
