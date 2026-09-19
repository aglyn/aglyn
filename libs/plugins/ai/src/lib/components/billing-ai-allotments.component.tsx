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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { mdiPencilOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useMemo, useState } from 'react'
import { AI_ALLOTMENT_ORG_SUBJECT, aiAllotmentState } from '../model/ai-allotments'
import type {
  AiAllotmentRowWire,
  AiAllotmentsHostWire,
  AiAllotmentsMemberWire,
} from '../usage/ai-usage-wire'
import { AiAllotmentEditor, type AiAllotmentValue } from './ai-allotment-editor.component'
import { saveAiAllotments, useAiAllotments } from './use-ai-allotments'

/** An allotment as a table cell reads it: used of credits, mode, models. */
export function aiAllotmentSummary(
  row: Pick<AiAllotmentRowWire, 'credits' | 'mode' | 'models' | 'used'> | null | undefined,
): string {
  if (!row) return '—'
  const parts: string[] = []
  if (row.credits !== null) {
    parts.push(`${row.used.toLocaleString()} of ${row.credits.toLocaleString()} (${row.mode})`)
  }
  if (row.models?.length) {
    parts.push(`${row.models.length} model${row.models.length === 1 ? '' : 's'}`)
  }
  return parts.join(' · ') || '—'
}

/** The color an allotment's figure reads in: warning from 80%, error at it. */
export function aiAllotmentTone(
  row: Pick<AiAllotmentRowWire, 'credits' | 'used'> | null | undefined,
): 'text.primary' | 'warning.main' | 'error.main' {
  if (!row || row.credits === null) return 'text.primary'
  const state = aiAllotmentState(row.used, row.credits)
  return state === 'reached' ? 'error.main' : state === 'warn' ? 'warning.main' : 'text.primary'
}

type Editing =
  | {
      kind: 'subjects'
      subjects: string[]
      title: string
      description: string
      initial: AiAllotmentValue | null
      removable: boolean
    }
  | { kind: 'everySite' }
  | { kind: 'restriction'; initial: AiAllotmentValue | null; removable: boolean }

const valueOf = (row: AiAllotmentRowWire | undefined): AiAllotmentValue | null =>
  row ? { credits: row.credits, mode: row.mode, models: row.models } : null

/**
 * A row of one of the three lists: the subject its allotment is stored under,
 * that subject's allotment when it has one, and `$id` — the id `ListTable`
 * selects by, which is the member's uid, the site's id, or the collaborator's
 * subject.
 */
type AllotmentListRow = {
  $id: string
  subject: string
  allotment: AiAllotmentRowWire | undefined
}
type MemberRow = AllotmentListRow & { member: AiAllotmentsMemberWire }
type SiteRow = AllotmentListRow & { host: AiAllotmentsHostWire }
type CollaboratorRow = AllotmentListRow & { name: string; site: string }

/** The allotment column: used of credits, in the tone its share has reached. */
const allotmentColumn = <Row extends AllotmentListRow>(): GridColDef<Row> => ({
  field: 'allotment',
  headerName: 'Allotment',
  flex: 1,
  minWidth: 200,
  sortable: false,
  valueGetter: (_value, row) => aiAllotmentSummary(row.allotment),
  renderCell: ({ row }) => (
    <Typography variant="body2" noWrap sx={{ color: aiAllotmentTone(row.allotment) }}>
      {aiAllotmentSummary(row.allotment)}
    </Typography>
  ),
})

const creditsColumn = <Row extends AllotmentListRow>(
  credits: (row: Row) => number,
): GridColDef<Row> => ({
  field: 'credits',
  headerName: 'Credits this month',
  type: 'number',
  align: 'right',
  headerAlign: 'right',
  width: 170,
  valueGetter: (_value, row) => credits(row),
  valueFormatter: (value: number) => value.toLocaleString(),
})

/**
 * AI ALLOTMENTS ON BILLING → USAGE (AGL-2942): who may draw how much of the
 * workspace's AI pool.
 *
 * Team members and sites, each with this month's credits and its allotment;
 * select several and set one allotment for all of them, or set the same
 * allotment on every site at once — the agency's "same for every client
 * site". Collaborators' allotments, which their sites' Users cards set, are
 * listed below. On a plan that offers it, the organization's model
 * restriction sits at the end.
 *
 * Read with `billing.view`; the controls appear with `billing.manage`, and
 * the route refuses a write without it whatever this card draws.
 */
export function BillingAiAllotments({ orgId }: { orgId?: string }) {
  const { data: user } = useUser()
  const allotments = useAiAllotments({ orgId })
  const [members, setMembers] = useState<string[]>([])
  const [sites, setSites] = useState<string[]>([])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const data = allotments.data
  const bySubject = useMemo(
    () => new Map((data?.allotments ?? []).map((row) => [row.subject, row])),
    [data],
  )

  if (allotments.status === 'refused') {
    return (
      <Alert severity="info">{'Seeing AI allotments requires the View billing permission.'}</Alert>
    )
  }
  if (allotments.status === 'error' && !data) {
    return (
      <Alert severity="warning">
        {'Could not read the AI allotments — a failed read, not an empty list.'}
      </Alert>
    )
  }
  if (!data || !orgId) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'Loading…'}
      </Typography>
    )
  }

  const canEdit = data.canEdit.billing
  const team = data.members.filter((member) => member.orgWide)
  const nameOf = (uid: string | null) =>
    data.members.find((member) => member.uid === uid)?.name ?? uid ?? ''
  const siteName = (hostId: string | null) =>
    data.hosts.find((host) => host.hostId === hostId)?.name ?? hostId ?? ''
  const collaborators = data.allotments.filter((row) => row.scope === 'collab')
  const restriction = bySubject.get(AI_ALLOTMENT_ORG_SUBJECT)
  /*
   * Each list pages, sorts and searches on its own, and a selection is kept
   * by member and site id rather than by row, so it survives a page change.
   */
  const teamRows: MemberRow[] = team.map((member) => ({
    $id: member.uid,
    subject: `member:${member.uid}`,
    allotment: bySubject.get(`member:${member.uid}`),
    member,
  }))
  const siteRows: SiteRow[] = data.hosts.map((host) => ({
    $id: host.hostId,
    subject: `host:${host.hostId}`,
    allotment: bySubject.get(`host:${host.hostId}`),
    host,
  }))
  const collaboratorRows: CollaboratorRow[] = collaborators.map((row) => ({
    $id: row.subject,
    subject: row.subject,
    allotment: row,
    name: nameOf(row.uid),
    site: siteName(row.hostId),
  }))

  const editSubjects = (subjects: string[], title: string, description: string) => {
    const rows = subjects.map((subject) => bySubject.get(subject))
    setError(null)
    setEditing({
      kind: 'subjects',
      subjects,
      title,
      description,
      initial: subjects.length === 1 ? valueOf(rows[0]) : null,
      removable: rows.every(Boolean),
    })
  }

  const run = async (body: Parameters<typeof saveAiAllotments>[1]) => {
    setBusy(true)
    setError(null)
    const result = await saveAiAllotments(user, body)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setEditing(null)
    setMembers([])
    setSites([])
  }
  const save = (value: AiAllotmentValue) => {
    if (!editing) return
    if (editing.kind === 'everySite') return void run({ orgId, everySite: value })
    if (editing.kind === 'restriction') {
      return void run(
        value.models
          ? { orgId, set: [{ subject: AI_ALLOTMENT_ORG_SUBJECT, ...value, credits: null }] }
          : { orgId, remove: [AI_ALLOTMENT_ORG_SUBJECT] },
      )
    }
    return void run({
      orgId,
      set: editing.subjects.map((subject) => ({ subject, ...value })),
    })
  }
  const remove = () => {
    if (!editing || editing.kind === 'everySite') return
    return void run({
      orgId,
      remove: editing.kind === 'restriction' ? [AI_ALLOTMENT_ORG_SUBJECT] : editing.subjects,
    })
  }
  const editMember = (row: MemberRow) =>
    editSubjects([row.subject], `AI allotment — ${row.member.name}`, 'Counts what this person draws across every site.')
  const editSite = (row: SiteRow) =>
    editSubjects([row.subject], `AI allotment — ${row.host.name}`, 'Counts what everyone draws on the site, together.')
  const editCollaborator = (row: CollaboratorRow) =>
    editSubjects(
      [row.subject],
      `AI allotment — ${row.name} on ${row.site}`,
      'Counts what this collaborator draws on this site.',
    )
  /** The one action a row has: set its allotment, or edit the one it has. */
  const editColumn = <Row extends AllotmentListRow>(label: (row: Row) => string, edit: (row: Row) => void) =>
    listActionsColumn((row: Row) => (
      <ListRowActions
        label={label(row)}
        quick={{
          icon: mdiPencilOutline.path,
          label: row.allotment ? 'Edit allotment' : 'Set allotment',
          onClick: () => edit(row),
        }}
        items={[]}
      />
    ))

  const teamColumns: GridColDef<MemberRow>[] = [
    { field: 'name', headerName: 'Member', flex: 1, minWidth: 180, valueGetter: (_value, row) => row.member.name },
    creditsColumn<MemberRow>((row) => row.member.credits),
    allotmentColumn<MemberRow>(),
    ...(canEdit ? [editColumn<MemberRow>((row) => row.member.name, editMember)] : []),
  ]
  const siteColumns: GridColDef<SiteRow>[] = [
    { field: 'name', headerName: 'Site', flex: 1, minWidth: 180, valueGetter: (_value, row) => row.host.name },
    creditsColumn<SiteRow>((row) => row.host.credits),
    allotmentColumn<SiteRow>(),
    ...(canEdit ? [editColumn<SiteRow>((row) => row.host.name, editSite)] : []),
  ]
  const collaboratorColumns: GridColDef<CollaboratorRow>[] = [
    { field: 'name', headerName: 'Collaborator', flex: 1, minWidth: 180 },
    { field: 'site', headerName: 'Site', flex: 1, minWidth: 160 },
    allotmentColumn<CollaboratorRow>(),
    ...(canEdit ? [editColumn<CollaboratorRow>((row) => `${row.name} on ${row.site}`, editCollaborator)] : []),
  ]

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {'Give a member or a whole site a share of the workspace’s AI credits each month. ' +
          'A hard allotment stops AI requests at the line; a soft one keeps going and alerts ' +
          'you at 80% and 100%. The workspace’s own credits still stop first.'}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {'Team members'}
        </Typography>
        {canEdit ? (
          <Button
            size="small"
            disabled={!members.length}
            onClick={() =>
              editSubjects(
                members.map((uid) => `member:${uid}`),
                members.length === 1 ? `AI allotment — ${nameOf(members[0])}` : `AI allotment — ${members.length} members`,
                'Counts what each person draws across every site.',
              )
            }
          >
            {members.length > 1 ? `Set for ${members.length} selected` : 'Set for selected'}
          </Button>
        ) : null}
      </Stack>
      <ListTable
        aria-label="Team members' AI allotments"
        rows={teamRows}
        columns={teamColumns}
        rowHeight={TABLE_ROW_HEIGHT}
        noRowsLabel="No team members"
        {...(canEdit
          ? { selectable: { selected: members, onChange: setMembers }, onOpen: (_id: string, row: MemberRow) => editMember(row) }
          : {})}
      />

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {'Sites'}
        </Typography>
        {canEdit ? (
          <>
            <Button
              size="small"
              disabled={!sites.length}
              onClick={() =>
                editSubjects(
                  sites.map((hostId) => `host:${hostId}`),
                  sites.length === 1 ? `AI allotment — ${siteName(sites[0])}` : `AI allotment — ${sites.length} sites`,
                  'Counts what everyone draws on the site, together.',
                )
              }
            >
              {sites.length > 1 ? `Set for ${sites.length} selected` : 'Set for selected'}
            </Button>
            <Button
              size="small"
              disabled={!data.hosts.length}
              onClick={() => {
                setError(null)
                setEditing({ kind: 'everySite' })
              }}
            >
              {'Same for every client site'}
            </Button>
          </>
        ) : null}
      </Stack>
      <ListTable
        aria-label="Sites' AI allotments"
        rows={siteRows}
        columns={siteColumns}
        rowHeight={TABLE_ROW_HEIGHT}
        noRowsLabel="No sites"
        {...(canEdit
          ? { selectable: { selected: sites, onChange: setSites }, onOpen: (_id: string, row: SiteRow) => editSite(row) }
          : {})}
      />

      {collaborators.length ? (
        <>
          <Typography variant="subtitle2">{'Site collaborators'}</Typography>
          <ListTable
            aria-label="Site collaborators' AI allotments"
            rows={collaboratorRows}
            columns={collaboratorColumns}
            rowHeight={TABLE_ROW_HEIGHT}
            {...(canEdit ? { onOpen: (_id: string, row: CollaboratorRow) => editCollaborator(row) } : {})}
          />
        </>
      ) : null}

      {data.restrictionAvailable ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="body2" sx={{ flexGrow: 1 }}>
            {'Models for the whole organization: '}
            {restriction?.models?.length
              ? data.models
                  .filter((model) => restriction.models?.includes(model.id))
                  .map((model) => model.label)
                  .join(', ') || `${restriction.models.length} models`
              : 'every model the plan offers'}
          </Typography>
          {canEdit ? (
            <Button
              size="small"
              onClick={() => {
                setError(null)
                setEditing({ kind: 'restriction', initial: valueOf(restriction), removable: Boolean(restriction) })
              }}
            >
              {'Restrict models'}
            </Button>
          ) : null}
        </Stack>
      ) : null}

      <AiAllotmentEditor
        open={editing !== null}
        title={
          editing?.kind === 'everySite'
            ? 'Same allotment for every site'
            : editing?.kind === 'restriction'
              ? 'Models for the whole organization'
              : (editing?.title ?? '')
        }
        description={
          editing?.kind === 'everySite'
            ? `Sets this allotment on all ${data.hosts.length} sites, replacing any each one had.`
            : editing?.kind === 'restriction'
              ? 'Every member, collaborator and Auto choose only among these models.'
              : editing?.description
        }
        initial={editing && editing.kind !== 'everySite' ? editing.initial : null}
        models={data.models}
        modelsOnly={editing?.kind === 'restriction'}
        poolLimit={data.pool.limit}
        busy={busy}
        error={error}
        onClose={() => setEditing(null)}
        onSave={save}
        onRemove={editing && editing.kind !== 'everySite' && editing.removable ? remove : undefined}
      />
    </Stack>
  )
}
BillingAiAllotments.displayName = 'BillingAiAllotments'

/**
 * The card on Billing → Usage, through the `orgBillingUsage` zone, beneath
 * the table of who drew the credits. Registered with `billing.view`.
 */
export function AiAllotmentsCard(props: { orgId?: string }) {
  return (
    <div id="ai-allotments">
      <CardDisplay
        header={'AI allotments'}
        help={pluginDocsHelp('billing', {
          anchor: '#ai-allotments',
          excerpt:
            'A monthly share of the workspace’s AI credits for a member or a site — ' +
            'hard or soft, with an optional list of models.',
        })}
        contentGutterX
        contentGutterY
      >
        <BillingAiAllotments orgId={props.orgId} />
      </CardDisplay>
    </div>
  )
}
AiAllotmentsCard.displayName = 'AiAllotmentsCard'

export default AiAllotmentsCard
