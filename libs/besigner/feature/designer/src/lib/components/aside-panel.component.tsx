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
} from '@aglyn/besigner-data-app'
import {
  ICON_VARIANT_ELEMENT,
  ICON_VARIANT_ELEMENT_BROWSE,
  ICON_VARIANT_ELEMENT_DETAILS,
  ICON_VARIANT_ELEMENT_PROPERTIES,
  ICON_VARIANT_ELEMENT_STYLES,
  ICON_VARIANT_ELEMENT_TREE_VIEW,
  ICON_VARIANT_MODIFY_ADD,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
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
  useMemo,
  useState,
} from 'react'
import useAddElementDrawerCallback from '../hooks/use-add-element-drawer-callback'
import useAglynBesignerPanel from '../hooks/use-aglyn-besigner-panel'
import AccordionListComponent from './accordion-list.component'
import ComponentAccordionList from './component-accordion-list'
import ElementPropsForm from './element-props-form.component'
import ElementStylesForm from './element-styles-form.component'
import NodeTreeView, { type NodeTreeViewProps } from './node-tree-view'
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

const ElementInfo = function ElementInfo({
  node,
}: {
  node: Aglyn.NodeSchema<any>
}) {
  const schema = Aglyn.components.getSchema(node?.componentId)
  const failoverText = 'n/a'
  const details = useMemo(
    () => [
      {
        key: 'element-overview',
        label: 'Element Overview',
        items: [
          {
            key: 'component-display-name',
            label: 'Type',
            value: schema?.displayName,
          },
          {
            key: 'component-title',
            label: 'Title',
            value: schema?.title,
          },
          {
            key: 'component-subtitle',
            label: 'Subtitle',
            value: schema?.subtitle,
          },
          {
            key: 'component-description',
            label: 'Description',
            value: schema?.description,
            TypographyProps: { gutterBottom: true },
          },
        ],
      },
      {
        key: 'unique-identifiers',
        label: 'Unique Identifiers',
        items: [
          {
            key: 'element-id',
            label: 'Element ID',
            value: node.$id,
          },
          {
            key: 'parent-id',
            label: 'Parent Element ID',
            value: node?.parentId,
          },
          {
            key: 'component-id',
            label: 'Component ID',
            value: node?.componentId,
          },
          {
            key: 'plugin-id',
            label: 'Plugin ID',
            value: node?.pluginId,
            ValueTypographyProps: {},
          },
        ],
      },
    ],
    [schema, node],
  )
  const [expanded, setExpanded] = useState<string | false>(details[0].key)
  const handleChange =
    (panel: string) => (event: SyntheticEvent, newExpanded: boolean) => {
      setExpanded(newExpanded ? panel : false)
    }

  return (
    <TabPanelInner>
      <AccordionListComponent
        items={details}
        getItemId={(item) => item.key}
        onRenderSummary={({ item }) => <>{item?.label}</>}
        onRenderDetail={({ item }) => (
          <>
            {item?.items?.map(
              ({
                label,
                value,
                TypographyProps,
                ValueTypographyProps,
                ...item
              }: any) => (
                <Typography key={item.key} component="div" {...TypographyProps}>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'inline',
                      textTransform: 'uppercase',
                    }}
                  >
                    <b>{label}:</b>
                  </Typography>{' '}
                  <Typography
                    variant="body1"
                    {...ValueTypographyProps}
                    sx={mergeSxProps(
                      (theme) => {
                        const tv = (theme as any).vars || theme
                        return {
                          bgcolor: `rgba(${tv.palette.secondary.lightChannel} / 0.18)`,
                          border: `1px solid rgba(${tv.palette.secondary.lightChannel} / 0.72)`,
                          borderRadius: '0.3em',
                          px: 0.5,
                          py: 0.15,
                          wordBreak: 'break-word',
                          fontSize: '0.8rem',
                        }
                      },
                      { display: 'inline' },
                      ValueTypographyProps?.sx,
                    )}
                  >
                    {value || <i>{failoverText}</i>}
                  </Typography>
                </Typography>
              ),
            )}
          </>
        )}
      />
    </TabPanelInner>
  )
}

function withLastSelectedNode<P>(
  WrappedComponent: JSX.ComponentType<P & { node: Besigner.LastSelectedNode }>,
) {
  const displayName = getDisplayName(WrappedComponent)

  const WithLastSelectedNode = observer((props: P) => {
    const { ...rest } = props
    const lastSelected = Besigner.focus.state.lastSelected

    return (
      <>
        {!lastSelected ? (
          emptyView
        ) : (
          <WrappedComponent node={lastSelected} {...rest} />
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
      <Box sx={{ px: 0.05, pb: 1, pt: 1 }}>
        <Button
          color="secondary"
          startIcon={
            <MdiIcon fontSize="inherit" path={ICON_VARIANT_MODIFY_ADD.path} />
          }
          onClick={() =>
            handleAddElementClick(Besigner.focus.state.lastSelected)
          }
        >
          {'Add Element'}
        </Button>
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
    defaultTab: BesignerPanelTabFlag.ELEMENT_INFO,
    panel: {
      id: 'right',
      anchor: 'right',
      'aria-label': 'right toolbox panel',
    },
    tabs: [
      {
        value: BesignerPanelTabFlag.ELEMENT_INFO,
        tab: {
          icon: { path: ICON_VARIANT_ELEMENT_DETAILS.path },
          label: 'Info',
        },
        panel: {
          Component: withLastSelectedNode(ElementInfo),
        },
      },
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
    ],
  },
}

export interface AsidePanelComponentProps extends WorkspacePanelComponentProps {
  panel: BesignerPanelKey
}

export const AsidePanelComponent = forwardRef<any, AsidePanelComponentProps>(
  (props, ref) => {
    const { children, panel: panelKey, ...rest } = props

    const [panel, setPanel] = useAglynBesignerPanel(panelKey)
    const {
      panel: { id, ...panelProps },
      defaultTab,
      tabs,
    } = panelTabs[panelKey]
    const { toggled, tab, size } = panel || {}
    const value = tab || defaultTab

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
                    backgroundColor: 'tertiary.main',
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

          {tabs.map(({ value, panel: { Component, ...panel } }) => (
            <TabPanel key={value} value={numberToHexadecimal(value)} {...panel}>
              <Component />
            </TabPanel>
          ))}
        </MuiTabContext>

        {children}
      </WorkspacePanelComponent>
    )
  },
)

AsidePanelComponent.displayName = 'AsidePanelComponent'
AsidePanelComponent.aglyn = true

export default AsidePanelComponent
