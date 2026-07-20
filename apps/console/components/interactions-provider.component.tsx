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
  createResourceUid,
  isSiteEventType,
  validateHostAction,
} from '@aglyn/aglyn'
import {
  InteractionsContext,
  type InteractionsContextValue,
} from '@aglyn/besigner-ui'
import { buildInteractionCandidate } from './interaction-builder-doc'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { collection, doc, limit, query, setDoc } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import InteractionBuilderDialog, {
  type InteractionBuilderState,
  PickModeBanner,
} from './interaction-builder-dialog.component'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import useFirestoreCollection from '../hooks/use-firestore-collection'

export interface InteractionsProviderProps {
  hostId: string
  /** Section experiments need the screen under edit; layouts omit it. */
  screenId?: string
  /**
   * Renders children with an empty interactions context (AGL-587): email
   * documents run no client JS, so the attributes panel must not offer
   * the Interactions section. The designer hides it when no creator
   * callbacks are present; disabling here also skips the automations and
   * experiments subscriptions and the builder dialog entirely.
   */
  disabled?: boolean
  children?: JSX.Children
}

/**
 * Feeds the designer's Interactions section (AGL-258) with the host's
 * element-scoped automations and section experiments. Creating or
 * editing an interaction opens the inline builder dialog (AGL-319) —
 * trigger, actions, and frequency configure right on the canvas and
 * save enabled. Section experiments still draft to the Marketing page.
 */
export function InteractionsProvider(props: InteractionsProviderProps) {
  const { hostId, screenId, disabled, children } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const [builder, setBuilder] = useState<InteractionBuilderState | null>(null)

  const { data: actionDocs } = useFirestoreCollection<any>(
    () =>
      disabled
        ? null
        : query(collection(firestore, 'hosts', hostId, 'actions'), limit(100)),
    [firestore, hostId, disabled],
    { idField: '$id' },
  )
  const { data: experimentDocs } = useFirestoreCollection<any>(
    () =>
      disabled
        ? null
        : query(
            collection(firestore, 'hosts', hostId, 'experiments'),
            limit(50),
          ),
    [firestore, hostId, disabled],
    { idField: '$id' },
  )

  const value = useMemo<InteractionsContextValue>(() => {
    // Unavailable (AGL-587): no callbacks means the designer's props form
    // never renders the Interactions section (it gates on the creators).
    if (disabled) return {}
    const automations = (actionDocs ?? [])
      .filter(
        (action: any) =>
          !action.deletedAt &&
          isSiteEventType(String(action.trigger?.event ?? '')) &&
          action.trigger?.selector,
      )
      .map((action: any) => ({
        id: action.$id as string,
        name: action.name as string | undefined,
        event: String(action.trigger?.event ?? ''),
        selector: String(action.trigger?.selector ?? ''),
        enabled: action.enabled !== false,
      }))
    const sectionExperiments = (experimentDocs ?? [])
      .filter(
        (experiment: any) =>
          !experiment.deletedAt &&
          experiment.target === 'section' &&
          experiment.nodeId,
      )
      .map((experiment: any) => ({
        id: experiment.$id as string,
        name: experiment.name as string | undefined,
        nodeId: experiment.nodeId as string,
        status: experiment.status as string | undefined,
      }))
    return {
      automations,
      sectionExperiments,
      // Manage in place (wave v7): flip or retire an element automation
      // without leaving the canvas.
      onToggleInteraction: ({ id, enabled }) => {
        void setDoc(
          doc(firestore, 'hosts', hostId, 'actions', id),
          { enabled, updatedAt: Timestamp.now() },
          { merge: true },
        ).catch((error) => {
          console.error(error)
          enqueueSnackbar('Could not update the interaction', {
            variant: 'error',
          })
        })
      },
      onDeleteInteraction: ({ id }) => {
        // Soft delete — matches the actions card's deletedAt convention.
        void setDoc(
          doc(firestore, 'hosts', hostId, 'actions', id),
          { deletedAt: Timestamp.now(), enabled: false },
          { merge: true },
        )
          .then(() =>
            enqueueSnackbar('Interaction removed', {
              variant: 'success',
              persist: false,
            }),
          )
          .catch((error) => {
            console.error(error)
            enqueueSnackbar('Could not remove the interaction', {
              variant: 'error',
            })
          })
      },
      // Preset-wired interactions (AGL-589): a preset like Dropdown
      // Panel declares its hover choreography; persist each resolved
      // draft exactly like a builder save — validated, undefined-pruned
      // via buildInteractionCandidate, and enabled immediately.
      onCreatePresetInteractions: ({ interactions }) => {
        void (async () => {
          let saved = 0
          for (const draft of interactions) {
            const candidate = buildInteractionCandidate({
              name: draft.name,
              event: draft.event,
              selector: draft.selector,
              frequency: 'every',
              cooldownMinutes: 0,
              steps: draft.steps.map((step) => ({ ...step })),
            })
            const problem = validateHostAction(candidate as any)
            if (problem) {
              console.error('Preset interaction rejected:', problem, draft)
              continue
            }
            await setDoc(
              doc(firestore, 'hosts', hostId, 'actions', createResourceUid()),
              {
                ...candidate,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
              },
              { merge: true },
            )
            saved += 1
          }
          if (saved) {
            enqueueSnackbar(
              saved === 1
                ? 'Interaction wired and enabled'
                : `${saved} interactions wired and enabled`,
              { variant: 'success', persist: false },
            )
          }
        })().catch((error) => {
          console.error(error)
          enqueueSnackbar('Could not wire the preset interactions', {
            variant: 'error',
          })
        })
      },
      // Fluent builder (AGL-319): configure everything inline.
      onCreateInteraction: ({ nodeId, event }) => {
        setBuilder({ id: null, nodeId, event })
      },
      onEditInteraction: ({ id, nodeId }) => {
        setBuilder({ id, nodeId, event: 'elementClick' })
      },
      ...(screenId
        ? {
            onCreateSectionExperiment: ({ nodeId }: { nodeId: string }) => {
              const id = createResourceUid()
              void setDoc(
                doc(firestore, 'hosts', hostId, 'experiments', id),
                {
                  name: `Section test — ${nodeId.slice(0, 8)}`,
                  status: 'draft',
                  target: 'section',
                  screenId,
                  nodeId,
                  variants: [
                    { id: 'a', name: 'A (control)', weight: 1 },
                    { id: 'b', name: 'B', weight: 1 },
                  ],
                  goal: { event: 'formSubmission' },
                  createdAt: Timestamp.now(),
                },
              )
                .then(() =>
                  enqueueSnackbar(
                    'Draft experiment created — pin variant versions and ' +
                      'start it from Marketing → Experiments',
                    { variant: 'success', persist: false },
                  ),
                )
                .catch((error) => {
                  console.error(error)
                  enqueueSnackbar('Could not create the experiment', {
                    variant: 'error',
                  })
                })
            },
          }
        : {}),
    }
  }, [
    actionDocs,
    experimentDocs,
    firestore,
    hostId,
    screenId,
    disabled,
    enqueueSnackbar,
  ])

  const editingDoc = builder?.id
    ? (actionDocs ?? []).find((action: any) => action.$id === builder.id)
    : undefined

  return (
    <InteractionsContext.Provider value={value}>
      {children}
      {!disabled && builder ? (
        <InteractionBuilderDialog
          key={builder.id ?? 'new'}
          hostId={hostId}
          state={builder}
          existing={editingDoc}
          onClose={() => setBuilder(null)}
        />
      ) : null}
      {/* Floating pick affordance while a builder target is picked on the
          canvas (AGL-574) — shown over the minimized dialog. */}
      {disabled ? null : <PickModeBanner />}
    </InteractionsContext.Provider>
  )
}
InteractionsProvider.displayName = 'InteractionsProvider'

export default InteractionsProvider
