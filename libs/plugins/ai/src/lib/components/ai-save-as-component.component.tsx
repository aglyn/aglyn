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
  canvas,
  PLATFORM_BRAND_NAME,
  REUSABLE_INSTANCE_COMPONENT_ID,
  type NodeSchema,
} from '@aglyn/aglyn'
import { openEditorSession } from '@aglyn/aglyn/plugin-manager/editor-sessions'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useHostResourceApi, useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, CircularProgress, FormControl, Stack, TextField } from '@mui/material'
import { usePathname } from 'next/navigation'
import { useCallback, useState } from 'react'
import {
  assistEditDocumentOf,
  isAssistEditProposal,
  type AssistEditAppliedReport,
  type AssistEditProposal,
} from '../model/assist-edit'
import {
  applyAssistEditSavingComponent,
  describeAssistEditCanvas,
  type AssistEditComponentWriter,
} from './assist-edit-canvas'
import { AssistEditCard } from './assist-edit-card.component'

/**
 * Save the selection as a reusable component, with AI (AGL-2908) — the
 * besigner half of the component job, in the `besignerInspector` zone under
 * the selected element's own fields.
 *
 * The person names the component, the door reads the outline of what is
 * open and proposes which values become properties, and AGL-2906's own card
 * asks before anything happens. Applying creates the component through the
 * host resources route and swaps the selection for an instance of it, on the
 * open draft, as one undo step.
 *
 * ## Where it is drawn
 *
 * On a versioned besigner — a screen, component or layout, which is what
 * `assistEditDocumentOf` answers for — for an element the panel says this
 * editor may change in place (`editable`, AGL-2908), which is not the canvas
 * root and not locked layout chrome. Never on an instance: one is already a
 * component, and promoting it would make a component of a placeholder.
 *
 * The widget's own gates (`aiGenerative`, `ai.generate`) are the zone's, so a
 * reader without them never sees the button. The door decides again.
 */

export interface AiSaveAsComponentProps {
  /** The workspace the editor is in; the door gates and bills on it. */
  orgId?: string | null
  /** The site the editor names; the zone reads it from the editor's route. */
  hostId?: string | null
  /** The selected element, as the Attributes panel resolved it. */
  node?: NodeSchema<any> | null
  /** Whether this editor may change that element in place. */
  editable?: boolean
}

/** The name the promote dialog opens with: the element's own, else a plain one. */
function suggestedName(node: NodeSchema<any> | null | undefined): string {
  const named = typeof (node as { name?: unknown })?.name === 'string' ? String((node as { name?: string }).name) : ''
  return named || String(node?.componentSchema?.displayName ?? 'Component')
}

export function AiSaveAsComponent(props: AiSaveAsComponentProps) {
  const { orgId, hostId, node, editable } = props
  const { data: user } = useUser()
  const createHostResource = useHostResourceApi()
  const pathname = usePathname()
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<AssistEditProposal | null>(null)
  const [exchangeId, setExchangeId] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const document = assistEditDocumentOf(pathname ?? '')

  const propose = useCallback(async () => {
    const asked = (name ?? '').trim()
    if (!asked || !hostId || !orgId) return
    setBusy(true)
    setFailure(null)
    try {
      const session = openEditorSession()
      const outline = session ? describeAssistEditCanvas(canvas, node?.$id ?? null) : null
      if (!outline) {
        setFailure('The editor did not describe what is open. Reopen it and try again.')
        return
      }
      const response = await authorizedFetch(user, '/api/ai/generate/component', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          hostId,
          route: pathname ?? '',
          canvas: outline,
          name: asked,
        }),
      })
      const answer = await response.json().catch(() => ({}))
      if (!response.ok || !isAssistEditProposal(answer?.edit)) {
        setFailure(String(answer?.error ?? 'The component could not be proposed.'))
        return
      }
      setProposal(answer.edit)
      setExchangeId(typeof answer.exchangeId === 'string' ? answer.exchangeId : null)
    } catch {
      setFailure('The component could not be proposed. Try again.')
    } finally {
      setBusy(false)
    }
  }, [name, hostId, orgId, node, pathname, user])

  const writer: AssistEditComponentWriter = {
    createComponent: async (input) => {
      const created = await createHostResource({
        hostId: String(hostId),
        resource: 'reusableComponent',
        data: {
          displayName: input.name,
          rootId: input.rootId,
          nodes: input.nodes,
          ...(input.props.length ? { props: input.props } : {}),
        },
      })
      return created.id
    },
  }

  const apply = useCallback(async () => {
    if (!proposal || !orgId) return
    setBusy(true)
    setFailure(null)
    try {
      const session = openEditorSession()
      const result = await applyAssistEditSavingComponent(canvas as never, proposal, session, writer)
      if (result.ok === false) {
        setFailure(result.message)
        return
      }
      setProposal(null)
      setName(null)
      if (!exchangeId || !session) return
      const report: AssistEditAppliedReport = {
        orgId,
        hostId: proposal.target.hostId,
        exchangeId,
        documentKind: proposal.target.kind,
        documentId: proposal.target.documentId,
        versionId: session.versionId,
        opCounts: result.opCounts,
      }
      // Fire and forget: the component exists and the canvas has changed, so
      // a record that fails to land must not read as a save that failed.
      void authorizedFetch(user, '/api/assist/edit-applied', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      }).catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }, [proposal, orgId, exchangeId, user, writer])

  if (!document || !hostId || !orgId || !editable || !node) return null
  // An instance already follows a component; promoting it would make a
  // component of a placeholder.
  if (node.componentId === REUSABLE_INSTANCE_COMPONENT_ID) return null

  if (proposal) {
    return (
      <AssistEditCard
        proposal={proposal}
        brand={PLATFORM_BRAND_NAME}
        session={openEditorSession()}
        failure={failure}
        onApply={() => void apply()}
        onCreateVersion={() => openEditorSession()?.createVersion?.()}
        onDismiss={() => {
          setProposal(null)
          setFailure(null)
        }}
      />
    )
  }

  if (name === null) {
    return (
      <FormControl margin="none" fullWidth>
        <Button color="primary" fullWidth onClick={() => setName(suggestedName(node))}>
          {'Make a reusable component with AI'}
        </Button>
      </FormControl>
    )
  }

  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      <TextField
        size="small"
        label="Component name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={busy}
        fullWidth
      />
      {failure ? <Alert severity="warning">{failure}</Alert> : null}
      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          size="small"
          disabled={busy || !name.trim()}
          onClick={() => void propose()}
          startIcon={busy ? <CircularProgress size={14} /> : undefined}
        >
          {busy ? 'Reading the section…' : 'Suggest properties'}
        </Button>
        <Button size="small" color="inherit" disabled={busy} onClick={() => setName(null)}>
          {'Cancel'}
        </Button>
      </Stack>
    </Stack>
  )
}
AiSaveAsComponent.displayName = 'AiSaveAsComponent'

export default AiSaveAsComponent
