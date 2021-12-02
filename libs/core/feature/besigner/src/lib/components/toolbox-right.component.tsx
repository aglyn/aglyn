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

import {
  useAglynBuilderStore,
  useAglynCanvasApiEvents,
  useAglynComponentSchema,
  useAglynElementData,
} from '@aglyn/core-feature-renderer'
import { styled } from '@aglyn/shared-feature-themes'
import { componentMapper, FormRenderer, GridFormTemplate, SvgPathIcon } from '@aglyn/shared-ui-jsx'
import MuiTabContext from '@mui/lab/TabContext'
import MuiTabList from '@mui/lab/TabList'
import MuiTabPanel from '@mui/lab/TabPanel'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import MuiTab from '@mui/material/Tab'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback, useState } from 'react'
import { useAglynCanvasSelected } from '../hooks/use-aglyn-canvas-selected'
import { useComponentFormSchema } from '../hooks/use-component-form-schema'
import { ToolboxDrawerComponent, ToolboxDrawerComponentProps } from './toolbox-drawer.component'

const TabPanelInner = styled('div', {
  name: 'AglynTabPanelInner',
})(({ theme }) => ({
  padding: theme.spacing(2),
  width: '100%',
}))
const DividerSpacer = styled(Divider, {
  name: 'AglynDividerSpacer',
})(({ theme }) => ({
  marginTop: theme.spacing(2),
  marginBottom: theme.spacing(2),
}))

const ElementInfo = (props) => {
  const { $id } = useAglynCanvasSelected() || {}
  const { componentId, bundleId, parentId } = useAglynElementData($id) || {}
  const { metadata } = useAglynComponentSchema(componentId, bundleId) || {}
  const { displayName, title, subtitle, description } = metadata || {}
  const failoverText = '(undefined)'
  const details = [
    {
      title: 'Element Overview',
      data: [
        {
          subtitle: 'Type',
          value: displayName,
        },
        {
          subtitle: 'Title',
          value: title,
        },
        {
          subtitle: 'Subtitle',
          value: subtitle,
        },
        {
          subtitle: 'Description',
          value: description,
        },
      ],
    },
    {
      title: 'Unique Identifiers',
      data: [
        {
          subtitle: 'Element ID',
          value: $id,
        },
        {
          subtitle: 'Parent Element ID',
          value: parentId,
        },
        {
          subtitle: 'Component ID',
          value: componentId,
        },
        {
          subtitle: 'Bundle ID',
          value: bundleId,
        },
      ],
    },
  ]
  return (
    <TabPanelInner {...props}>
      {$id ? (
        <>
          {details.map(({ title, data }) => (
            <>
              <Typography variant="subtitle1" component="div" sx={{ mb: 2 }}>
                {title}
              </Typography>
              {data.map((i) => (
                <>
                  <Typography variant="caption" component="div" sx={{ textTransform: 'uppercase' }}>
                    <b>{i.subtitle}:</b>
                  </Typography>
                  <Typography variant="body1" component="div" gutterBottom>
                    {i.value || <i>{failoverText}</i>}
                  </Typography>
                </>
              ))}
              <DividerSpacer variant="middle" />
            </>
          ))}
        </>
      ) : (
        <Typography variant="subtitle1" component="div" align="center">
          No element selected...
        </Typography>
      )}
    </TabPanelInner>
  )
}

const PropsForm = (props) => {
  const { addElement, updateElement } = useAglynCanvasApiEvents()
  const { $id } = useAglynCanvasSelected() || {}
  const { props: elemProps, componentId, bundleId } = useAglynElementData($id) || {}
  const formSchema = useComponentFormSchema({ componentId, bundleId })

  const handleElementSave = useCallback(
    (values) => {
      updateElement({ element: { $id, props: { ...values } } })
    },
    [$id]
  )
  const handleDrawerClose = useCallback((e, reason) => {}, [])
  const handleDeleteButtonClick = useCallback((e) => {}, [])

  return (
    <TabPanelInner {...props}>
      <FormRenderer
        FormTemplate={GridFormTemplate}
        componentMapper={componentMapper}
        onCancel={handleDrawerClose}
        onSubmit={handleElementSave}
        initialValues={elemProps}
        schema={formSchema}
      />

      <FormControl margin="none" fullWidth>
        <Button onClick={handleDeleteButtonClick} sx={{ mt: 2, color: 'error.main' }} fullWidth>
          Delete Element
        </Button>
      </FormControl>
    </TabPanelInner>
  )
}

export interface ToolboxRightComponentProps extends ToolboxDrawerComponentProps {}

export const ToolboxRightComponent = forwardRef<any, ToolboxRightComponentProps>(
  function RefRenderFn(props, ref) {
    const { children, drawerWidth: drawerWidthProp, ...rest } = props

    const panel = useAglynBuilderStore('panels', 'right')
    const { toggled, tab, drawerWidth = drawerWidthProp } = panel || {}
    const open = Boolean(toggled)
    const [activeView, setActiveView] = useState(() => tab ?? 'element-props-form')
    const handleTabChange = useCallback((e, val) => setActiveView(val), [])

    const panels = [
      {
        $id: 'element-information',
        iconIds: 'information-variant',
        component: ElementInfo,
      },
      {
        $id: 'element-props-form',
        iconIds: 'order-bool-descending-variant',
        component: PropsForm,
      },
    ]

    return (
      <ToolboxDrawerComponent
        ref={ref}
        drawerWidth={drawerWidth}
        open={open}
        anchor="right"
        {...rest}
      >
        <MuiTabContext value={activeView}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <MuiTabList
              onChange={handleTabChange}
              variant="fullWidth"
              indicatorColor="secondary"
              textColor="primary"
            >
              {panels.map(({ $id, iconIds }) => (
                <MuiTab key={$id} value={$id} icon={<SvgPathIcon iconIds={iconIds} />} />
              ))}
            </MuiTabList>
          </Box>
          {panels.map(({ $id, component: Component }) => (
            <MuiTabPanel key={$id} value={$id} sx={{ p: 0, overflow: 'auto' }}>
              <Component />
            </MuiTabPanel>
          ))}
        </MuiTabContext>

        {children}
      </ToolboxDrawerComponent>
    )
  }
)

ToolboxRightComponent.displayName = 'ToolboxRightComponent'
ToolboxRightComponent.defaultProps = {}

export default ToolboxRightComponent
