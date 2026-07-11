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

import * as Aglyn from '@aglyn/aglyn'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material'
import { toJS } from 'mobx'
import { useCallback, useEffect, useState } from 'react'

export interface SubtreeJsonDialogProps {
  node?: Aglyn.NodeSchema<any> | null
  open: boolean
  onClose: () => void
}

type NestedNode = {
  $id?: string
  componentId?: string
  nodes?: NestedNode[]
  [key: string]: unknown
}

/**
 * Validates a nested subtree before it replaces canvas content
 * (AGL-338): every node needs a resolvable componentId and ids must be
 * unique within the subtree (missing ids get minted).
 */
export function validateSubtree(root: NestedNode): string | null {
  const seen = new Set<string>()
  const walk = (item: NestedNode, path: string): string | null => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return `${path}: each node must be a JSON object`
    }
    if (!item.componentId || typeof item.componentId !== 'string') {
      return `${path}: missing componentId`
    }
    if (!Aglyn.components.getFactory(item.componentId as any)) {
      return `${path}: unknown component "${item.componentId}"`
    }
    if (item.$id) {
      if (seen.has(item.$id)) return `${path}: duplicate node id "${item.$id}"`
      seen.add(item.$id)
    }
    const children = Array.isArray(item.nodes) ? item.nodes : []
    for (let i = 0; i < children.length; i += 1) {
      const problem = walk(children[i] as NestedNode, `${path}.nodes[${i}]`)
      if (problem) return problem
    }
    return null
  }
  return walk(root, '$')
}

const mintMissingIds = (item: NestedNode): void => {
  if (!item.$id) item.$id = Aglyn.canvas.createNodeId()
  for (const child of Array.isArray(item.nodes) ? item.nodes : []) {
    mintMissingIds(child as NestedNode)
  }
}

/** Node ids of the subtree rooted at `nodeId` in a flat NodesMap. */
const collectSubtreeIds = (
  map: Record<string, Aglyn.NodeSchema<any>>,
  nodeId: string,
  out: string[] = [],
): string[] => {
  out.push(nodeId)
  const children = (map[nodeId]?.nodes ?? []) as string[]
  for (const childId of children) {
    if (typeof childId === 'string' && map[childId]) {
      collectSubtreeIds(map, childId, out)
    }
  }
  return out
}

/**
 * Edit the JSON of a single element and its children (AGL-338), instead
 * of the whole screen document. Apply validates, keeps the node's
 * identity (so the parent's child list stays intact), and replaces the
 * subtree in one undoable step.
 */
export function SubtreeJsonDialog(props: SubtreeJsonDialogProps) {
  const { node, open, onClose } = props
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !node) return
    const nested = Aglyn.canvas.makeNested(node as any)
    setDraft(JSON.stringify(nested, null, 2))
    setError(null)
  }, [open, node])

  const handleApply = useCallback(() => {
    if (!node) return
    let parsed: NestedNode
    try {
      parsed = JSON.parse(draft)
    } catch (parseError: any) {
      setError(parseError?.message ?? 'Invalid JSON')
      return
    }
    // The root keeps its identity — the parent's child list references it.
    parsed.$id = node.$id
    parsed['parentId'] = node.parentId
    const problem = validateSubtree(parsed)
    if (problem) {
      setError(problem)
      return
    }
    mintMissingIds(parsed)

    // Full-map rebuild: drop the old subtree's descendants, splice in the
    // new flat nodes, and apply as one undoable replacement.
    const map = {
      ...(toJS(Aglyn.canvas.toJSON().nodes) as Record<
        string,
        Aglyn.NodeSchema<any>
      >),
    }
    for (const staleId of collectSubtreeIds(map, node.$id)) {
      delete map[staleId]
    }
    const flat = (Aglyn.canvas.constructor as any).denormalizeNodes(
      [parsed],
      node.parentId!,
      {},
    )
    Object.assign(map, flat)
    Aglyn.canvas.applyNodes(map as any)
    onClose()
  }, [node, draft, onClose])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{'Edit element JSON'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {'This element and its children only — the rest of the screen is ' +
            'untouched. Apply replaces the subtree (undo restores it).'}
        </Typography>
        <TextField
          multiline
          minRows={16}
          maxRows={28}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          error={Boolean(error)}
          helperText={error ?? undefined}
          slotProps={{
            htmlInput: {
              style: { fontFamily: 'monospace', fontSize: 12 },
              spellCheck: false,
            },
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button variant="contained" onClick={handleApply}>
          {'Apply'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
SubtreeJsonDialog.displayName = 'SubtreeJsonDialog'

export default SubtreeJsonDialog
