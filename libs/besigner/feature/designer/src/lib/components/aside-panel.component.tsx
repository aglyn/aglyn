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
  type BesignerPanelKey,
  BesignerPanelTabFlag,
} from '@aglyn/besigner'
import {
  ICON_VARIANT_ELEMENT,
  ICON_VARIANT_ELEMENT_BROWSE,
  ICON_VARIANT_ELEMENT_INTERACTIONS,
  ICON_VARIANT_ELEMENT_PROPERTIES,
  ICON_VARIANT_ELEMENT_STYLES,
  ICON_VARIANT_ELEMENT_TREE_VIEW,
  ICON_VARIANT_MODIFY_ADD,
} from '@aglyn/shared-data-enums'
import { HelpTip, MdiIcon } from '@aglyn/shared-ui-jsx'
import { mergeSxProps, styled } from '@aglyn/shared-ui-theme'
import {
  getDisplayName,
  numberFromHexadecimal,
  numberToHexadecimal,
} from '@aglyn/shared-util-tools'
import { hoistNonReactStatics } from '@aglyn/shared-util-vendor'
import {
  TabContext as MuiTabContext,
  TabList as MuiTabList,
  TabPanel as MuiTabPanel,
  type TabPanelProps as MuiTabPanelProps,
} from '@mui/lab'
import {
  AppBar as MuiAppBar,
  Box,
  Button,
  Chip,
  Stack,
  Tab as MuiTab,
  Typography,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import {
  type ComponentType,
  forwardRef,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import useAddElementDrawerCallback from '../hooks/use-add-element-drawer-callback'
import useAglynBesignerPanel from '../hooks/use-aglyn-besigner-panel'
import AccordionListComponent from './accordion-list.component'
import ElementInteractionsForm from './element-interactions-form.component'
import ComponentAccordionList from './component-accordion-list'
import ElementPropsForm from './element-props-form.component'
import ElementStylesForm from './element-styles-form.component'
import NodeTreeView, { type NodeTreeViewProps } from './node-tree-view'
import SiteThemeColorTokensProvider from './site-theme-color-tokens-provider.component'
import { usePublishActiveHostTheme } from '../utils/active-host-theme'
import { besignerDocsUrl } from '../utils/docs-help'
import WorkspacePanelComponent, {
  type WorkspacePanelComponentProps,
} from './workspace-panel.component'

const TabPanel = styled(MuiTabPanel, {
  name: 'AglynTabPanel',
})<MuiTabPanelProps>({
  padding: 0,
  overflow: 'auto',
  height: '100%',
})
const TabPanelInner = styled('div', {
  name: 'AglynTabPanelInner',
})(({ theme }) => ({
  width: '100%',
}))

const emptyView = (
  <Stack
    direction="column"
    component={TabPanelInner}
    sx={{
      justifyContent: 'center',
      height: 1,
      p: 2,
    }}
  >
    <Typography
      color="textSecondary"
      variant="overline"
      component="div"
      align="center"
    >
      <MdiIcon
        sx={{ opacity: 0.3, fontSize: 80 }}
        path={ICON_VARIANT_ELEMENT.path}
      />
      <div>{'Select an element'}</div>
    </Typography>
  </Stack>
)


/**
 * `Hero · Section` with a `SELECTED` tag — the inspector header the
 * `/product` hero mockup shows (AGL-2175).
 *
 * The right panel had no header at all: three tabs of controls with
 * nothing naming what they act on. On a canvas where clicking a child
 * moves the selection under you, that is the difference between editing
 * the section and editing the heading inside it — and the panel looked
 * identical either way.
 *
 * The second half is the COMPONENT, not a category: `labelShort` is the
 * preset's name (`Hero`) and the schema's is what it actually is
 * (`Section`). They are the same word often enough that it is dropped
 * when it would only repeat itself.
 */
const SelectedNodeHeader = observer(
  ({ node }: { node: Besigner.LastSelectedNode }) => {
    const name = node?.labelShort ?? ''
    const component = (node as { componentSchema?: { displayName?: string } })
      ?.componentSchema?.displayName
    const subtitle =
      component && component.toLowerCase() !== name.toLowerCase()
        ? `${name} · ${component}`
        : name
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          px: 2,
          py: 1,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {subtitle || 'Element'}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          color="secondary"
          label="SELECTED"
          sx={{ height: 18, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
        />
      </Stack>
    )
  },
)
SelectedNodeHeader.displayName = 'SelectedNodeHeader'

function withLastSelectedNode<P>(
  WrappedComponent: JSX.ComponentType<P & { node: Besigner.LastSelectedNode }>,
) {
  const displayName = getDisplayName(WrappedComponent)

  const WithLastSelectedNode = observer((props: P) => {
    const { ...rest } = props
    const selected = Besigner.focus.getLastSelected()
    /**
     * The LIVE node for that selection, re-resolved by id every render
     * (AGL-2486).
     *
     * The focus store holds node OBJECTS, not ids. Anything that replaces the
     * canvas map wholesale — `undo`, `redo`, a co-editing `applyNodes`, a
     * local-draft restore — builds fresh node instances and leaves the store
     * pointing at the pre-restore ones. The panels then read their fields from
     * an orphan and, worse, write back through it: `updateNodeProps` assigns
     * `node.props` on an object the canvas no longer owns, so the edit lands
     * nowhere. Nothing throws and nothing marks the document dirty, so an
     * author sees their new text in the box, an unchanged canvas, and `UP TO
     * DATE` — the reported "the Text attribute silently discards edits".
     *
     * Resolving here rather than in the three panels because they share this
     * one seam, and it is `observer`-tracked: `getNode` reads the observable
     * map, so a restore re-renders the panel with the live node instead of
     * leaving stale values in the fields.
     *
     * A node the map no longer has (deleted, or a test node that was never in
     * it) falls back to the stored object, which is exactly today's behaviour
     * for that case — there is no live node to prefer.
     */
    const lastSelected = selected
      ? Aglyn.canvas.getNode(selected.$id) ?? selected
      : selected

    return (
      <>
        {!lastSelected ? (
          emptyView
        ) : (
          <>
            {/* One header for all three right-panel tabs, so Attributes,
                Styles and Info cannot disagree about what is selected. */}
            <SelectedNodeHeader node={lastSelected} />
            <WrappedComponent node={lastSelected} {...rest} />
          </>
        )}
      </>
    )
  })
  WithLastSelectedNode.displayName = `WithLastSelectedNode(${displayName})`
  hoistNonReactStatics(WithLastSelectedNode, WrappedComponent)

  return WithLastSelectedNode
}

const withTabPanelInner = (Component: ComponentType<any>) => (props: any) => {
  return (
    <TabPanelInner sx={{ p: 2 }}>
      <Component {...props} />
    </TabPanelInner>
  )
}

const ElementsTree = forwardRef<any, NodeTreeViewProps>((props, ref) => {
  const handleAddElementClick = useAddElementDrawerCallback()
  return (
    <TabPanelInner sx={{ pl: 0.5 }}>
      <Box
        sx={{
          px: 0.05,
          pb: 1,
          pt: 1,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Button
          color="primary"
          startIcon={
            <MdiIcon fontSize="inherit" path={ICON_VARIANT_MODIFY_ADD.path} />
          }
          onClick={() =>
            handleAddElementClick(Besigner.focus.getLastSelected())
          }
        >
          {'Add Element'}
        </Button>
        {/* The hierarchy is the one panel whose rules are not visible in it
            (AGL-2167): which elements accept children, and what dropping on
            an edge does versus dropping in the center. */}
        <HelpTip
          title="Drag, drop & hierarchy"
          excerpt="Reparent by dragging here or on the canvas. Containers accept children; dropping on a leaf element makes a sibling instead."
          href={besignerDocsUrl('dragDropHierarchy', '#drop-zones-edges-vs-center')}
          sx={{ ml: 'auto', mr: 0.5, fontSize: '0.9em' }}
        />
      </Box>
      <NodeTreeView ref={ref} {...props} />
    </TabPanelInner>
  )
})

const panelTabs: Partial<Record<BesignerPanelKey, any>> = {
  panelLeft: {
    defaultTab: BesignerPanelTabFlag.ELEMENTS_TREE,
    panel: {
      id: 'left',
      anchor: 'left',
      'aria-label': 'left toolbox panel',
    },
    tabs: [
      {
        value: BesignerPanelTabFlag.ELEMENTS_TREE,
        tab: {
          icon: { path: ICON_VARIANT_ELEMENT_TREE_VIEW.path },
          label: 'Hierarchy',
        },
        panel: {
          Component: ElementsTree,
        },
      },
      {
        value: BesignerPanelTabFlag.ELEMENT_BROWSE,
        tab: {
          icon: { path: ICON_VARIANT_ELEMENT_BROWSE.path },
          label: 'Elements',
        },
        panel: {
          Component: ComponentAccordionList,
        },
      },
    ],
  },
  panelRight: {
    // Attributes first and open by default — it is what you reach for on
    // selecting an element. Tab order here is display order only; the flag
    // values are persisted in panel state, so they stay put.
    defaultTab: BesignerPanelTabFlag.ELEMENT_PROPS_FORM,
    panel: {
      id: 'right',
      anchor: 'right',
      'aria-label': 'right toolbox panel',
    },
    tabs: [
      {
        value: BesignerPanelTabFlag.ELEMENT_PROPS_FORM,
        tab: {
          icon: { path: ICON_VARIANT_ELEMENT_PROPERTIES.path },
          label: 'Attributes',
        },
        panel: {
          Component: withLastSelectedNode(withTabPanelInner(ElementPropsForm)),
        },
      },
      {
        value: BesignerPanelTabFlag.ELEMENT_STYLES,
        tab: {
          icon: { path: ICON_VARIANT_ELEMENT_STYLES.path },
          label: 'Styles',
        },
        panel: {
          Component: withLastSelectedNode(ElementStylesForm as any),
        },
      },
      /*
       * Interactions, between Styles and where Info used to be.
       *
       * They lived at the bottom of Attributes, under every field the
       * component declares — below the fold on anything with more than a
       * handful, so an author had no reason to believe the element had any.
       * An interaction is not an attribute: it is a behaviour, authored in a
       * dialog rather than a field, and it belongs beside the styles as a
       * peer.
       *
       * INFO IS GONE. Its two accordions are reference detail about the
       * component and the node's ids — worth having, not worth a tab — and
       * they now sit at the bottom of Attributes, beside the fields they
       * describe. Its flag value stays reserved; panel state is persisted,
       * and a reader whose last session ended on Info would otherwise return
       * to a tab id that means something else.
       */
      {
        value: BesignerPanelTabFlag.ELEMENT_INTERACTIONS,
        tab: {
          icon: { path: ICON_VARIANT_ELEMENT_INTERACTIONS.path },
          label: 'Interactions',
        },
        panel: {
          Component: withLastSelectedNode(
            withTabPanelInner(ElementInteractionsForm as any),
          ),
        },
      },
    ],
  },
}

export interface AsidePanelComponentProps extends WorkspacePanelComponentProps {
  panel: BesignerPanelKey
}

export const AsidePanelComponent = forwardRef<any, AsidePanelComponentProps>(
  (props, ref) => {
    const { children, panel: panelKey, ...rest } = props

    // Republish the page's site theme for surfaces that render OUTSIDE the
    // page tree (AGL-2486). This panel is inside `HostThemeDocumentContext`;
    // the Choose-element dialog — rendered by `withBesignerContext`, which
    // wraps the page — is not, and its element preview was painting the
    // console's brand onto someone else's site.
    usePublishActiveHostTheme()

    const [panel, setPanel] = useAglynBesignerPanel(panelKey)
    const {
      panel: { id, ...panelProps },
      defaultTab,
      tabs,
    } = panelTabs[panelKey]
    const { toggled, tab, size } = panel || {}
    const value = tab || defaultTab

    // The bottom-right corner belongs to this panel while it is open
    // (AGL-2486), so publish how far a viewport-fixed affordance has to
    // stand off to clear it. The Assist launcher reads this; the console's
    // own chrome leaves the corner free and never sets it, which is why the
    // variable carries the offset rather than the panel width — an unset
    // variable then means "the corner is yours" everywhere else.
    //
    // Kept in an effect on the LIVE panel state so it tracks the author
    // dragging the panel wider or collapsing it, and removed on unmount:
    // navigating from the besigner back into the console must not leave a
    // 395px inset behind on a page with no panel at all.
    // `size` is `string | number` on the panel state, so a numeric width is
    // parsed rather than added to: `'375' + 20` is `'37520'`, which is a
    // perfectly valid CSS length and would park the launcher off-screen.
    const panelWidth = Number.parseFloat(String(size ?? ''))
    const rightInset =
      panelKey === 'panelRight' && toggled && Number.isFinite(panelWidth)
        ? panelWidth + 20
        : null
    useEffect(() => {
      if (panelKey !== 'panelRight') return undefined
      const root = document.documentElement
      const property = '--aglyn-assist-inset-right'
      if (rightInset === null) {
        root.style.removeProperty(property)
      } else {
        root.style.setProperty(property, `${rightInset}px`)
      }
      return () => {
        root.style.removeProperty(property)
      }
    }, [panelKey, rightInset])

    const handleTabChange = useCallback(
      (e: SyntheticEvent, val: string) => {
        setPanel((panel) => ({ ...panel, tab: numberFromHexadecimal(val) }))
      },
      [setPanel],
    )

    return (
      <WorkspacePanelComponent
        ref={ref}
        id={`aglyn:panel-${id}`}
        aria-label="left toolbox panel"
        size={size}
        open={toggled}
        component="aside"
        {...panelProps}
        {...rest}
      >
        <MuiTabContext value={numberToHexadecimal(value)}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <MuiAppBar
              color="surface"
              position="relative"
              elevation={0}
              enableColorOnDark
            >
              <MuiTabList
                onChange={handleTabChange}
                variant="fullWidth"
                sx={{
                  '& .MuiTab-root': {
                    '&.Mui-selected': {
                      // Use sx string shorthands instead of palette callbacks so the
                      // sx system resolves them via theme.vars (CSS custom-property refs)
                      // rather than the static light-mode palette values.
                      color: 'text.primary',
                      backgroundColor: 'background.paper',
                    },
                  },
                  '& .MuiTabs-indicator': {
                    top: 0,
                    backgroundColor: 'secondary.main',
                  },
                }}
              >
                {tabs.map(({ value, tab: { icon, ...tab } }) => (
                  <MuiTab
                    key={value}
                    // color={'tertiary'}
                    value={numberToHexadecimal(value)}
                    iconPosition="top"
                    icon={<MdiIcon {...icon} fontSize="small" />}
                    sx={{
                      minHeight: 'unset',
                      fontSize: (theme) => theme.typography.pxToRem(12),
                      lineHeight: 0.8,
                      pt: 1,
                    }}
                    {...tab}
                  />
                ))}
              </MuiTabList>
            </MuiAppBar>
          </Box>

          {/* Site-theme color tokens (AGL-588): every COLOR_PICKER field
              in these panels — styles panel, attribute forms, email
              blocks — offers the site palette's token references. */}
          <SiteThemeColorTokensProvider>
            {tabs.map(({ value, panel: { Component, ...panel } }) => (
              <TabPanel
                key={value}
                value={numberToHexadecimal(value)}
                {...panel}
              >
                <Component />
              </TabPanel>
            ))}
          </SiteThemeColorTokensProvider>
        </MuiTabContext>

        {children}
      </WorkspacePanelComponent>
    )
  },
)

AsidePanelComponent.displayName = 'AsidePanelComponent'
AsidePanelComponent.aglyn = true

export default AsidePanelComponent
