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
import { LAYOUT_SLOT_COMPONENT_ID, NODE_ROOT_ID } from '@aglyn/aglyn'
import { BesignerPanelTabFlag } from '@aglyn/besigner'
import { ListSubheader, Menu, MenuItem } from '@mui/material'
import { makeAutoObservable } from 'mobx'
import { observer } from 'mobx-react-lite'
import { useCallback } from 'react'
import { useLayoutChromeContext } from '../contexts/layout-chrome-context'
import { layoutStyleSelection } from '../contexts/layout-style-selection'
import { useAglynBesignerSetPanel } from '../hooks/use-aglyn-besigner-panel'

const LEAF_STAMP = '[data-aglyn^="leaf:"]'

/** The layout element a click on the canvas landed on. */
export interface LayoutPart {
  /** The element's id in the LAYOUT's own node map. */
  nodeId: string
  /** The element's name as the hierarchy shows it. */
  label: string
}

const leafIdOf = (element: Element) =>
  element.getAttribute('data-aglyn')?.slice('leaf:'.length) ?? ''

/**
 * The layout element under a click on the canvas, or null for anything else.
 *
 * The layout's elements and the page's own share one shadow root, and every
 * one of them carries the same `leaf:<id>` stamp, so the stamp alone cannot
 * say whose a node is. Whose it is: a node the layout's canvas holds, that is
 * not inside the layout's slot — the slot is where the page's own content
 * goes, and the page's ids are free to repeat a layout's.
 */
export function findLayoutPart(
  target: EventTarget | null,
  chromeCanvas: Pick<Aglyn.CanvasManager, 'getNode'> | undefined,
): LayoutPart | null {
  if (!chromeCanvas || !(target instanceof Element)) return null
  const leaf = target.closest(LEAF_STAMP)
  if (!leaf) return null
  const nodeId = leafIdOf(leaf)
  const node = chromeCanvas.getNode(nodeId)
  if (
    !node ||
    nodeId === NODE_ROOT_ID ||
    node.componentId === LAYOUT_SLOT_COMPONENT_ID
  ) {
    return null
  }
  for (
    let above = leaf.parentElement?.closest(LEAF_STAMP);
    above;
    above = above.parentElement?.closest(LEAF_STAMP)
  ) {
    if (
      chromeCanvas.getNode(leafIdOf(above))?.componentId ===
      LAYOUT_SLOT_COMPONENT_ID
    ) {
      return null
    }
  }
  return {
    nodeId,
    label: node.labelShort || node.componentSchema?.displayName || 'Element',
  }
}

/** Which layout part's menu is open, and where. */
class LayoutPartMenuStore {
  part: LayoutPart | null = null
  at: { left: number; top: number } | null = null

  constructor() {
    makeAutoObservable(this)
  }

  open(part: LayoutPart, at: { left: number; top: number }) {
    this.part = part
    this.at = at
  }

  close() {
    this.part = null
    this.at = null
  }
}

export const layoutPartMenu = new LayoutPartMenuStore()

/**
 * What a click on the shared layout's header, footer or any other part of it
 * offers: edit the layout in a new tab, or restyle that part for this page.
 *
 * The layout's elements are locked on a page — their content is the
 * layout's — and they used to answer a click with nothing at all. The way to
 * the layout was the banner above the canvas, which a phone hides most of
 * the canvas to show. A new tab keeps the page open where it was.
 *
 * Rendered in the console's layer, not the canvas's: the canvas is themed as
 * the site, and a menu there would wear the site's palette.
 */
export const LayoutPartMenu = observer(() => {
  const { layout } = useLayoutChromeContext()
  const setPanel = useAglynBesignerSetPanel()
  const { part, at } = layoutPartMenu
  const close = useCallback(() => layoutPartMenu.close(), [])

  const editInNewTab = useCallback(() => {
    if (layout?.editHref) {
      window.open(layout.editHref, '_blank', 'noopener')
    }
    layoutPartMenu.close()
  }, [layout?.editHref])

  const restyle = useCallback(() => {
    if (part && layout) {
      layoutStyleSelection.select({
        layoutId: layout.id,
        layoutName: layout.name,
        nodeId: part.nodeId,
        label: part.label,
      })
      setPanel('panelRight', (prev) => ({
        ...prev,
        toggled: true,
        tab: BesignerPanelTabFlag.ELEMENT_STYLES,
      }))
    }
    layoutPartMenu.close()
  }, [part, layout, setPanel])

  return (
    <Menu
      open={Boolean(part && at && layout)}
      onClose={close}
      anchorReference="anchorPosition"
      anchorPosition={at ?? undefined}
    >
      <ListSubheader sx={{ lineHeight: 2.5 }}>
        {`${part?.label ?? ''} · ${
          layout?.name ? `Layout "${layout.name}"` : 'Shared layout'
        }`}
      </ListSubheader>
      <MenuItem dense disabled={!layout?.editHref} onClick={editInNewTab}>
        {'Edit layout in a new tab'}
      </MenuItem>
      <MenuItem dense onClick={restyle}>
        {'Restyle on this page'}
      </MenuItem>
    </Menu>
  )
})
LayoutPartMenu.displayName = 'LayoutPartMenu'

export default LayoutPartMenu
