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

import type * as Aglyn from '@aglyn/aglyn'
import { canvas, components } from '@aglyn/aglyn'
import { JsonEditor } from '@aglyn/shared-ui-json-editor'
import { action, observable, toJS } from 'mobx'
import { observer } from 'mobx-react-lite'
import { useCallback, useMemo, useRef } from 'react'

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
    if (!components.getFactory(item.componentId as any)) {
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
  if (!item.$id) item.$id = canvas.createNodeId()
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

/** The parsed draft with the root's identity pinned back on (AGL-338). */
const withRootIdentity = (
  value: unknown,
  node: Aglyn.NodeSchema<any>,
): NestedNode => {
  const parsed = structuredClone(value) as NestedNode
  // The root keeps its identity — the parent's child list references it.
  parsed.$id = node.$id
  parsed['parentId'] = node.parentId
  return parsed
}

/**
 * Edit the JSON of a single element and its children (AGL-338), instead
 * of the whole screen document — through the SAME editor as the Edit
 * menu's raw JSON dialog (AGL-457). Save validates, keeps the node's
 * identity (so the parent's child list stays intact), and replaces the
 * subtree in one undoable step.
 */
export function SubtreeJsonDialog(props: SubtreeJsonDialogProps) {
  const { node, open, onClose } = props

  const nested = useMemo(
    () => (open && node ? canvas.makeNested(node as any) : undefined),
    [open, node],
  )

  const handleValidate = useCallback(
    (value: unknown) => {
      if (!node) return 'No element selected'
      return validateSubtree(withRootIdentity(value, node))
    },
    [node],
  )

  const handleSave = useCallback(
    (_event: unknown, value: unknown) => {
      if (!node) return
      const parsed = withRootIdentity(value, node)
      mintMissingIds(parsed)

      // Full-map rebuild: drop the old subtree's descendants, splice in the
      // new flat nodes, and apply as one undoable replacement.
      const map = {
        ...(toJS(canvas.toJSON().nodes) as Record<
          string,
          Aglyn.NodeSchema<any>
        >),
      }
      for (const staleId of collectSubtreeIds(map, node.$id)) {
        delete map[staleId]
      }
      const flat = (canvas.constructor as any).denormalizeNodes(
        [parsed],
        node.parentId!,
        {},
      )
      Object.assign(map, flat)
      canvas.applyNodes(map as any)
    },
    [node],
  )

  return (
    <JsonEditor
      open={open}
      title="Edit element JSON"
      description={
        'This element and its children only — the rest of the screen is ' +
        'untouched. Save replaces the subtree (undo restores it).'
      }
      defaultValue={nested as any}
      validate={handleValidate}
      onSave={handleSave}
      onClose={onClose}
    />
  )
}
SubtreeJsonDialog.displayName = 'SubtreeJsonDialog'

/**
 * The element being edited, held ABOVE the menu that opens it (AGL-3208).
 *
 * This dialog used to be rendered inside `NodeContextMenu`'s own `Paper`,
 * which made it live exactly as long as that menu. Both hosts of the menu end
 * it on the first interaction with anything else: the Hierarchy panel wraps it
 * in a `ClickAwayListener`, and the canvas overlay hands it to a `Tooltip` as
 * its title. A MUI dialog is portalled to `document.body`, so a click inside
 * it IS "away" from the listener, and a pointer entering it HAS left the
 * tooltip's anchor. Opening the editor and then touching it dismissed the
 * menu, unmounted this component with it, and read as the dialog closing
 * itself — the reported "says loading then auto closes", on top of a Monaco
 * that could not load at all.
 *
 * A module-scoped box rather than a context: the two menus are rendered by
 * different trees, and what they need to share is one piece of state that
 * outlives both.
 */
const editing = observable.box<Aglyn.NodeSchema<any> | null>(null, {
  deep: false,
})

/** Open the subtree editor on `node`. Safe to call as the menu dismisses. */
export const openSubtreeJson = action(
  'openSubtreeJson',
  (node: Aglyn.NodeSchema<any>) => editing.set(node),
)

/** Close the subtree editor, whatever opened it. */
export const closeSubtreeJson = action('closeSubtreeJson', () =>
  editing.set(null),
)

/**
 * The single mount for the subtree editor, rendered once per besigner surface
 * by `BesignerRootProviderComponent` (AGL-3208).
 */
export const SubtreeJsonDialogHost = observer(() => {
  const node = editing.get()
  // The node is kept for the close transition: clearing the box and the
  // content in the same frame empties the dialog while it is still on screen.
  const shown = useRef<Aglyn.NodeSchema<any> | null>(null)
  if (node) shown.current = node
  return (
    <SubtreeJsonDialog
      node={node ?? shown.current}
      open={Boolean(node)}
      onClose={closeSubtreeJson}
    />
  )
})
SubtreeJsonDialogHost.displayName = 'SubtreeJsonDialogHost'

export default SubtreeJsonDialog
