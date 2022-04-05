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

import {BesignerPanelTabFlag, setBesignerPanels} from '@aglyn/core-data-besigner'
import type {ElementId} from '@aglyn/core-data-framework'
import {
  useAglynAppContext,
  useAglynComponentSchema,
  useAglynElementData,
} from '@aglyn/core-feature-renderer'
import {ICON_VARIANT_DETAILS, ICON_VARIANT_PROPERTIES} from '@aglyn/shared-data-enums'
import {alpha, mergeSxProps, styled} from '@aglyn/shared-feature-themes'
import {MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {numberFromHexadecimal, numberToHexadecimal} from '@aglyn/shared-util-tools'
import {TabContext as MuiTabContext, TabList as MuiTabList, TabPanel as MuiTabPanel} from '@mui/lab'
import {Box, Divider, Tab as MuiTab, Typography} from '@mui/material'
import {forwardRef, Fragment, useCallback, useMemo} from 'react'
import useAglynBesignerPanelValue from '../hooks/use-aglyn-besigner-panel-value'
import useAglynCanvasSelected from '../hooks/use-aglyn-canvas-selected'
import ElementPropsForm from './element-props-form.component'
import {
  WorkspacePanelComponent,
  type WorkspacePanelComponentProps,
} from './workspace-panel.component'


const TabPanelInner = styled('div', {
  name: 'AglynTabPanelInner',
})(({theme}) => ({
  padding: theme.spacing(2),
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
  const details = useMemo(() => [
    {
      id: 'element-overview',
      label: 'Element Overview',
      items: [
        {
          id: 'component-display-name',
          label: 'Type',
          value: schema?.displayName,
        },
        {
          id: 'component-title',
          label: 'Title',
          value: schema?.title,
        },
        {
          id: 'component-subtitle',
          label: 'Subtitle',
          value: schema?.subtitle,
        },
        {
          id: 'component-description',
          label: 'Description',
          value: schema?.description,
          TypographyProps: {gutterBottom: true},
        },
      ],
    },
    {
      id: 'unique-identifiers',
      label: 'Unique Identifiers',
      items: [
        {
          id: 'element-id',
          label: 'Element ID',
          value: $id,
        },
        {
          id: 'parent-id',
          label: 'Parent Element ID',
          value: parentId,
        },
        {
          id: 'component-id',
          label: 'Component ID',
          value: componentId,
        },
        {
          id: 'bundle-id',
          label: 'Bundle ID',
          value: bundleId,
          ValueTypographyProps: {},
        },
      ],
    },
  ], [$id, bundleId, componentId, schema, parentId])

  return (
    <>
      {details.map(({label, items, ...item}, key) => (
        <Fragment key={item?.['key'] ?? item?.id ?? key}>
          <Typography variant="subtitle1" component="div" sx={{mb: 2}}>
            {label}
          </Typography>
          {items.map(({
            label,
            value,
            TypographyProps,
            ValueTypographyProps,
            ...item
          }: any, key) => (
            <Typography
              key={item?.['key'] ?? item?.id ?? key}
              component="div"
              {...TypographyProps}
            >
              <Typography
                variant="caption"
                display="inline"
                sx={{textTransform: 'uppercase'}}
              >
                <b>{label}:</b>
              </Typography>{' '}
              <Typography
                variant="body1"
                display="inline"
                {...ValueTypographyProps}
                sx={mergeSxProps((theme) => ({
                  bgcolor: alpha(theme.palette.secondary.light, 0.18),
                  border: `1px solid ${alpha(theme.palette.secondary.light, 0.72)}`,
                  borderRadius: '0.3em',
                  px: 0.5, py: 0.15,
                  wordBreak: 'break-word',
                }), ValueTypographyProps?.sx)}
              >
                {value || <i>{failoverText}</i>}
              </Typography>
            </Typography>
          ))}
          <DividerSpacer variant="middle" />
        </Fragment>
      ))}
    </>
  )
}

export interface PanelRightComponentProps extends WorkspacePanelComponentProps {}

export const PanelRightComponent = forwardRef<any, PanelRightComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    const {getApp} = useAglynAppContext()
    const selected = useAglynCanvasSelected()
    const toggled = useAglynBesignerPanelValue('panelRight', 'toggled')
    const tab = useAglynBesignerPanelValue('panelRight', 'tab')
    const size = useAglynBesignerPanelValue('panelRight', 'size')
    const value = tab || BesignerPanelTabFlag.ELEMENT_INFO
    const handleTabChange = useCallback((e, val) => {
      setBesignerPanels(getApp(), {
        panels: (panels) => ({
          ...panels,
          panelRight: {
            ...panels.panelRight,
            tab: numberFromHexadecimal(val),
          },
        }),
      })
    }, [getApp])

    return (
      <WorkspacePanelComponent
        ref={ref}
        id="aglyn:panel-right"
        aria-label="right toolbox panel"
        size={size}
        open={toggled}
        anchor="right"
        component="aside"
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
              <MuiTab
                value={numberToHexadecimal(BesignerPanelTabFlag.ELEMENT_INFO)}
                icon={<MdiIcon path={ICON_VARIANT_DETAILS.path} />}
              />
              <MuiTab
                value={numberToHexadecimal(BesignerPanelTabFlag.ELEMENT_PROPS_FORM)}
                icon={<MdiIcon path={ICON_VARIANT_PROPERTIES.path} />}
              />
            </MuiTabList>
          </Box>

          <TabPanel value={numberToHexadecimal(BesignerPanelTabFlag.ELEMENT_INFO)}>
            <TabPanelInner>
              {selected?.$id ? (
                <ElementInfo $id={selected?.$id} />
              ) : (
                <Typography variant="subtitle1" component="div" align="center">
                  No element selected...
                </Typography>
              )}
            </TabPanelInner>
          </TabPanel>

          <TabPanel value={numberToHexadecimal(BesignerPanelTabFlag.ELEMENT_PROPS_FORM)}>
            <TabPanelInner>
              {selected?.$id ? (
                <ElementPropsForm $id={selected?.$id} />
              ) : (
                <Typography variant="subtitle1" component="div" align="center">
                  No element selected...
                </Typography>
              )}
            </TabPanelInner>
          </TabPanel>
        </MuiTabContext>

        {children}
      </WorkspacePanelComponent>
    )
  },
)

PanelRightComponent.displayName = 'PanelRightComponent'
PanelRightComponent.aglyn = true
PanelRightComponent.defaultProps = {}

export default PanelRightComponent
