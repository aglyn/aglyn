/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import {BesignerPanelTabFlag, setBesignerPanels} from '@aglyn/core-data-framework'
import {
  useAglynAppContext,
  useAglynComponentSchema,
  useAglynElementData,
} from '@aglyn/core-feature-renderer'
import {IconVariant} from '@aglyn/shared-data-brand'
import {styled} from '@aglyn/shared-feature-themes'
import {MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {_isEqualitySameType} from '@aglyn/shared-util-guards'
import {hexadecimalFromNumber, hexadecimalToNumber} from '@aglyn/shared-util-tools'
import MuiTabContext from '@mui/lab/TabContext'
import MuiTabList from '@mui/lab/TabList'
import MuiTabPanel from '@mui/lab/TabPanel'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import MuiTab from '@mui/material/Tab'
import Typography from '@mui/material/Typography'
import React, {forwardRef, Fragment, useCallback} from 'react'
import useAglynBesignerPanelValue from '../hooks/use-aglyn-besigner-panel-value'
import useAglynCanvasSelected from '../hooks/use-aglyn-canvas-selected'
import ElementPropsForm from './element-props-form.component'
import {WorkspacePanelComponent, WorkspacePanelComponentProps} from './workspace-panel.component'


const TabPanelInner = styled('div', {
  name: 'AglynTabPanelInner',
})(({theme}) => ({
  padding: theme.spacing(2),
  width: '100%',
}))
const DividerSpacer = styled(Divider, {
  name: 'AglynDividerSpacer',
})(({theme}) => ({
  marginTop: theme.spacing(2),
  marginBottom: theme.spacing(2),
}))

const ElementInfo = function ElementInfo({$id, ...props}: any) {
  const {componentId, bundleId, parentId} = useAglynElementData($id) || {}
  const {metadata} = useAglynComponentSchema(componentId, bundleId) || {}
  const {displayName, title, subtitle, description} = metadata || {}
  const failoverText = '(undefined)'
  const details = [
    {
      id: 'element-overview',
      label: 'Element Overview',
      items: [
        {
          id: 'component-display-name',
          label: 'Type',
          value: displayName,
        },
        {
          id: 'component-title',
          label: 'Title',
          value: title,
        },
        {
          id: 'component-subtitle',
          label: 'Subtitle',
          value: subtitle,
        },
        {
          id: 'component-description',
          label: 'Description',
          value: description,
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
        },
      ],
    },
  ]
  return (
    <TabPanelInner {...props}>
      {details.map(({id, label, items}) => (
        <Fragment key={id}>
          <Typography variant="subtitle1" component="div" sx={{mb: 2}}>
            {label}
          </Typography>
          {items.map(({id, label, value}) => (
            <Fragment key={id}>
              <Typography variant="caption" component="div" sx={{textTransform: 'uppercase'}}>
                <b>{label}:</b>
              </Typography>
              <Typography variant="body1" component="div" gutterBottom>
                {value || <i>{failoverText}</i>}
              </Typography>
            </Fragment>
          ))}
          <DividerSpacer variant="middle" />
        </Fragment>
      ))}
    </TabPanelInner>
  )
}


const PropsForm = function PropsForm({$id, ...props}: any) {

  return (
    <TabPanelInner {...props}>
      <ElementPropsForm
        $id={$id}
      />
    </TabPanelInner>
  )
}

const tabs = [
  {
    id: BesignerPanelTabFlag.ELEMENT_INFO,
    iconPath: IconVariant.DETAILS,
    component: ElementInfo,
  },
  {
    id: BesignerPanelTabFlag.ELEMENT_PROPS_FORM,
    iconPath: IconVariant.PROPERTIES,
    component: PropsForm,
  },
]

export interface PanelRightComponentProps extends WorkspacePanelComponentProps {}

export const PanelRightComponent = forwardRef<any, PanelRightComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    const {getApp} = useAglynAppContext()
    const {$id} = useAglynCanvasSelected() || {}
    const toggled = useAglynBesignerPanelValue('panelRight', 'toggled')
    const tab = useAglynBesignerPanelValue('panelRight', 'tab')
    const size = useAglynBesignerPanelValue('panelRight', 'size')
    const value = tab && _isEqualitySameType(tab, ...tabs.map((i) => i.id))
      ? tab : BesignerPanelTabFlag.ELEMENT_INFO
    const handleTabChange = useCallback((e, val) => {
      setBesignerPanels(getApp(), {panelRight: {tab: hexadecimalToNumber(val)}})
    }, [])

    return (
      <WorkspacePanelComponent
        ref={ref}
        size={size}
        open={toggled}
        anchor="right"
        {...rest}
      >
        <MuiTabContext value={hexadecimalFromNumber(value)}>
          <Box sx={{borderBottom: 1, borderColor: 'divider'}}>
            <MuiTabList
              onChange={handleTabChange}
              variant="fullWidth"
              indicatorColor="secondary"
              textColor="primary"
            >
              {tabs.map(({id, iconPath}) => (
                <MuiTab
                  key={id}
                  value={hexadecimalFromNumber(id)}
                  icon={<MdiIcon path={iconPath} />}
                />
              ))}
            </MuiTabList>
          </Box>
          {tabs.map(({component: Component, id}) => (
            <MuiTabPanel
              key={id}
              value={hexadecimalFromNumber(id)}
              sx={{p: 0, overflow: 'auto'}}
            >
              {$id ? (<Component $id={$id} />) : (
                <TabPanelInner>
                  <Typography variant="subtitle1" component="div" align="center">
                    No element selected...
                  </Typography>
                </TabPanelInner>
              )}
            </MuiTabPanel>
          ))}
        </MuiTabContext>

        {children}
      </WorkspacePanelComponent>
    )
  },
)

PanelRightComponent.displayName = 'PanelRightComponent'
PanelRightComponent.defaultProps = {}

export default PanelRightComponent
