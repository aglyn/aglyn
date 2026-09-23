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

import type * as Aglyn from '@aglyn/aglyn'
import {
  canvas,
  COMPONENT_NODE_ID_PREFIX,
  LAYOUT_SLOT_COMPONENT_ID,
  NODE_ROOT_ID,
} from '@aglyn/aglyn'
import { BesignerPanelTabFlag } from '@aglyn/besigner'
import { Button, ListSubheader, Menu, MenuItem } from '@mui/material'
import { comparer, reaction, toJS } from 'mobx'
import { observer } from 'mobx-react-lite'
import { type MouseEvent, useCallback, useEffect, useState } from 'react'
import { useLayoutChromeContext } from '../contexts/layout-chrome-context'
import { layoutStyleSelection } from '../contexts/layout-style-selection'
import { useAglynBesignerSetPanel } from '../hooks/use-aglyn-besigner-panel'

/** One pickable element of the layout, in hierarchy order. */
export interface LayoutStylePickerEntry {
  /** The element's id in the layout's own node map. */
  nodeId: string
  /** The name the hierarchy would show. */
  label: string
  /** Nesting depth under the layout root (the root itself is 0). */
  depth: number
}

/**
 * The elements a page may restyle, walked from the chrome canvas's root in
 * document order (AGL-3286).
 *
 * The chrome canvas has its reusable components grafted in, so anything
 * wearing a component graft id is the COMPONENT's, not the layout's: it has
 * no key in the layout's node map to be overridden by, and it is neither
 * listed nor descended into. The instance itself is listed — the graft keeps
 * its id — and styling it restyles the component's outer element.
 */
export function listLayoutStyleEntries(
  chrome: Aglyn.CanvasManager | undefined,
): LayoutStylePickerEntry[] {
  const root = chrome?.getNode(NODE_ROOT_ID)
  if (!root) return []
  const entries: LayoutStylePickerEntry[] = []
  const walk = (node: Aglyn.NodeSchema<any>, depth: number) => {
    if (String(node.$id).startsWith(COMPONENT_NODE_ID_PREFIX)) return
    const label =
      node.$id === NODE_ROOT_ID
        ? 'Whole layout'
        : node.componentId === LAYOUT_SLOT_COMPONENT_ID
          ? 'Page content area'
          : node.name || node.labelShort || String(node.$id)
    entries.push({ nodeId: String(node.$id), label, depth })
    for (const child of node.children ?? []) walk(child, depth + 1)
  }
  walk(root, 0)
  return entries
}

/**
 * This screen's overrides for one layout as the editor holds them right now
 * — off the screen canvas root, where they ride until the save lifts them
 * out (`injectLayoutStyleOverrides`) — as a plain record that only changes
 * identity when its content does, so a memo keyed on it rebuilds only then.
 */
export function useCanvasLayoutStyleOverrides(
  layoutId: string | null | undefined,
): Record<string, Record<string, unknown>> | undefined {
  const read = useCallback(() => {
    if (!layoutId) return undefined
    const value = canvas.getNode(NODE_ROOT_ID)?.layoutStyleOverrides?.[layoutId]
    return value ? (toJS(value) as Record<string, Record<string, unknown>>) : undefined
  }, [layoutId])
  const [value, setValue] = useState(read)
  useEffect(
    () =>
      reaction(read, (next) => setValue(next), {
        equals: comparer.structural,
        fireImmediately: true,
      }),
    [read],
  )
  return value
}

export interface LayoutStylePickerButtonProps {
  layoutId: string
  layoutName?: string
}

/**
 * "Style the layout on this page" (AGL-3286): the entry point on the
 * locked-layout banner. Lists the layout's elements by name, nested as the
 * hierarchy nests them, marks the ones this page already restyles, and
 * picking one opens the Styles tab on it — styles only; the layout's content
 * stays the layout's.
 */
export const LayoutStylePickerButton = observer(
  (props: LayoutStylePickerButtonProps) => {
    const { layoutId, layoutName } = props
    const { chromeCanvas } = useLayoutChromeContext()
    const setPanel = useAglynBesignerSetPanel()
    const [anchor, setAnchor] = useState<HTMLElement | null>(null)
    const entries = listLayoutStyleEntries(chromeCanvas)
    const overridden =
      canvas.getNode(NODE_ROOT_ID)?.layoutStyleOverrides?.[layoutId] ?? {}
    const current = layoutStyleSelection.current

    const handleOpen = useCallback(
      (event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget),
      [],
    )
    const handleClose = useCallback(() => setAnchor(null), [])
    const handlePick = useCallback(
      (entry: LayoutStylePickerEntry) => () => {
        layoutStyleSelection.select({
          layoutId,
          layoutName,
          nodeId: entry.nodeId,
          label: entry.label,
        })
        setPanel('panelRight', (prev) => ({
          ...prev,
          toggled: true,
          tab: BesignerPanelTabFlag.ELEMENT_STYLES,
        }))
        setAnchor(null)
      },
      [layoutId, layoutName, setPanel],
    )

    return (
      <>
        <Button
          color="inherit"
          size="small"
          disabled={!entries.length}
          onClick={handleOpen}
          aria-haspopup="menu"
          aria-expanded={anchor ? 'true' : undefined}
        >
          {'Style the layout on this page'}
        </Button>
        <Menu
          anchorEl={anchor}
          open={Boolean(anchor)}
          onClose={handleClose}
          slotProps={{ paper: { sx: { maxHeight: 420 } } }}
        >
          <ListSubheader>{'Pick an element to restyle'}</ListSubheader>
          {entries.map((entry) => (
            <MenuItem
              key={entry.nodeId}
              dense
              selected={
                current?.layoutId === layoutId &&
                current?.nodeId === entry.nodeId
              }
              onClick={handlePick(entry)}
              sx={{ pl: 2 + entry.depth * 1.5 }}
            >
              {entry.label}
              {entry.nodeId in overridden ? ' •' : ''}
            </MenuItem>
          ))}
        </Menu>
      </>
    )
  },
)
LayoutStylePickerButton.displayName = 'LayoutStylePickerButton'

export default LayoutStylePickerButton
