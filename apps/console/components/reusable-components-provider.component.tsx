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

import * as Aglyn from '@aglyn/aglyn'
import { ComponentPromotionContext } from '@aglyn/besigner-ui'
import { mdiPackageVariant } from '@aglyn/shared-data-mdi'
import { useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useHostResourceApi,
} from '@aglyn/tenant-feature-instance'
import { hasEntitlement } from '../constants/entitlements'
import useCurrentOrg from '../hooks/use-current-org'
import useHostComponentDefinitions from '../hooks/use-host-component-definitions'

export interface ReusableComponentsProviderProps {
  hostId: string
  children?: JSX.Children
}

/** Node ids of a subtree, root included, walked through `nodes` arrays. */
function collectSubtreeIds(
  rootId: string,
  nodesById: Record<string, any>,
): string[] {
  const ids: string[] = []
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift() as string
    if (!nodesById[id] || ids.includes(id)) continue
    ids.push(id)
    const children = nodesById[id]?.nodes
    if (Array.isArray(children)) queue.push(...children)
  }
  return ids
}

/**
 * Console-side reusable-component flows (AGL-35): provides promote/demote
 * callbacks to the designer's Attributes panel, hosts the promote dialog,
 * and registers each host component definition as an element-drawer preset
 * under "Your components".
 */
export function ReusableComponentsProvider(
  props: ReusableComponentsProviderProps,
) {
  const { hostId, children } = props
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { org } = useCurrentOrg()
  const [promoteNode, setPromoteNode] = useState<Aglyn.NodeSchema<any> | null>(
    null,
  )
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // Shared with the canvas's reusable-instance graft (AGL-1217): one query,
  // one listener, one set of skip rules for both readers.
  const { docs: componentDocs } = useHostComponentDefinitions(hostId)

  // Element drawer: one preset per definition, category "Your components".
  useEffect(() => {
    const definitions = (componentDocs ?? []).filter(
      (definition: any) => !definition.deletedAt,
    )
    if (!definitions.length) return
    const presets: Aglyn.PresetSchema[] = definitions.map(
      (definition: any) => ({
        $id: `hostcmp:${definition.$id}`,
        type: Aglyn.NodeType.PRESET,
        displayName: definition.displayName ?? definition.$id,
        icon: { path: mdiPackageVariant.path, sx: { color: '#9c27b0' } },
        category: 'Your components',
        data: {
          $id: null,
          componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
          pluginId: 'mui',
          props: {
            refId: definition.$id,
            // Names the editor placeholder (AGL-1193) — a canvas of
            // identical dashed boxes is unreadable once chrome is promoted.
            name: definition.displayName ?? definition.$id,
          },
        },
      }),
    )
    Aglyn.components.registerPreset(presets)
    return () => {
      Aglyn.components.unregisterPreset(presets.map((preset) => preset.$id))
    }
  }, [componentDocs])

  const handlePromote = useCallback(
    (node: Aglyn.NodeSchema<any>) => {
      if (!hasEntitlement('reusable-components', org)) {
        return void enqueueSnackbar(
          'Reusable components require a Starter plan — see Billing to upgrade',
          { variant: 'warning', persist: false },
        )
      }
      setName(String(node?.componentSchema?.displayName ?? 'Component'))
      setDescription('')
      setPromoteNode(node)
    },
    [org, enqueueSnackbar],
  )

  const handlePromoteConfirm = useCallback(async () => {
    const node = promoteNode
    if (!node) return
    const dequeue = queueLoading()
    try {
      const all = Aglyn.canvas.toJSON().nodes as Record<string, any>
      const subtreeIds = collectSubtreeIds(node.$id, all)
      const definitionNodes: Record<string, any> = {}
      for (const id of subtreeIds) {
        const { componentSchema: _cs, resolvedProps: _rp, ...plain } = all[id]
        definitionNodes[id] =
          id === node.$id ? { ...plain, parentId: null } : plain
      }
      // Creation rides the resources API (AGL-473): reusable components
      // render on the live site, so the Starter+ entitlement is enforced
      // server-side, not just by hiding the promote button.
      const created = await createHostResource({
        hostId,
        resource: 'reusableComponent',
        data: {
          displayName: name || 'Component',
          ...(description && { description }),
          rootId: node.$id,
          nodes: definitionNodes,
        },
      })
      // Swap the promoted subtree for an instance of what we just created
      // (AGL-1193). Leaving it inline made the promoting document the ONE
      // place that would never track the component it defined — edit "Site
      // nav" later and the layout that created it silently keeps the old
      // copy. The canvas shows instances as a named placeholder rather than
      // the definition's content (definitions graft at render, not in the
      // editor), which is the same thing inserting one from "Your
      // components" has always looked like.
      Aglyn.canvas.applyNodes(
        Aglyn.replaceSubtreeWithInstance(
          Aglyn.canvas.toJSON().nodes as any,
          node.$id,
          created.id,
          name || 'Component',
        ) as any,
      )
      setPromoteNode(null)
      enqueueSnackbar(
        `Saved "${name}" — this element now follows the component, and you ` +
          'can insert it anywhere from Your components',
        { variant: 'success', persist: false },
      )
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      dequeue()
    }
  }, [
    promoteNode,
    name,
    description,
    createHostResource,
    firestore,
    hostId,
    queueLoading,
    enqueueSnackbar,
  ])

  const handleDemote = useCallback(
    async (node: Aglyn.NodeSchema<any>) => {
      const refId = (node?.props as any)?.refId as string | undefined
      if (!refId) return
      const dequeue = queueLoading()
      try {
        const snapshot = await getDoc(
          doc(firestore, 'hosts', hostId, 'components', refId),
        )
        const definition = snapshot.data() as any
        if (!definition?.nodes || !definition?.rootId) {
          throw new Error('Definition missing')
        }
        // Fresh ids so the copy is independent of the definition; the copied
        // root keeps the instance node's id, so the parent's child list and
        // the current selection stay valid.
        const idMap: Record<string, string> = {
          [definition.rootId]: node.$id,
        }
        for (const defId of Object.keys(definition.nodes)) {
          if (!(defId in idMap)) idMap[defId] = Aglyn.createResourceUid()
        }
        const all = Aglyn.canvas.toJSON().nodes as Record<string, any>
        const next: Record<string, any> = { ...all }
        for (const [defId, defNode] of Object.entries<any>(definition.nodes)) {
          const newId = idMap[defId]
          next[newId] = {
            ...defNode,
            $id: newId,
            parentId:
              defId === definition.rootId
                ? (node.parentId ?? null)
                : (idMap[defNode.parentId] ?? null),
            ...(Array.isArray(defNode.nodes) && {
              nodes: defNode.nodes.map(
                (childId: string) => idMap[childId] ?? childId,
              ),
            }),
          }
        }
        Aglyn.canvas.applyNodes(next as any)
        enqueueSnackbar('Detached — this copy no longer follows the component', {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        dequeue()
      }
    },
    [firestore, hostId, queueLoading, enqueueSnackbar],
  )

  const contextValue = useMemo(
    () => ({ onPromote: handlePromote, onDemote: handleDemote }),
    [handlePromote, handleDemote],
  )

  return (
    <ComponentPromotionContext.Provider value={contextValue}>
      {children}
      <Dialog
        open={Boolean(promoteNode)}
        onClose={() => setPromoteNode(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Save as reusable component'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <TextField
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            size="small"
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPromoteNode(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!name.trim()}
            onClick={handlePromoteConfirm}
          >
            {'Save component'}
          </Button>
        </DialogActions>
      </Dialog>
    </ComponentPromotionContext.Provider>
  )
}
ReusableComponentsProvider.displayName = 'ReusableComponentsProvider'

export default ReusableComponentsProvider
