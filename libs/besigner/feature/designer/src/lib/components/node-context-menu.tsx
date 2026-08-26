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
import * as Besigner from '@aglyn/besigner'
import {
  BesignerPanelTabFlag,
  setBesignerPanels,
} from '@aglyn/besigner'
import {
  ICON_VARIANT_MODIFY_COPY,
  ICON_VARIANT_MODIFY_DELETE,
  ICON_VARIANT_MODIFY_DUPLICATE,
  ICON_VARIANT_MODIFY_MOVE_DOWN,
  ICON_VARIANT_MODIFY_MOVE_IN,
  ICON_VARIANT_MODIFY_MOVE_OUT,
  ICON_VARIANT_MODIFY_MOVE_UP,
  ICON_VARIANT_MODIFY_PASTE,
  ICON_VARIANT_VISIBILITY_HIDDEN,
  ICON_VARIANT_VISIBILITY_SHOWN,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Divider,
  ListItemIcon,
  ListItemText,
  MenuItem,
  MenuList,
  Paper,
  type PaperProps,
  Typography,
} from '@mui/material'
import { action } from 'mobx'
import { observer } from 'mobx-react-lite'
import { ChangeEvent, forwardRef, useCallback, useState } from 'react'
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'
import useAddElementDrawerCallback from '../hooks/use-add-element-drawer-callback'
import useBesignerAppContext from '../hooks/use-besigner-app-context'
import {
  useCopyElementsCallback,
  usePasteElementsCallback,
} from '../hooks/use-clipboard-callbacks'
import useDeleteElementCallback, {
  useDeleteElementsCallback,
} from '../hooks/use-delete-element-callback'
import {
  useMoveNodeInCallback,
  useMoveNodeOutCallback,
} from '../hooks/use-move-node-callbacks'
import {
  isNodeHiddenOnSite,
  nodePropsWithHiddenOnSite,
} from '../utils/canvas-reveal'
import SubtreeJsonDialog from './subtree-json-dialog.component'

export interface NodeContextMenuProps extends PaperProps {
  node: Aglyn.NodeSchema<any>
  /** Invoked when a menu action should dismiss the hosting menu/tooltip. */
  onAction?: () => void
}

export const NodeContextMenu = observer(
  forwardRef<any, NodeContextMenuProps>((props, ref) => {
    const { node, onAction, ...rest } = props

    const isRootNode = Aglyn.canvas.isRootNode(node)
    // Multi-selection (AGL-11): ambiguous single-target actions hide or
    // disable; Duplicate/Delete apply to the whole selection.
    const multi = Besigner.focus.hasMultipleSelected()
    const app = useBesignerAppContext()
    const handleAddElementClick = useAddElementDrawerCallback()
    const elementRef = Besigner.refs.get(node?.$id)
    const [moreOpen, setMoreOpen] = useState(false)
    const [moreButton, moreButtonRef] = useState<HTMLButtonElement | null>(null)
    const [jsonOpen, setJsonOpen] = useState(false)

    const closeMore = useCallback(() => setMoreOpen(false), [])
    const openMore = useCallback(() => setMoreOpen(true), [])

    const handleDuplicateClick = useCallback(
      (e: ChangeEvent<unknown>) => {
        if (isRootNode) return
        onAction?.()
        const targets = multi ? Besigner.focus.getSelected() : [node]
        for (const target of targets) {
          if (target && !Aglyn.canvas.isRootNode(target)) {
            Aglyn.canvas.duplicateNode(target)
          }
        }
      },
      [node, isRootNode, multi, onAction],
    )

    const handleModifyClick = useCallback(
      (e: ChangeEvent<unknown>) => {
        setBesignerPanels(app, {
          panels: (panels) => ({
            ...panels,
            panelRight: {
              ...panels.panelRight,
              toggled: true,
              tab: BesignerPanelTabFlag.ELEMENT_PROPS_FORM,
            },
          }),
        })
      },
      [app],
    )
    const handleMoveUp = useCallback(
      (e: ChangeEvent<unknown>) => {
        if (isRootNode) return
        Aglyn.canvas.reorderNode(node, node?.index - 1)
      },
      [node, isRootNode],
    )
    const handleMoveDown = useCallback(
      (e: ChangeEvent<unknown>) => {
        if (isRootNode) return
        Aglyn.canvas.reorderNode(node, node?.index + 1)
      },
      [node, isRootNode],
    )

    /**
     * Reparenting by clicking (AGL-1405). Until these two existed, the only
     * way to move a node into a different container was to drag it — so a
     * node that ended up somewhere it can never render (AGL-1388) could only
     * be rescued by hand-editing the document's JSON.
     *
     * `canMove*` is read through the observer, so the items enable and
     * disable as the selection moves, and both refuse anything the renderer
     * could not draw rather than accepting it and stranding the subtree.
     */
    const moveNodeOut = useMoveNodeOutCallback()
    const moveNodeIn = useMoveNodeInCallback()
    const canMoveOut = !multi && Besigner.canMoveNodeOut(node)
    const canMoveIn = !multi && Besigner.canMoveNodeIn(node)

    const handleMoveOut = useCallback(() => {
      onAction?.()
      moveNodeOut(node)
    }, [node, onAction, moveNodeOut])

    const handleMoveIn = useCallback(() => {
      onAction?.()
      moveNodeIn(node)
    }, [node, onAction, moveNodeIn])

    const handleParentOnClick = useCallback(
      (e: ChangeEvent<unknown>) => {
        if (isRootNode) return
        Besigner.focus.setSelectedNode(node?.parent)
      },
      [node, isRootNode],
    )

    const handleParentOnMouseEnter = useCallback(
      (e: ChangeEvent<unknown>) => {
        if (isRootNode) return
        Besigner.focus.setHoveredNode(node)
      },
      [node, isRootNode],
    )
    const handleParentOnMouseLeave = useCallback(
      (e: ChangeEvent<unknown>) => {
        if (isRootNode) return
        Besigner.focus.clearHover()
      },
      [isRootNode],
    )

    const copyElements = useCopyElementsCallback()
    const pasteElements = usePasteElementsCallback()
    const handleCopyClick = useCallback(() => {
      if (isRootNode) return
      onAction?.()
      copyElements(multi ? Besigner.focus.getSelected() : [node])
    }, [node, isRootNode, multi, onAction, copyElements])

    const handlePasteClick = useCallback(() => {
      onAction?.()
      pasteElements(node)
    }, [node, onAction, pasteElements])

    // Observed, so the item enables the moment something is copied — even
    // from another document, where the entry arrives via localStorage.
    const canPaste = Besigner.clipboard.hasContent()
    const clipboardLabels = Besigner.clipboard.getLabels()

    /**
     * Start hidden on the published site (AGL-1476).
     *
     * The hidden class had no control that SET it. The eye on a hierarchy row
     * only appears once an element already carries the class, and it is
     * canvas-only — so the single way to author a mega-menu panel, a drawer,
     * or anything else an interaction reveals at runtime was to know the
     * literal string `aglyn-hidden` and type it into the Classes box. An
     * element property with no picker is a missing feature, not a
     * power-user path.
     *
     * The class stays the storage: the published site's stylesheet, the
     * interaction builder's show/hide steps and the canvas reveal all key off
     * it. This writes it, which is the part that was missing.
     */
    const [, setRevealedNodeIds] = useAglynBesignerFlag('revealedNodeIds')
    const hiddenOnSite = isNodeHiddenOnSite(node as never)
    const handleToggleHiddenClick = useCallback(() => {
      if (isRootNode) return
      onAction?.()
      const targets = multi ? Besigner.focus.getSelected() : [node]
      const changed: string[] = []
      action(() => {
        for (const target of targets) {
          if (!target || Aglyn.canvas.isRootNode(target)) continue
          const props = nodePropsWithHiddenOnSite(target as never, !hiddenOnSite)
          if (!props) continue
          target.props = props as never
          changed.push(target.$id)
        }
      })()
      // Showing an element again retires its canvas reveal with it. The flag
      // is only meaningful for something the site hides, so leaving an entry
      // behind means the next hide silently starts revealed. Hiding sets
      // nothing: hidden is hidden, and selecting the element — which
      // whichever surface opened this menu has already done — is what shows
      // it while it is being designed.
      if (hiddenOnSite && changed.length) {
        setRevealedNodeIds((current) =>
          (current ?? []).filter((id) => !changed.includes(id)),
        )
      }
    }, [node, isRootNode, multi, hiddenOnSite, onAction, setRevealedNodeIds])

    const deleteElementCallback = useDeleteElementCallback()
    const deleteElementsCallback = useDeleteElementsCallback()
    const handleDeleteClick = useCallback(() => {
      closeMore()
      onAction?.()
      if (multi) void deleteElementsCallback(Besigner.focus.getSelected())
      else void deleteElementCallback(node)
    }, [
      node,
      multi,
      closeMore,
      onAction,
      deleteElementCallback,
      deleteElementsCallback,
    ])

    return (
      <Paper
        ref={ref}
        sx={{
          width: 240,
          // Caps itself rather than growing past the window (AGL-1405). The
          // Popper can only slide a menu back inside the viewport if it FITS
          // in one; a taller menu was laid out past the bottom of the
          // document and the page grew a scrollbar around it. `dvh` so a
          // mobile browser's retracting toolbar does not leave the last item
          // under it.
          maxHeight: 'min(560px, calc(100dvh - 24px))',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
        {...rest}
      >
        <MenuList dense>
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{
              px: 1,
              py: 0.15,
              mb: 1,
              textAlign: 'center',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              backgroundColor: (theme) =>
                `rgba(${(theme as any).vars.palette.primary.darkChannel} / 0.12)`,
            }}
          >
            {node?.labelShort}
          </Typography>
          {multi ? null : (
            <MenuItem
              onClick={() => {
                onAction?.()
                handleAddElementClick(node)
              }}
            >
              <ListItemText inset>Add element</ListItemText>
            </MenuItem>
          )}
          {multi ? null : <Divider />}
          <MenuItem
            onClick={handleParentOnClick}
            disabled={isRootNode || multi}
            onMouseEnter={handleParentOnMouseEnter}
            onPointerEnter={handleParentOnMouseEnter}
            onMouseLeave={handleParentOnMouseLeave}
            onPointerLeave={handleParentOnMouseLeave}
          >
            <ListItemText inset>Select parent</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={handleMoveUp}
            disabled={isRootNode || multi || !(node?.index > 0)}
          >
            <ListItemIcon>
              <MdiIcon
                fontSize="inherit"
                path={ICON_VARIANT_MODIFY_MOVE_UP.path}
              />
            </ListItemIcon>
            <ListItemText>Shift up</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={handleMoveDown}
            disabled={
              isRootNode ||
              multi ||
              !(node?.index < node?.parent?.nodes?.length - 1)
            }
          >
            <ListItemIcon>
              <MdiIcon
                fontSize="inherit"
                path={ICON_VARIANT_MODIFY_MOVE_DOWN.path}
              />
            </ListItemIcon>
            <ListItemText>Shift down</ListItemText>
          </MenuItem>
          <MenuItem onClick={handleMoveOut} disabled={!canMoveOut}>
            <ListItemIcon>
              <MdiIcon
                fontSize="inherit"
                path={ICON_VARIANT_MODIFY_MOVE_OUT.path}
              />
            </ListItemIcon>
            <ListItemText>Move out of container</ListItemText>
          </MenuItem>
          <MenuItem onClick={handleMoveIn} disabled={!canMoveIn}>
            <ListItemIcon>
              <MdiIcon
                fontSize="inherit"
                path={ICON_VARIANT_MODIFY_MOVE_IN.path}
              />
            </ListItemIcon>
            <ListItemText>Move into element above</ListItemText>
          </MenuItem>
          {multi ? null : (
            <MenuItem onClick={() => setJsonOpen(true)}>
              <ListItemText inset>Edit JSON</ListItemText>
            </MenuItem>
          )}
          <MenuItem disabled={isRootNode} onClick={handleToggleHiddenClick}>
            <ListItemIcon>
              <MdiIcon
                fontSize="inherit"
                path={
                  hiddenOnSite
                    ? ICON_VARIANT_VISIBILITY_SHOWN.path
                    : ICON_VARIANT_VISIBILITY_HIDDEN.path
                }
              />
            </ListItemIcon>
            <ListItemText
              secondary={
                hiddenOnSite
                  ? 'Visitors see it from the first paint'
                  : 'The eye on its Hierarchy row does the same'
              }
              slotProps={{ secondary: { sx: { whiteSpace: 'normal' } } }}
            >
              {hiddenOnSite ? 'Show on published site' : 'Hide on published site'}
            </ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem disabled={isRootNode} onClick={handleCopyClick}>
            <ListItemIcon>
              <MdiIcon fontSize="inherit" path={ICON_VARIANT_MODIFY_COPY.path} />
            </ListItemIcon>
            <ListItemText>{multi ? 'Copy selection' : 'Copy'}</ListItemText>
          </MenuItem>
          <MenuItem disabled={!canPaste} onClick={handlePasteClick}>
            <ListItemIcon>
              <MdiIcon
                fontSize="inherit"
                path={ICON_VARIANT_MODIFY_PASTE.path}
              />
            </ListItemIcon>
            <ListItemText
              slotProps={{
                primary: {
                  sx: {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
              }}
            >
              {clipboardLabels.length === 1
                ? `Paste ${clipboardLabels[0]}`
                : clipboardLabels.length > 1
                  ? `Paste ${clipboardLabels.length} elements`
                  : 'Paste'}
            </ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem disabled={isRootNode} onClick={handleDuplicateClick}>
            <ListItemIcon>
              <MdiIcon
                fontSize="inherit"
                path={ICON_VARIANT_MODIFY_DUPLICATE.path}
              />
            </ListItemIcon>
            <ListItemText>
              {multi ? 'Duplicate selection' : 'Duplicate'}
            </ListItemText>
          </MenuItem>
          <MenuItem disabled={isRootNode} onClick={handleDeleteClick}>
            <ListItemIcon>
              <MdiIcon
                fontSize="inherit"
                path={ICON_VARIANT_MODIFY_DELETE.path}
              />
            </ListItemIcon>
            <ListItemText>{multi ? 'Delete selection' : 'Delete'}</ListItemText>
          </MenuItem>
        </MenuList>
        <SubtreeJsonDialog
          node={node}
          open={jsonOpen}
          onClose={() => {
            setJsonOpen(false)
            onAction?.()
          }}
        />
      </Paper>
    )
  }),
)
NodeContextMenu.displayName = 'NodeContextMenu'

export default NodeContextMenu
