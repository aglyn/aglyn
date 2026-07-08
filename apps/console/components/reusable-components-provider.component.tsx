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
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material'
import { collection, doc, getDoc, limit, query, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore } from 'reactfire'
import { hasEntitlement } from '../constants/entitlements'
import useCurrentTenant from '../hooks/use-current-tenant'
import useFirestoreCollection from '../hooks/use-firestore-collection'

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
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { tenant } = useCurrentTenant()
  const [promoteNode, setPromoteNode] = useState<Aglyn.NodeSchema<any> | null>(
    null,
  )
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const { data: componentDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'components'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )

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
          props: { refId: definition.$id },
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
      if (!hasEntitlement('reusable-components', tenant)) {
        return void enqueueSnackbar(
          'Reusable components require a Starter plan — see Billing to upgrade',
          { variant: 'warning', persist: false },
        )
      }
      setName(String(node?.componentSchema?.displayName ?? 'Component'))
      setDescription('')
      setPromoteNode(node)
    },
    [tenant, enqueueSnackbar],
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
      const refId = Aglyn.createResourceUid()
      const timestamp = Timestamp.now()
      await setDoc(doc(firestore, 'hosts', hostId, 'components', refId), {
        displayName: name || 'Component',
        ...(description && { description }),
        rootId: node.$id,
        nodes: definitionNodes,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      // The source element stays as-is on the canvas (AGL-64): the editor
      // renders instances as empty placeholders (definitions graft on the
      // tenant only), so swapping the subtree for an instance here would
      // visually empty the element the user just promoted.
      setPromoteNode(null)
      enqueueSnackbar(
        `Saved "${name}" — insert it anywhere from Your components`,
        { variant: 'success', persist: false },
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
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
            color="secondary"
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
