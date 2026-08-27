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
  collectNodeInteractions,
  createResourceUid,
  isSiteEventType,
  nodeIdFromInteractionSelector,
  parseNodeInteractionId,
  removeNodeInteraction,
  upsertNodeInteraction,
  validateHostAction,
  type NodeInteraction,
} from '@aglyn/aglyn'
import {
  InteractionsContext,
  nodeElementSelector,
  type InteractionsContextValue,
} from '@aglyn/besigner-ui'
import { buildInteractionCandidate } from './interaction-builder-doc'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { collection, doc, limit, query, setDoc } from 'firebase/firestore'
import { action as mobxAction } from 'mobx'
import { observer } from 'mobx-react-lite'
import { useCallback, useMemo, useState } from 'react'
import InteractionBuilderDialog, {
  type InteractionBuilderState,
  PickModeBanner,
} from './interaction-builder-dialog.component'
import {
  useFirestore,
  useHostResourceApi,
} from '@aglyn/tenant-feature-instance'
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
/**
 * Observed (AGL-1478): an interaction now lives on the node, which is a MobX
 * observable in the editor's canvas. Without this the list would refresh only
 * when the legacy `actions` listener happened to fire.
 */
export const InteractionsProvider = observer(function InteractionsProvider(
  props: InteractionsProviderProps,
) {
  const { hostId, screenId, disabled, children } = props
  const firestore = useFirestore()
  // Action creation is server-owned since AGL-2266 (the cap); every other
  // action write on this surface stays client-direct.
  const createResource = useHostResourceApi()
  const { enqueueSnackbar } = useSnackbar()
  const [builder, setBuilder] = useState<InteractionBuilderState | null>(null)

  const { data: actionDocs, fromCache: actionsFromCache } =
    useFirestoreCollection<any>(
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

  /**
   * Write one interaction onto the node that owns it (AGL-1478).
   *
   * The canvas node IS the document, so this needs no Firestore call and no
   * id allocation from the server: the interaction rides the editor's next
   * save, which is what "versioned with the document" means in practice. It
   * also means an unsaved interaction is unsaved work like any other edit,
   * visible in the toolbar's dirty state rather than already live.
   */
  const writeNodeInteraction = useCallback(
    (nodeId: string, interaction: NodeInteraction | null, id?: string): boolean => {
      const node = canvas.getNode(nodeId)
      if (!node) return false
      mobxAction(() => {
        node.interactions = interaction
          ? upsertNodeInteraction(node.interactions, interaction)
          : removeNodeInteraction(node.interactions, String(id))
      })()
      return true
    },
    [],
  )

  const value = useMemo<InteractionsContextValue>(() => {
    // Unavailable (AGL-587): no callbacks means the designer's props form
    // never renders the Interactions section (it gates on the creators).
    if (disabled) return {}
    /**
     * The document's own interactions, listed first (AGL-1478).
     *
     * Read straight off the canvas, which is the editor's live copy — so a
     * new interaction appears the moment it is written, with no round trip
     * and nothing to reconcile against a listener.
     *
     * Presented in the same `{ id, name, event, selector, enabled }` shape
     * the legacy actions produce, with the selector DERIVED, so the props
     * form's per-element filter needs no knowledge of where an interaction
     * is stored.
     */
    const nodeAutomations = collectNodeInteractions(
      canvas.nodes ? [...canvas.nodes.values()] : [],
    ).map((entry) => ({
      id: entry.id,
      name: entry.action.name,
      event: String(entry.action.trigger?.event ?? ''),
      selector: String(entry.action.trigger?.selector ?? ''),
      enabled: entry.action.enabled !== false,
    }))
    /**
     * The legacy host actions, still listed (AGL-1478).
     *
     * Every element interaction authored before this change is a row in
     * `hosts/{hostId}/actions`, and it keeps working and keeps being editable
     * until the backfill moves it. Dropping them here would make an author's
     * existing hover menus vanish from the panel while continuing to run on
     * the published site, which is the worst of both.
     */
    const legacyAutomations = (actionDocs ?? [])
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
    const automations = [...nodeAutomations, ...legacyAutomations]
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
        // Two stores until the backfill, so the id says which one (AGL-1478).
        const owned = parseNodeInteractionId(id)
        if (owned) {
          const node = canvas.getNode(owned.nodeId)
          const existing = (node?.interactions ?? []).find(
            (entry) => entry.id === owned.interactionId,
          )
          if (existing) {
            writeNodeInteraction(owned.nodeId, { ...existing, enabled })
          }
          return
        }
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
        const owned = parseNodeInteractionId(id)
        if (owned) {
          // A HARD delete, unlike the soft one below. `deletedAt` exists on
          // an action because the row is a document other things reference —
          // a run history, a workflow. An interaction is a field on a node,
          // it is referenced by nothing, and the document's own version
          // history is already the way back to it.
          if (writeNodeInteraction(owned.nodeId, null, owned.interactionId)) {
            enqueueSnackbar('Interaction removed', {
              variant: 'success',
              persist: false,
            })
          }
          return
        }
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
          /**
           * Onto the node the template resolved against (AGL-1478).
           *
           * The draft's selector is the only place that node is named — the
           * preset resolver minted it — so it is read back out and then
           * dropped. Storing it would be the second name for an element that
           * this whole change exists to remove.
           *
           * No `createResource` and no cap check. That route counts rows
           * against `ACTIONS_MAX_PER_HOST` because one preset click wired
           * several site-wide actions and nothing bounded how many times a
           * click could happen (AGL-2266). Nothing is created here: the
           * interaction is a field on a node that already exists, and the
           * ceiling that applies is the per-element one `upsertNodeInteraction`
           * holds.
           */
          const nodeId = nodeIdFromInteractionSelector(draft.selector)
          if (!nodeId) {
            console.error('Preset interaction has no node to live on:', draft)
            continue
          }
          const { trigger, ...rest } = candidate as any
          const { selector: _dropped, ...triggerWithoutSelector } = trigger ?? {}
          const written = writeNodeInteraction(nodeId, {
            ...rest,
            id: createResourceUid(),
            trigger: triggerWithoutSelector,
          } as NodeInteraction)
          if (written) saved += 1
        }
        if (saved) {
          enqueueSnackbar(
            saved === 1
              ? 'Interaction wired and enabled'
              : `${saved} interactions wired and enabled`,
            { variant: 'success', persist: false },
          )
        }
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
    // `canvas.nodes` is observed, not a dep: this component is an `observer`,
    // so MobX re-runs the render when a node's interactions change and the
    // memo is rebuilt with it. Listing it here would be a lie — the Map's
    // identity does not change when a field on one of its nodes does.
  }, [
    actionDocs,
    experimentDocs,
    firestore,
    createResource,
    hostId,
    screenId,
    disabled,
    enqueueSnackbar,
    writeNodeInteraction,
  ])

  /**
   * What the dialog is editing, from whichever store holds it (AGL-1478).
   *
   * A node interaction is reshaped into the action the dialog understands —
   * the selector derived, exactly as the runtime derives it — so the dialog
   * needs no knowledge of where its subject lives.
   */
  const owned = builder?.id ? parseNodeInteractionId(builder.id) : null
  const ownedInteraction = owned
    ? (canvas.getNode(owned.nodeId)?.interactions ?? []).find(
        (entry) => entry.id === owned.interactionId,
      )
    : undefined
  const editingDoc = owned
    ? ownedInteraction
      ? {
          ...ownedInteraction,
          trigger: {
            ...ownedInteraction.trigger,
            selector: nodeElementSelector(owned.nodeId),
          },
        }
      : undefined
    : builder?.id
      ? (actionDocs ?? []).find((action: any) => action.$id === builder.id)
      : undefined

  /**
   * Every interaction authored from the besigner now lands on its node.
   *
   * An EDIT of a legacy action is the one exception and keeps its Firestore
   * path: rewriting it as a node interaction would be a migration performed
   * by an author's edit, half a site at a time and only where someone
   * happened to open the dialog. The backfill moves them all at once, on
   * purpose, or not at all.
   */
  const saveToNode = useCallback(
    (candidate: unknown, id: string): boolean => {
      if (!builder) return false
      const { trigger, ...rest } = (candidate ?? {}) as any
      const { selector: _dropped, ...triggerWithoutSelector } = trigger ?? {}
      return writeNodeInteraction(builder.nodeId, {
        ...rest,
        id: owned?.interactionId ?? id,
        trigger: triggerWithoutSelector,
      } as NodeInteraction)
    },
    [builder, owned, writeNodeInteraction],
  )
  const savesToNode = Boolean(builder && (!builder.id || owned))

  return (
    <InteractionsContext.Provider value={value}>
      {children}
      {!disabled && builder ? (
        <InteractionBuilderDialog
          key={builder.id ?? 'new'}
          hostId={hostId}
          state={builder}
          existing={editingDoc}
          // The freshness of the listener `existing` was seeded from
          // (AGL-1066) — the dialog cannot ask, so the owner of the listen
          // has to tell it.
          existingFromCache={savesToNode ? false : actionsFromCache}
          {...(savesToNode ? { onSave: saveToNode } : {})}
          onClose={() => setBuilder(null)}
        />
      ) : null}
      {/* Floating pick affordance while a builder target is picked on the
          canvas (AGL-574) — shown over the minimized dialog. */}
      {disabled ? null : <PickModeBanner />}
    </InteractionsContext.Provider>
  )
})
InteractionsProvider.displayName = 'InteractionsProvider'

export default InteractionsProvider
