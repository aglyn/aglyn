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
  ICON_VARIANT_COLLAPSIBLE_CLOSE,
  ICON_VARIANT_COLLAPSIBLE_OPEN,
  ICON_VARIANT_MODIFY_DRAG,
  ICON_VARIANT_SHOW_MORE_VERTICAL,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import { noop } from '@aglyn/shared-util-tools'
import {
  Box,
  BoxProps,
  ClickAwayListener,
  Collapse,
  Divider,
  IconButton,
  List as MuiList,
  ListItem as MuiListItem,
  ListItemButton as MuiListItemButton,
  listItemButtonClasses,
  listItemClasses,
  ListItemIcon as MuiListItemIcon,
  type ListItemIconProps as MuiListItemIconProps,
  type ListItemProps as MuiListItemProps,
  ListItemText as MuiListItemText,
  type ListProps as MuiListProps,
  Popper,
  Stack,
} from '@mui/material'
import clsx from 'clsx'
import uniq from 'lodash-es/uniq'
import { observer } from 'mobx-react-lite'
import type { ComponentProps } from 'react'
import {
  type ChangeEvent,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import useLeafDrag from '../hooks/use-leaf-drag'
import useLeafDrop from '../hooks/use-leaf-drop'
import ComponentIconComponent from './component-icon.component'
import NodeContextMenu from './node-context-menu'

const classKey = generateComponentClassKeys('TreeView', [
  'root',
  'subTreeView',
  'treeItem',
  'treeListItem',
  'dragHandle',
  'moreButton',
  'itemSelected',
  'itemHovered',
  'itemIsDragging',
  'itemIsDragOver',
])

const TreeView = styled(MuiList)<MuiListProps>(({ theme }) => ({
  alignItems: 'stretch',
  flexDirection: 'column',
  width: 'fit-content',
  minWidth: '100%',

  [`& .${listItemButtonClasses.root}`]: {
    zIndex: 0,
    paddingTop: 0,
    paddingBottom: 0,
    // paddingLeft: 0,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
    [[
      `&:hover`,
      `&.${listItemButtonClasses.focusVisible}`,
      `&.${listItemButtonClasses.selected}`,
      `&.${classKey.itemSelected}`,
    ].join(',')]: {
      backgroundColor: 'transparent',
    },
  },

  [`& .${listItemClasses.root}`]: {
    alignItems: 'stretch',
    flexDirection: 'column',

    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,

    [`> .${classKey.treeListItem}`]: {
      borderTopLeftRadius: 4,
      borderBottomLeftRadius: 4,
      [`& .${classKey.dragHandle}, & .${classKey.moreButton}`]: {
        visibility: 'hidden',
      },
      // An open menu keeps its own button on screen — the pointer has left
      // the row to reach the menu, so the hover rule no longer holds it.
      [`& .${classKey.moreButton}[aria-expanded='true']`]: {
        visibility: 'visible',
      },

      [`&:hover, &.${classKey.itemHovered}`]: {
        [`& .${classKey.dragHandle}, & .${classKey.moreButton}`]: {
          visibility: 'visible',
        },
        backgroundColor: `rgba(${(theme as any).vars.palette.primary.darkChannel} / calc(${(theme as any).vars.palette.action.hoverOpacity} + 0.2))`,
        [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
          backgroundColor: `rgba(${(theme as any).vars.palette.primary.darkChannel} / calc(${(theme as any).vars.palette.action.focusOpacity} + 0.3))`,
        },
      },
      [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
        backgroundColor: `rgba(${(theme as any).vars.palette.primary.darkChannel} / calc(${(theme as any).vars.palette.action.focusOpacity} + 0.2))`,
      },
    },
    [`&.${classKey.itemSelected}`]: {
      [`> .${classKey.treeListItem}`]: {
        backgroundColor: `rgba(${(theme as any).vars.palette.secondary.mainChannel} / ${(theme as any).vars.palette.action.selectedOpacity})`,

        [`&:hover, &.${classKey.itemHovered}`]: {
          backgroundColor: `rgba(${(theme as any).vars.palette.secondary.mainChannel} / calc(${(theme as any).vars.palette.action.selectedOpacity} + 0.2))`,

          [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
            backgroundColor: `rgba(${(theme as any).vars.palette.secondary.mainChannel} / calc(${(theme as any).vars.palette.action.selectedOpacity} + 0.2))`,
          },
        },
        [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
          backgroundColor: `rgba(${(theme as any).vars.palette.secondary.mainChannel} / ${(theme as any).vars.palette.action.activatedOpacity})`,
        },
      },
    },
  },
}))
TreeView.displayName = 'TreeView'

/**
 * The hierarchy's depth cue (AGL-2486).
 *
 * What this replaces was a per-level background tint, and every tint of that
 * shape has the same fault: it COMPOSITES. Each ancestor of the selection
 * painted its own overlay, so the row at depth n sat under n of them and its
 * background walked one step further toward the ink for every level. Against
 * the console's light palette the previous ramp crossed WCAG AA at the
 * seventh level (3.85:1) and reached 1.33:1 by the twelfth — the label and
 * the row had met. Dark mode looked right for the arithmetic reason that the
 * same darkening moves AWAY from light text, which is exactly why no single
 * tint direction can serve both schemes.
 *
 * Capping the ramp was tried and is not a fix either. A cap only decides
 * WHERE the cue stops working: past the cap every level paints the same
 * background, so depth 6 and depth 16 are indistinguishable, and the issue
 * asks for a cue that reads at depth 8 as clearly as at depth 1.
 *
 * So the cue is POSITIONAL rather than tonal. Each nesting level draws one
 * vertical guide in the row's indent gutter — depth is read by counting
 * lines, the way a tree view is read everywhere else. Guides are a fixed
 * colour and a fixed alpha at every level, and they live in the gutter, so
 * nothing is painted behind the label at all: the row's background is
 * `background.paper` at depth 1 and at depth 40, in both schemes, and the
 * text-vs-background contrast ratio is therefore a constant rather than a
 * function of depth. `hierarchy-depth-contrast.spec.ts` measures it.
 *
 * The branch containing the selection is still marked — that is what the old
 * tint was for — by colouring THAT row's guides with the accent instead. One
 * row, one element, no stacking possible.
 */

/** Horizontal indent one nesting level adds, in px. */
export const HIERARCHY_INDENT_STEP = 23

/** Width of one guide line, in px. */
export const HIERARCHY_GUIDE_WIDTH = 1

/**
 * Alpha of a guide, over the ink colour of whichever scheme is active.
 *
 * Drawn from `text.primary` rather than `divider` so the one value serves
 * both schemes: the ink is dark on light and light on dark, so the guide
 * always moves AWAY from the surface it sits on instead of toward the label
 * — the failure mode of a fixed-direction tint, in miniature.
 *
 * 0.45 clears WCAG 1.4.11 (3:1 for a non-text cue) in the WORST of the four
 * surface/scheme pairings, and is not a number picked by eye: the measured
 * ratios are 3.35 and 3.32 in light, 3.89 and 4.19 in dark. `divider`, at
 * 0.12, measures 1.31 — legible as a hairline between panels, invisible as
 * the thing you are being asked to count. `hierarchy-depth-contrast.spec.ts`
 * re-derives all four.
 */
export const HIERARCHY_GUIDE_ALPHA = 0.45

/**
 * Guides a row at `depth` draws, and how wide a gutter they occupy.
 *
 * Deliberately unbounded and deliberately linear: the count IS the depth, so
 * the cue keeps saying something new at every level. It can afford to,
 * because nothing here is cumulative — a guide is drawn beside the label,
 * never behind it.
 */
export function hierarchyGuideCount(depth: number): number {
  // `strictNullChecks` is off repo-wide, so compare rather than truth-test.
  return depth >= 2 ? depth - 1 : 0
}

export function hierarchyGutterWidth(depth: number): number {
  return hierarchyGuideCount(depth) * HIERARCHY_INDENT_STEP
}

/**
 * The depth-dependent CSS a tree row gets, as a plain object.
 *
 * Exported so the contrast spec can read the STYLES rather than a
 * description of them: the check that no key here is a background COLOUR is
 * what makes "the depth cue never accumulates toward the text" a property of
 * the code instead of a claim in a comment.
 */
export function hierarchyDepthStyles(
  depth: number,
  colors: { guide: string; activeGuide: string },
) {
  const gutter = hierarchyGutterWidth(depth)
  if (!(gutter > 0)) return {}
  const gutterFor = (color: string) => ({
    // A gradient rather than n nested borders: the rows are siblings that
    // pad themselves (see the button's `paddingLeft`), not physically
    // nested boxes, so there is no element per level to hang a border on.
    backgroundImage: `repeating-linear-gradient(to right, ${color} 0 ${HIERARCHY_GUIDE_WIDTH}px, transparent ${HIERARCHY_GUIDE_WIDTH}px ${HIERARCHY_INDENT_STEP}px)`,
    backgroundRepeat: 'no-repeat',
    // Clipped to the indent gutter, so the guides stop where the label
    // starts and no line is ever drawn behind text.
    backgroundSize: `${gutter}px 100%`,
    backgroundPosition: 'left top',
  })
  const row = `> .${classKey.treeListItem} > .${listItemButtonClasses.root}`
  return {
    [row]: gutterFor(colors.guide),
    // The row whose subtree holds the selection. Applied to the row's own
    // button — one element per row, never an ancestor box wrapping its
    // descendants — so however many ancestors match, none of them can
    // stack on top of another.
    [`&:has(.${classKey.subTreeView}):has(.${classKey.itemSelected}) ${row}`]:
      gutterFor(colors.activeGuide),
  }
}

const TreeItem = styled(MuiListItem, {
  shouldForwardProp(propName) {
    return propName !== 'depth'
  },
})<MuiListItemProps & { depth: number }>(({ theme, depth = 1 }) => {
  const tv = (theme as any).vars || theme
  return hierarchyDepthStyles(depth, {
    guide: `rgba(${tv.palette.text.primaryChannel} / ${HIERARCHY_GUIDE_ALPHA})`,
    // Full strength, and the same accent the selected row already uses. A
    // hairline is a small target for a hue cue, and `#e040fb` measures 3.34
    // against the lightest surface and 3.78 against the darkest — dropping
    // its alpha to soften it would spend the whole margin.
    activeGuide: tv.palette.secondary.main,
  })
})
TreeItem.displayName = 'TreeItem'

interface DragHandleProps extends MuiListItemIconProps {
  draggingEnabled?: boolean
}

const DragHandle = styled(MuiListItemIcon, {
  shouldForwardProp(propName) {
    return propName !== 'draggingEnabled'
  },
})<DragHandleProps>(({ theme, draggingEnabled }) => ({
  minWidth: 23,
  padding: theme.spacing(0.75),
  paddingLeft: 0,
  borderRadius: '4px',
  cursor: 'move',
  pointerEvents: !draggingEnabled ? 'none' : undefined,
  opacity: !draggingEnabled ? 0.5 : undefined,
  zIndex: 1,
}))
DragHandle.displayName = 'DragHandle'

interface NodeTreeItemProps
  extends Omit<ComponentProps<typeof TreeItem>, 'depth'> {
  nodeId: Aglyn.NodeId
}

const NodeTreeItem = observer(
  forwardRef<any, NodeTreeItemProps>((props, ref) => {
    const { nodeId, className, ...rest } = props
    const {
      expanded,
      closeIcon,
      expandIcon,
      onItemSelect,
      onItemHover,
      onItemToggle,
      onItemFocus,
    } = useContext(TreeViewContext)
    // console.log('NodeTreeItem', [...expanded])
    const node = Aglyn.canvas.getNode(nodeId)
    const schema = node?.componentSchema
    const nodeLabel = node?.labelShort
    const breadcrumbPath = node?.breadcrumbPath || []
    const depth = breadcrumbPath?.length - 1
    const isRootNode = Aglyn.canvas.isRootNode(node)
    const dragAllowed = Aglyn.isFeatureEnabled(schema?.flags?.dragging)
    const collapseIn = expanded?.some((i) => i === nodeId)
    const isSelected = Besigner.focus.isNodeSelected(node)
    const isHovered = Besigner.focus.isNodeHovered(node)
    const dragDisabled = Boolean(isRootNode || !dragAllowed)

    const {
      attributes: dragAttributes,
      transform,
      isDragging,
      setNodeRef: setDraggableNodeRef,
      listeners: draggableListeners,
    } = useLeafDrag(node, Besigner.DragType.TREE)
    const style = transform
      ? {
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
          cursor: 'grab',
          opacity: 0.5,
        }
      : undefined
    const { setNodeRef: setDroppableNodeRef, isOver } = useLeafDrop(
      node,
      undefined,
      'tree',
    )

    /**
     * The row's own ⋮ menu (AGL-1405). The canvas overlay carries the same
     * menu, but it only mounts for a node with a live DOM element
     * (`node-overlay`: `isOpen = Boolean(elementRef?.current)`) — so a node
     * its parent never renders, which is precisely the node that needs
     * moving, has no overlay and no way to reach any action at all. The
     * hierarchy is the one surface that shows a node the page doesn't.
     */
    const [menuButton, setMenuButton] = useState<HTMLButtonElement | null>(null)
    const menuOpen = Boolean(menuButton)
    const closeMenu = useCallback(() => setMenuButton(null), [])
    const toggleMenu = useCallback((e: any) => {
      // The row is a button and the tree item is a drop target; without this
      // the click also selects and re-focuses the row underneath the menu.
      e.stopPropagation()
      e.preventDefault()
      const target = e.currentTarget
      setMenuButton((open) => (open ? null : target))
    }, [])

    if (!node) return <>'Invalid node'</>
    return (
      <TreeItem
        ref={ref}
        // ref={setDraggableNodeRef}
        data-aglyn-node={nodeId}
        {...dragAttributes}
        depth={depth}
        onMouseEnter={(e) => onItemHover(e, nodeId)}
        onFocus={(e) => onItemFocus(e, nodeId)}
        className={clsx(className, classKey.treeItem, {
          [classKey.itemSelected]: isSelected,
          [classKey.itemHovered]: isHovered,
          [classKey.itemIsDragging]: isDragging,
          [classKey.itemIsDragOver]: isOver,
        })}
        disablePadding
        style={style}
        {...rest}
      >
        <Stack
          ref={(e: any) => {
            setDraggableNodeRef(e)
            setDroppableNodeRef(e)
          }}
          className={classKey.treeListItem}
          direction="row"
        >
          {!isRootNode && (
            <MuiListItemIcon
              {...draggableListeners}
              className={classKey.dragHandle}
              draggable
              sx={{
                minWidth: 23,
                padding: 0.75,
                pl: 0,
                borderRadius: '4px',
                cursor: 'move',
                pointerEvents: dragDisabled ? 'none' : undefined,
                opacity: dragDisabled ? 0.5 : undefined,
                zIndex: 1,
              }}
            >
              <MdiIcon
                color="inherit"
                fontSize="inherit"
                path={ICON_VARIANT_MODIFY_DRAG.path}
              />
            </MuiListItemIcon>
          )}
          <MuiListItemButton
            sx={{
              // The gutter the depth guides are drawn in — one source for
              // both, or the lines would stop landing on the level
              // boundaries they mark.
              paddingLeft: `${hierarchyGutterWidth(depth)}px`,
            }}
            onClick={(e) => onItemSelect(e, nodeId)}
            onMouseOver={(e) => onItemHover(e, nodeId)}
            dense
          >
            <MuiListItemIcon sx={{ minWidth: 20, mr: '1px' }}>
              <IconButton
                color="default"
                sx={{
                  padding: '2px',
                  visibility: !node?.hasNodes ? 'hidden' : 'visible',
                }}
                disabled={!node?.hasNodes}
                onClick={(e) => onItemToggle(e, nodeId)}
              >
                {collapseIn ? closeIcon : expandIcon}
              </IconButton>
            </MuiListItemIcon>
            <MuiListItemIcon
              sx={{
                minWidth: 20,
                mr: 0.5,
                fontSize: 14,
                padding: 0.2,
                borderRadius: '0.25em',
                backgroundColor: 'background.default',
                border: 1,
                borderColor: 'divider',
                boxShadow: 1,
                color: 'primary',
                display: 'flex',
                alignItems: 'center',
                flexDirection: 'column',
              }}
            >
              <ComponentIconComponent
                component={node?.componentSchema}
                node={node}
              />
            </MuiListItemIcon>
            <MuiListItemText
              primary={nodeLabel}
              slotProps={{
                primary: {
                  noWrap: true,
                  sx: { maxWidth: '180px', width: 'fit-content', textOverflow: 'ellipsis' },
                },
              }}
            />
          </MuiListItemButton>
          <IconButton
            aria-label={`Actions for ${nodeLabel}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className={classKey.moreButton}
            color="default"
            onClick={toggleMenu}
            size="small"
            sx={{ alignSelf: 'center', flexShrink: 0, padding: '2px', mr: 0.25 }}
          >
            <MdiIcon
              fontSize="inherit"
              path={ICON_VARIANT_SHOW_MORE_VERTICAL.path}
            />
          </IconButton>
          {menuOpen && (
            <Popper
              anchorEl={menuButton}
              open
              placement="bottom-end"
              // Above the panel, below dialogs and drawers — the same band
              // the canvas overlay's copy of this menu sits in.
              sx={{ zIndex: (theme) => theme.zIndex.modal - 1 }}
            >
              {/* NodeContextMenu forwards its ref to the Paper and spreads
                  the rest, so it is a valid ClickAwayListener child on its
                  own — no wrapper element to disturb the Popper's layout. */}
              <ClickAwayListener onClickAway={closeMenu}>
                <NodeContextMenu node={node} onAction={closeMenu} />
              </ClickAwayListener>
            </Popper>
          )}
        </Stack>

        {node?.hasNodes && (
          <Box className={classKey.subTreeView} sx={{ position: 'relative' }}>
            <Divider
              orientation="vertical"
              sx={{
                position: 'absolute',
                height: 1,
                left: `${
                  depth <= 1 ? (depth < 1 ? 20 - 9 : 34) : depth * 23 + 11
                }px`,
                zIndex: 0,
                pointerEvents: 'none',
              }}
              // flexItem
            />
            <Collapse unmountOnExit in={collapseIn}>
              <TreeView disablePadding>
                {node?.nodes?.map((nodeId) => (
                  <NodeTreeItem key={nodeId} nodeId={nodeId} />
                ))}
              </TreeView>
            </Collapse>
          </Box>
        )}
      </TreeItem>
    )
  }),
)
NodeTreeItem.displayName = 'NodeTreeItem'

const TreeViewContext = createContext<{
  expanded: Aglyn.NodeId[]
  // selected: Aglyn.NodeId
  closeIcon?: JSX.Node
  expandIcon?: JSX.Node
  onItemSelect: (e: ChangeEvent<any>, id: Aglyn.NodeId) => void
  onItemToggle: (e: ChangeEvent<any>, id: Aglyn.NodeId) => void
  onItemHover: (e: ChangeEvent<any>, id: Aglyn.NodeId) => void
  onItemFocus: (e: ChangeEvent<any>, id: Aglyn.NodeId) => void
}>({
  expanded: [],
  // selected: null,
  closeIcon: '●',
  expandIcon: '○',
  onItemSelect: noop,
  onItemToggle: noop,
  onItemHover: noop,
  onItemFocus: noop,
})

export interface NodeTreeViewProps extends BoxProps {
  TreeViewProps?: Partial<Omit<ComponentProps<typeof TreeView>, 'children'>>
}

const CloseIcon = (
  <MdiIcon fontSize="small" path={ICON_VARIANT_COLLAPSIBLE_CLOSE.path} />
)
const ExpandIcon = (
  <MdiIcon fontSize="small" path={ICON_VARIANT_COLLAPSIBLE_OPEN.path} />
)

export const NodeTreeView = observer(
  forwardRef<any, NodeTreeViewProps>((props, ref) => {
    const { TreeViewProps, ...rest } = props
    const allExpanded = Besigner.focus.getAllExpanded()
    const manuallyCollapsed = Besigner.focus.getManuallyCollapsed()

    const expanded = useMemo(() => {
      const paths = allExpanded.reduce((acc, i) => {
        return [...acc, ...(i?.breadcrumbPath || [])]
      }, [])
      return uniq(paths).filter((id) => !manuallyCollapsed.includes(id))
    }, [allExpanded, manuallyCollapsed])

    const handleTreeItemToggle = useCallback((e, $id: Aglyn.NodeId) => {
      e.stopPropagation()
      e.preventDefault()
      const node = Aglyn.canvas.getNode($id)
      if (!node) return
      Besigner.focus.toggleNodeExpansion(node)
    }, [])

    const handleTreeItemSelect = useCallback((e, $id: Aglyn.NodeId) => {
      e.stopPropagation()
      e.preventDefault()
      const node = Aglyn.canvas.getNode($id)
      if (!node) return
      // Multi-selection modifiers (AGL-8): Shift ranges from the anchor,
      // Cmd/Ctrl toggles membership, plain click single-selects.
      if (e.shiftKey) {
        Besigner.focus.rangeSelectNode(node)
      } else {
        Besigner.focus.handleNodeSelection(node, e.metaKey || e.ctrlKey)
      }
    }, [])

    const handleTreeItemHover = useCallback((e, $id: Aglyn.NodeId) => {
      const node = Aglyn.canvas.getNode($id)
      if (!node) return
      Besigner.focus.setHoveredNode(node)
    }, [])

    const handleTreeItemFocus = useCallback((e, $id: Aglyn.NodeId) => {
      e.stopPropagation()
      const node = Aglyn.canvas.getNode($id)
      if (!node) return
      Besigner.focus.setHoveredNode(node)
    }, [])

    return (
      <TreeViewContext.Provider
        value={{
          expanded: expanded,
          closeIcon: CloseIcon,
          expandIcon: ExpandIcon,
          onItemFocus: handleTreeItemFocus,
          onItemHover: handleTreeItemHover,
          onItemSelect: handleTreeItemSelect,
          onItemToggle: handleTreeItemToggle,
        }}
      >
        <Box
          ref={ref}
          component="nav"
          id={'aglyn:node-tree-view'}
          aria-label="canvas nodes navigator"
          {...rest}
        >
          <TreeView className={classKey.root} {...TreeViewProps}>
            <NodeTreeItem nodeId={Aglyn.NODE_ROOT_ID} />
          </TreeView>
        </Box>
      </TreeViewContext.Provider>
    )
  }),
)

NodeTreeView.displayName = 'NodeTreeView'
NodeTreeView.aglyn = true

export default NodeTreeView
