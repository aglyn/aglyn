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

import { createResourceUid, isSiteEventType } from '@aglyn/aglyn'
import {
  InteractionsContext,
  type InteractionsContextValue,
} from '@aglyn/besigner-ui'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { collection, doc, limit, query, setDoc } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import InteractionBuilderDialog, {
  type InteractionBuilderState,
} from './interaction-builder-dialog.component'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import useFirestoreCollection from '../hooks/use-firestore-collection'

export interface InteractionsProviderProps {
  hostId: string
  /** Section experiments need the screen under edit; layouts omit it. */
  screenId?: string
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
  const { hostId, screenId, children } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const [builder, setBuilder] = useState<InteractionBuilderState | null>(null)

  const { data: actionDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'actions'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: experimentDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'experiments'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )

  const value = useMemo<InteractionsContextValue>(() => {
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
  }, [actionDocs, experimentDocs, firestore, hostId, screenId, enqueueSnackbar])

  const editingDoc = builder?.id
    ? (actionDocs ?? []).find((action: any) => action.$id === builder.id)
    : undefined

  return (
    <InteractionsContext.Provider value={value}>
      {children}
      {builder ? (
        <InteractionBuilderDialog
          key={builder.id ?? 'new'}
          hostId={hostId}
          state={builder}
          existing={editingDoc}
          onClose={() => setBuilder(null)}
        />
      ) : null}
    </InteractionsContext.Provider>
  )
}
InteractionsProvider.displayName = 'InteractionsProvider'

export default InteractionsProvider
