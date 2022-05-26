/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import {type BesignerPanelKey, BesignerPanelTabFlag} from '@aglyn/core-data-besigner'
import type {ElementId} from '@aglyn/core-data-framework'
import {
  AglynComponentsContext,
  useAglynComponentSchema,
  useAglynElementData,
} from '@aglyn/core-feature-renderer'
import {
  ICON_VARIANT_ELEMENT_BROWSE,
  ICON_VARIANT_ELEMENT_DETAILS,
  ICON_VARIANT_ELEMENT_PROPERTIES,
  ICON_VARIANT_ELEMENT_STYLES,
  ICON_VARIANT_ELEMENT_TREE_VIEW,
} from '@aglyn/shared-data-enums'
import {MdiIcon, mdiPlus} from '@aglyn/shared-ui-mdi-jsx'
import {alpha, mergeSxProps, styled} from '@aglyn/shared-ui-theme'
import {numberFromHexadecimal, numberToHexadecimal} from '@aglyn/shared-util-tools'
import {
  TabContext as MuiTabContext,
  TabList as MuiTabList,
  TabPanel as MuiTabPanel,
} from '@mui/lab'
import {Box, Button, Divider, Tab as MuiTab, Typography} from '@mui/material'
import {forwardRef, Fragment, useCallback, useMemo} from 'react'
import useAddElementCallback from '../hooks/use-add-element-callback'
import useAglynBesignerPanel from '../hooks/use-aglyn-besigner-panel'
import useAglynCanvasSelected from '../hooks/use-aglyn-canvas-selected'
import ComponentsGridListComponent, {
  type ComponentsGridListProps,
} from './components-grid-list.component'
import ElementPropsForm from './element-props-form.component'
import ElementStylesForm from './element-styles-form.component'
import ElementsTreeViewComponent, {
  type ElementsTreeViewComponentProps,
} from './elements-tree-view.component'
import WorkspacePanelComponent, {
  type WorkspacePanelComponentProps,
} from './workspace-panel.component'


const TabPanelInner = styled('div', {
  name: 'AglynTabPanelInner',
})(({theme}) => ({
  width: '100%',
}))
const TabPanel = styled(MuiTabPanel, {
  name: 'AglynTabPanel',
})({
  padding: 0,
  overflow: 'auto',
  height: '100%',
})
const DividerSpacer = styled(Divider, {
  name: 'AglynDividerSpacer',
})(({theme}) => ({
  marginTop: theme.spacing(2),
  marginBottom: theme.spacing(2),
}))

const ElementInfo = function ElementInfo({$id}: {$id: ElementId}) {
  const componentId = useAglynElementData($id, 'componentId')
  const bundleId = useAglynElementData($id, 'bundleId')
  const parentId = useAglynElementData($id, 'parentId')
  const schema = useAglynComponentSchema(componentId, bundleId)
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
            TypographyProps: {gutterBottom: true},
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
            value: $id,
          },
          {
            key: 'parent-id',
            label: 'Parent Element ID',
            value: parentId,
          },
          {
            key: 'component-id',
            label: 'Component ID',
            value: componentId,
          },
          {
            key: 'bundle-id',
            label: 'Bundle ID',
            value: bundleId,
            ValueTypographyProps: {},
          },
        ],
      },
    ],
    [$id, bundleId, componentId, schema, parentId],
  )

  return details.map(({label, items, ...item}) => (
    <Fragment key={item.key}>
      <Typography variant="subtitle1" component="div" sx={{mb: 2}}>
        {label}
      </Typography>
      {items.map(({label, value, TypographyProps, ValueTypographyProps, ...item}: any) => (
        <Typography key={item.key} component="div" {...TypographyProps}>
          <Typography variant="caption" display="inline" sx={{textTransform: 'uppercase'}}>
            <b>{label}:</b>
          </Typography>{' '}
          <Typography
            variant="body1"
            display="inline"
            {...ValueTypographyProps}
            sx={mergeSxProps(
              (theme) => ({
                bgcolor: alpha(theme.palette.secondary.light, 0.18),
                border: `1px solid ${alpha(theme.palette.secondary.light, 0.72)}`,
                borderRadius: '0.3em',
                px: 0.5,
                py: 0.15,
                wordBreak: 'break-word',
                fontSize: '0.8rem',
              }),
              ValueTypographyProps?.sx,
            )}
          >
            {value || <i>{failoverText}</i>}
          </Typography>
        </Typography>
      ))}
      <DividerSpacer variant="middle" />
    </Fragment>
  ))
}

const defaultTabContent = (
  <Typography variant="subtitle1" component="div" align="center">
    No element selected...
  </Typography>
)

const withSelectedElement = (Component) => () => {
  const [selected] = useAglynCanvasSelected()
  const $id = selected?.$id
  return (
    <TabPanelInner sx={{p: 2}}>
      {!$id ? defaultTabContent : <Component $id={$id} />}
    </TabPanelInner>
  )
}

const ElementsTree = forwardRef<any, ElementsTreeViewComponentProps>(
  function RefRenderFn(props, ref) {
    const handleAddElementClick = useAddElementCallback()
    return (
      <TabPanelInner sx={{pl: 0.5}}>
        <ElementsTreeViewComponent
          ref={ref}
          {...props}
        >
          <Box sx={{px: 0.5, pb: 1, pt: 1}}>
            <Button
              color="secondary"
              startIcon={<MdiIcon fontSize="inherit" path={mdiPlus.path} />}
              onClick={handleAddElementClick}
            >
              Add Element
            </Button>
          </Box>
        </ElementsTreeViewComponent>
      </TabPanelInner>
    )
  },
)

const ComponentsList = forwardRef<any, ComponentsGridListProps>(
  function RefRenderFn(props, ref) {
    const {...rest} = props
    return (
      <AglynComponentsContext.Consumer>
        {({templateBlocks}) => (
          <ComponentsGridListComponent
            items={templateBlocks}
            ref={ref}
            maxColumns={2}
            {...rest}
          />
        )}
      </AglynComponentsContext.Consumer>
    )
  },
)

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
          icon: {path: ICON_VARIANT_ELEMENT_TREE_VIEW.path},
          label: 'Hierarchy',
        },
        panel: {
          Component: ElementsTree,
        },
      },
      {
        value: BesignerPanelTabFlag.ELEMENT_BROWSE,
        tab: {
          icon: {path: ICON_VARIANT_ELEMENT_BROWSE.path},
          label: 'Elements',
        },
        panel: {
          Component: ComponentsList,
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
          icon: {path: ICON_VARIANT_ELEMENT_DETAILS.path},
          label: 'Info',
        },
        panel: {
          Component: withSelectedElement(ElementInfo),
        },
      },
      {
        value: BesignerPanelTabFlag.ELEMENT_PROPS_FORM,
        tab: {
          icon: {path: ICON_VARIANT_ELEMENT_PROPERTIES.path},
          label: 'Attributes',
        },
        panel: {
          Component: withSelectedElement(ElementPropsForm),
        },
      },
      {
        value: BesignerPanelTabFlag.ELEMENT_STYLES,
        tab: {
          icon: {path: ICON_VARIANT_ELEMENT_STYLES.path},
          label: 'Styles',
        },
        panel: {
          Component: withSelectedElement(ElementStylesForm),
        },
      },
    ],
  },
}

export interface AsidePanelComponentProps extends WorkspacePanelComponentProps {
  panel: BesignerPanelKey
}

const AsidePanelComponent = forwardRef<any, AsidePanelComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, panel: panelKey, ...rest} = props

    const [panel, setPanel] = useAglynBesignerPanel(panelKey)
    const {panel: {id, ...panelProps}, defaultTab, tabs} = panelTabs[panelKey]
    const {toggled, tab, size} = panel || {}
    const value = tab || defaultTab

    const handleTabChange = useCallback((e, val) => {
      setPanel((panel) => ({...panel, tab: numberFromHexadecimal(val)}))
    }, [setPanel])

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
          <Box sx={{borderBottom: 1, borderColor: 'divider'}}>
            <MuiTabList
              onChange={handleTabChange}
              variant="fullWidth"
              indicatorColor="secondary"
              textColor="secondary"
            >
              {tabs.map(({value, tab: {icon, ...tab}}) => (
                <MuiTab
                  key={value}
                  value={numberToHexadecimal(value)}
                  iconPosition="top"
                  icon={<MdiIcon {...icon} />}
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
          </Box>

          {tabs.map(({value, panel: {Component, ...panel}}) => (
            <TabPanel
              key={value}
              value={numberToHexadecimal(value)}
              {...panel}
            >
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
AsidePanelComponent.defaultProps = {}

export {AsidePanelComponent}
export default AsidePanelComponent
