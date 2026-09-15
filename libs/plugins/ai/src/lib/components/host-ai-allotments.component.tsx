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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Button, Stack, Tooltip, Typography } from '@mui/material'
import { useState } from 'react'
import { AiAllotmentEditor, type AiAllotmentValue } from './ai-allotment-editor.component'
import { aiAllotmentSummary, aiAllotmentTone } from './billing-ai-allotments.component'
import { saveAiAllotments, useAiAllotments } from './use-ai-allotments'

/** A row as the collaborators table hands it to a column. */
interface CollaboratorRow {
  $id?: string
  uid?: string
  status?: string
}

interface EditState {
  subject: string
  title: string
  initial: AiAllotmentValue | null
  removable: boolean
}

/** One dialog's save and remove, shared by the column and the site card. */
function useAllotmentEditing() {
  const { data: user } = useUser()
  const [editing, setEditing] = useState<EditState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (body: Parameters<typeof saveAiAllotments>[1]) => {
    setBusy(true)
    setError(null)
    const result = await saveAiAllotments(user, body)
    setBusy(false)
    if (result.ok) setEditing(null)
    else setError(result.error)
  }
  const open = (state: EditState) => {
    setError(null)
    setEditing(state)
  }
  return { editing, busy, error, run, open, close: () => setEditing(null) }
}

/**
 * THE SITE COLLABORATORS TABLE'S AI ALLOTMENT COLUMN (AGL-2942): what each
 * collaborator may draw on THIS site each month. Set here by a manager with
 * `billing.manage` or by the site's admin — never by the collaborator on
 * themselves. A team member's row reads a dash: their allotment spans every
 * site and is set on their own page.
 */
export function AiCollaboratorAllotmentHeader() {
  return (
    <Tooltip title="The share of the workspace’s AI credits each collaborator may draw on this site each month.">
      <span>{'AI allotment'}</span>
    </Tooltip>
  )
}
AiCollaboratorAllotmentHeader.displayName = 'AiCollaboratorAllotmentHeader'

export function AiCollaboratorAllotmentCell(props: {
  orgId?: string
  hostId?: string
  member?: CollaboratorRow
}) {
  const allotments = useAiAllotments({ orgId: props.orgId, hostId: props.hostId })
  const editor = useAllotmentEditing()
  const uid = props.member?.uid ?? props.member?.$id
  const data = allotments.data
  const person = data?.members.find((entry) => entry.uid === uid)
  if (allotments.status !== 'ready' || !data || !uid || !props.hostId || !person || person.orgWide || props.member?.status === 'invited') {
    return <>{'—'}</>
  }
  const subject = `collab:${props.hostId}:${uid}`
  const row = data.allotments.find((allotment) => allotment.subject === subject)
  const mayEdit = data.canEdit.billing || (data.canEdit.collaborators && uid !== data.callerUid)
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
      <Typography variant="body2" sx={{ color: aiAllotmentTone(row) }}>
        {aiAllotmentSummary(row)}
      </Typography>
      {mayEdit ? (
        <Button
          size="small"
          onClick={() =>
            editor.open({
              subject,
              title: `AI allotment — ${person.name} on this site`,
              initial: row ? { credits: row.credits, mode: row.mode, models: row.models } : null,
              removable: Boolean(row),
            })
          }
        >
          {row ? 'Edit' : 'Set'}
        </Button>
      ) : null}
      <AiAllotmentEditor
        open={editor.editing !== null}
        title={editor.editing?.title ?? ''}
        description="Counts what this collaborator draws on this site."
        initial={editor.editing?.initial ?? null}
        models={data.models}
        poolLimit={data.pool.limit}
        busy={editor.busy}
        error={editor.error}
        onClose={editor.close}
        onSave={(value) =>
          editor.editing
            ? void editor.run({ orgId: data.orgId, set: [{ subject: editor.editing.subject, ...value }] })
            : undefined
        }
        onRemove={
          editor.editing?.removable
            ? () => void editor.run({ orgId: data.orgId, remove: [subject] })
            : undefined
        }
      />
    </Stack>
  )
}
AiCollaboratorAllotmentCell.displayName = 'AiCollaboratorAllotmentCell'

/**
 * THE SITE'S OWN AI ALLOTMENT (AGL-2942), beneath its collaborators table:
 * what everyone on the site may draw together each month — the agency's
 * per-client budget. Set by a manager with `billing.manage`; readable by
 * the site's admin. The collaborators card names the site and no org, so
 * the route resolves the org from the site.
 */
export function AiSiteAllotmentCard(props: { hostId?: string; orgId?: string }) {
  const allotments = useAiAllotments({ orgId: props.orgId, hostId: props.hostId })
  const editor = useAllotmentEditing()
  const data = allotments.data
  if (allotments.status === 'refused' || !props.hostId) return null
  const subject = `host:${props.hostId}`
  const row = data?.allotments.find((allotment) => allotment.subject === subject)
  const site = data?.hosts.find((host) => host.hostId === props.hostId)
  return (
    <CardDisplay
      header={'Site AI allotment'}
      help={pluginDocsHelp('billing', {
        anchor: '#ai-allotments',
        excerpt: 'What everyone on this site may draw from the workspace’s AI credits each month, together.',
      })}
      contentGutterX
      contentGutterY
    >
      {!data ? (
        <Typography variant="body2" color="text.secondary">
          {allotments.status === 'error' ? 'Could not read this site’s AI allotment.' : 'Loading…'}
        </Typography>
      ) : (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={{ flexGrow: 1, color: aiAllotmentTone(row) }}>
            {row
              ? aiAllotmentSummary(row)
              : `${(site?.credits ?? 0).toLocaleString()} credits this month, no allotment`}
          </Typography>
          {data.canEdit.billing ? (
            <Button
              size="small"
              onClick={() =>
                editor.open({
                  subject,
                  title: `AI allotment — ${site?.name ?? 'this site'}`,
                  initial: row ? { credits: row.credits, mode: row.mode, models: row.models } : null,
                  removable: Boolean(row),
                })
              }
            >
              {row ? 'Edit' : 'Set'}
            </Button>
          ) : null}
          <AiAllotmentEditor
            open={editor.editing !== null}
            title={editor.editing?.title ?? ''}
            description="Counts what everyone draws on the site, together."
            initial={editor.editing?.initial ?? null}
            models={data.models}
            poolLimit={data.pool.limit}
            busy={editor.busy}
            error={editor.error}
            onClose={editor.close}
            onSave={(value) =>
              void editor.run({ orgId: data.orgId, set: [{ subject, ...value }] })
            }
            onRemove={
              editor.editing?.removable
                ? () => void editor.run({ orgId: data.orgId, remove: [subject] })
                : undefined
            }
          />
        </Stack>
      )}
    </CardDisplay>
  )
}
AiSiteAllotmentCard.displayName = 'AiSiteAllotmentCard'
