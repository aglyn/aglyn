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
import { Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { AiAllotmentEditor, type AiAllotmentValue } from './ai-allotment-editor.component'
import { aiAllotmentSummary, aiAllotmentTone } from './billing-ai-allotments.component'
import { saveAiAllotments, useAiAllotments } from './use-ai-allotments'

export interface MemberAiAllotmentCardProps {
  orgId: string
  uid: string
  /** The org member document as the page loaded it. */
  member?: { hostAccess?: Record<string, string> } | null
  /** The org's sites, for naming a collaborator's. */
  hosts?: ReadonlyArray<{ $id: string; displayName?: string; subdomain?: string }>
}

/**
 * ONE MEMBER'S AI ALLOTMENT (AGL-2942), on their page beside their usage.
 *
 * A team member has one allotment, across every site. A site collaborator
 * has one per site they work on — each set here or on that site's Users
 * card. Read through `/api/ai/allotments?uid=`, which admits the person, the
 * Usage page's readers and — for a collaborator's sites — the site's admin;
 * a refusal renders no card.
 */
export function MemberAiAllotmentCard(props: MemberAiAllotmentCardProps) {
  const { orgId, uid } = props
  const { data: user } = useUser()
  const allotments = useAiAllotments({ orgId, uid })
  const [editing, setEditing] = useState<{ subject: string; title: string; initial: AiAllotmentValue | null; removable: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (allotments.status === 'refused') return null
  const data = allotments.data
  const person = data?.members.find((entry) => entry.uid === uid)
  const orgWide = person?.orgWide ?? true
  const siteName = (hostId: string) => {
    const host = props.hosts?.find((entry) => entry.$id === hostId)
    return host?.displayName ?? host?.subdomain ?? hostId
  }
  const rows = orgWide
    ? [{ subject: `member:${uid}`, label: 'Every site', hostId: null as string | null }]
    : Object.keys(props.member?.hostAccess ?? person?.byHost ?? {}).map((hostId) => ({
        subject: `collab:${hostId}:${uid}`,
        label: siteName(hostId),
        hostId,
      }))
  const mayEdit = (subject: string) =>
    Boolean(
      data &&
        (data.canEdit.billing ||
          (subject.startsWith('collab:') && data.canEdit.collaborators && uid !== data.callerUid)),
    )

  const run = async (body: Parameters<typeof saveAiAllotments>[1]) => {
    setBusy(true)
    setError(null)
    const result = await saveAiAllotments(user, body)
    setBusy(false)
    if (result.ok) setEditing(null)
    else setError(result.error)
  }

  return (
    <CardDisplay
      header={'AI allotment'}
      help={pluginDocsHelp('billing', {
        anchor: '#ai-allotments',
        excerpt: 'The share of the workspace’s AI credits this member may draw each month.',
      })}
      contentGutterX
      contentGutterY
    >
      {!data ? (
        <Typography variant="body2" color="text.secondary">
          {allotments.status === 'error'
            ? 'Could not read this member’s AI allotment — a failed read, not none.'
            : 'Loading…'}
        </Typography>
      ) : (
        <Stack spacing={1}>
          {rows.map((entry) => {
            const row = data.allotments.find((allotment) => allotment.subject === entry.subject)
            const used = entry.hostId ? (person?.byHost[entry.hostId] ?? 0) : (person?.credits ?? 0)
            return (
              <Stack key={entry.subject} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                  {`${entry.label}: `}
                  <Typography component="span" variant="body2" sx={{ color: aiAllotmentTone(row) }}>
                    {row ? aiAllotmentSummary(row) : `${used.toLocaleString()} credits this month, no allotment`}
                  </Typography>
                </Typography>
                {mayEdit(entry.subject) ? (
                  <Button
                    size="small"
                    onClick={() => {
                      setError(null)
                      setEditing({
                        subject: entry.subject,
                        title: `AI allotment — ${person?.name ?? uid}${entry.hostId ? ` on ${entry.label}` : ''}`,
                        initial: row ? { credits: row.credits, mode: row.mode, models: row.models } : null,
                        removable: Boolean(row),
                      })
                    }}
                  >
                    {row ? 'Edit' : 'Set'}
                  </Button>
                ) : null}
              </Stack>
            )
          })}
          <AiAllotmentEditor
            open={editing !== null}
            title={editing?.title ?? ''}
            initial={editing?.initial ?? null}
            models={data.models}
            poolLimit={data.pool.limit}
            busy={busy}
            error={error}
            onClose={() => setEditing(null)}
            onSave={(value) =>
              editing ? void run({ orgId: data.orgId, set: [{ subject: editing.subject, ...value }] }) : undefined
            }
            onRemove={
              editing?.removable
                ? () => void run({ orgId: data.orgId, remove: [editing.subject] })
                : undefined
            }
          />
        </Stack>
      )}
    </CardDisplay>
  )
}
MemberAiAllotmentCard.displayName = 'MemberAiAllotmentCard'

export default MemberAiAllotmentCard
