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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import {
  type BesignerPanelKey,
  BesignerPanelTabFlag,
} from '@aglyn/besigner-data-app'
import { getBundle } from '@aglyn/core-data-app'
import type { AglynNodePresetSchema } from '@aglyn/core-data-foundation'
import { useAglynComponentsContext } from '@aglyn/core-feature-renderer'
import {
  ICON_VARIANT_ELEMENT,
  ICON_VARIANT_ELEMENT_BROWSE,
  ICON_VARIANT_ELEMENT_DETAILS,
  ICON_VARIANT_ELEMENT_PROPERTIES,
  ICON_VARIANT_ELEMENT_STYLES,
  ICON_VARIANT_ELEMENT_TREE_VIEW,
  ICON_VARIANT_MODIFY_ADD,
} from '@aglyn/shared-data-enums'
import {
  CardListItem,
  type CardListItemProps,
  useForkedRefs,
} from '@aglyn/shared-ui-jsx'
import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import { alpha, mergeSxProps, styled } from '@aglyn/shared-ui-theme'
import {
  arraySortBy,
  numberFromHexadecimal,
  numberToHexadecimal,
} from '@aglyn/shared-util-tools'
import {
  TabContext as MuiTabContext,
  TabList as MuiTabList,
  TabPanel as MuiTabPanel,
  type TabPanelProps as MuiTabPanelProps,
} from '@mui/lab'
import {
  AppBar as MuiAppBar,
  Box,
  BoxProps,
  Button,
  Grid,
  type ListProps,
  Stack,
  Tab as MuiTab,
  Typography,
} from '@mui/material'
import {
  forwardRef,
  type SyntheticEvent,
  useCallback,
  useMemo,
  useState,
} from 'react'
import useAddElementDrawerCallback from '../hooks/use-add-element-drawer-callback'
import useAglynBesignerPanel from '../hooks/use-aglyn-besigner-panel'
import useBesignerAppContext from '../hooks/use-besigner-app-context'
import useLeafDrag from '../hooks/use-leaf-drag'
import AccordionListComponent from './accordion-list.component'
import ElementPropsForm from './element-props-form.component'
import ElementStylesForm from './element-styles-form.component'
import NodeTreeViewComponent, {
  type NodeTreeViewProps,
} from './node-tree-view.component'
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
            value: schema?.componentId,
          },
          {
            key: 'plugin-id',
            label: 'Plugin ID',
            value: schema?.pluginId,
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
        unique
        items={details}
        AccordionSummaryProps={{ dense: true }}
        SummaryContentComponent={({ item }) => <>{item?.label}</>}
        DetailsContentComponent={({ label, item }) => (
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
                    display="inline"
                    sx={{ textTransform: 'uppercase' }}
                  >
                    <b>{label}:</b>
                  </Typography>{' '}
                  <Typography
                    variant="body1"
                    display="inline"
                    {...ValueTypographyProps}
                    sx={mergeSxProps(
                      (theme) => ({
                        bgcolor: alpha(theme.palette.secondary.light, 0.18),
                        border: `1px solid ${alpha(
                          theme.palette.secondary.light,
                          0.72,
                        )}`,
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
              ),
            )}
          </>
        )}
      />
    </TabPanelInner>
  )
}

const defaultTabContent = (
  <>
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
  </>
)

const withSelectedElement = (Component) => () => {
  const lastSelected = Besigner.focus.state.lastSelected
  return !lastSelected ? (
    <Stack
      direction="column"
      justifyContent="center"
      height={1}
      component={TabPanelInner}
      sx={{ p: 2 }}
    >
      {defaultTabContent}
    </Stack>
  ) : (
    <Component node={lastSelected} />
  )
}

const withTabPanelInner = (Component) => (props: any) => {
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
          onClick={handleAddElementClick}
        >
          {'Add Element'}
        </Button>
      </Box>
      <NodeTreeViewComponent ref={ref} {...props} />
    </TabPanelInner>
  )
})

type ComponentGridItemProps = CardListItemProps & {
  item: AglynNodePresetSchema
}
const ComponentGridItem = forwardRef<any, ComponentGridItemProps>(
  (props, forwardRef) => {
    const { item, ...rest } = props
    const icon = item?.icon
    const schema = Aglyn.components.getSchema(item?.componentId)
    const dndData = useMemo(() => {
      const { $id, data, componentId, pluginId } = item
      return {
        $id,
        data,
        componentId,
        pluginId: schema?.pluginId,
        restrictParent: schema?.restrictParent,
        restrictChildren: schema?.restrictChildren,
      }
    }, [item, schema])
    const [{ isDragging }, dragHandle, dragPreview] = useLeafDrag(
      dndData,
      Besigner.dnd.DragType.TEMPLATE,
    )
    const ref = useForkedRefs(forwardRef, dragHandle)

    return (
      <>
        <CardListItem
          ref={ref}
          ContentBoxProps={{
            ref: dragPreview,
          }}
          item={item}
          label={item.label}
          {...rest}
        >
          {!icon?.path && icon ? (
            (icon as any)
          ) : (
            <MdiIcon
              color="tertiary"
              {...icon}
              path={icon?.path || ICON_VARIANT_ELEMENT.path}
              sx={mergeSxProps(
                {
                  fontSize: { xs: `5ch`, sm: `4ch` },
                  padding: `0.15ch`,
                  color: 'tertiary.main',
                  overflow: 'visible',
                },
                icon?.sx,
              )}
            />
          )}
        </CardListItem>
      </>
    )
  },
)
type ComponentGroupDetailsProps = BoxProps &
  JSX.AnyProps & {
    item?: {
      items?: AglynNodePresetSchema[]
    }
    id?: string
    isOpen?: boolean
  }
const ComponentGroupDetails = forwardRef<any, ComponentGroupDetailsProps>(
  (props, ref) => {
    const { id, isOpen, item, ...rest } = props
    return (
      <Box ref={ref} {...rest}>
        <Grid container spacing={2}>
          {item?.items?.map((i, index) => (
            <Grid key={i?.presetId ?? index} xs={6} item>
              <ComponentGridItem item={i} />
            </Grid>
          ))}
        </Grid>
      </Box>
    )
  },
)

const ComponentsList = forwardRef<any, ListProps>((props, ref) => {
  const { ...rest } = props
  const app = useBesignerAppContext()
  const { nodePresets } = useAglynComponentsContext()
  const sortedItems = useMemo(
    () => arraySortBy(nodePresets, (i) => i.label),
    [nodePresets],
  )
  const allItem = useMemo(
    () => ({
      id: 'all',
      order: 99,
      labelPrimary: 'All',
      labelSecondary: 'All items sorted A-Z',
      icon: { path: ICON_VARIANT_ELEMENT_BROWSE.path },
      items: [...sortedItems],
    }),
    [sortedItems],
  )

  const items = useMemo<
    {
      id: string
      order: number
      labelPrimary: JSX.Node
      labelSecondary: JSX.Node
      icon: MdiIconProps
      items: AglynNodePresetSchema[]
    }[]
  >(() => {
    const bundles = []
    const cats = []

    sortedItems.forEach((item) => {
      const { category, data } = item || {}
      const { pluginId } = data || {}
      const bundled = pluginId && bundles.find((i) => i.presetId === pluginId)
      const categorized = category && cats.find((i) => i.presetId === category)

      if (bundled) bundled?.items?.push(item)
      if (categorized) categorized?.items?.push(item)
      if (!bundled && pluginId) {
        const bundle = getBundle(app, { pluginId })
        bundles.push({
          id: pluginId,
          order: 49,
          labelPrimary: bundle?.displayName ?? pluginId,
          labelSecondary: bundle?.subtitle || 'Category',
          icon: {
            path: ICON_VARIANT_ELEMENT_BROWSE.path,
            ...bundle?.icon,
          },
          items: [item],
        })
      }
      if (!categorized && category) {
        cats.push({
          id: category,
          order: 5,
          labelPrimary: category,
          labelSecondary: 'Bundle',
          icon: { path: ICON_VARIANT_ELEMENT_BROWSE.path },
          items: [item],
        })
      }
    })

    return arraySortBy([...cats, ...bundles, allItem], (i) => i.order ?? 0)
  }, [sortedItems, allItem, app])

  return (
    <>
      <AccordionListComponent
        unique
        items={items}
        AccordionSummaryProps={{ dense: true }}
        SummaryContentComponent={({ id, isOpen, item }) => (
          <>{item?.labelPrimary}</>
        )}
        DetailsContentComponent={ComponentGroupDetails}
      />
    </>
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
          icon: { path: ICON_VARIANT_ELEMENT_DETAILS.path },
          label: 'Info',
        },
        panel: {
          Component: withSelectedElement(ElementInfo),
        },
      },
      {
        value: BesignerPanelTabFlag.ELEMENT_PROPS_FORM,
        tab: {
          icon: { path: ICON_VARIANT_ELEMENT_PROPERTIES.path },
          label: 'Attributes',
        },
        panel: {
          Component: withSelectedElement(withTabPanelInner(ElementPropsForm)),
        },
      },
      {
        value: BesignerPanelTabFlag.ELEMENT_STYLES,
        tab: {
          icon: { path: ICON_VARIANT_ELEMENT_STYLES.path },
          label: 'Styles',
        },
        panel: {
          Component: withSelectedElement(withTabPanelInner(ElementStylesForm)),
        },
      },
    ],
  },
}

export interface AsidePanelComponentProps extends WorkspacePanelComponentProps {
  panel: BesignerPanelKey
}

const AsidePanelComponent = forwardRef<any, AsidePanelComponentProps>(
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
      (e, val) => {
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
                      color: ({ palette }) => palette.text.primary,
                      backgroundColor: ({ palette }) =>
                        palette.background.paper,
                    },
                  },
                  '& .MuiTabs-indicator': {
                    top: 0,
                    backgroundColor: ({ palette }) => palette.tertiary.main,
                  },
                }}
              >
                {tabs.map(({ value, tab: { icon, ...tab } }) => (
                  <MuiTab
                    key={value}
                    // color={'tertiary'}
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
AsidePanelComponent.defaultProps = {}

export { AsidePanelComponent }
export default AsidePanelComponent
