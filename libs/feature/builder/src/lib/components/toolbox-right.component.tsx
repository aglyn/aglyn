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
  useAglynAppContext,
  useAglynBuilderStore,
  useAglynCanvasApiEvents,
  useAglynElementData,
} from '@aglyn/feature-renderer'
import { componentMapper, FormRenderer, GridFormTemplate, SvgPathIcon } from '@aglyn/shared-ui-jsx'
import MuiTabContext from '@mui/lab/TabContext'
import MuiTabList from '@mui/lab/TabList'
import MuiTabPanel from '@mui/lab/TabPanel'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import MuiTab from '@mui/material/Tab'
import { forwardRef, useCallback, useState } from 'react'
import { useComponentFormSchema } from '../hooks/use-component-form-schema'
import { ToolboxDrawerComponent, ToolboxDrawerComponentProps } from './toolbox-drawer.component'


export interface ToolboxRightComponentProps extends ToolboxDrawerComponentProps {
}

export const ToolboxRightComponent = forwardRef<any, ToolboxRightComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      children,
      drawerWidth: drawerWidthProp,
      ...rest
    } = props

    const panel = useAglynBuilderStore('panels', 'right')
    const {toggled, drawerWidth = drawerWidthProp} = panel || {}
    const open = Boolean(toggled)
    const [activeView, setActiveView] = useState(() => 'element-form')
    const handleTabChange = useCallback((e, val) => setActiveView(val), [])


    const {getApp} = useAglynAppContext()
    const {addElement, updateElement} = useAglynCanvasApiEvents()
    const {$id} = useAglynBuilderStore('canvas', 'selected') || {}
    const {props: elemProps, componentId, bundleId} = useAglynElementData($id) || {}
    const formSchema = useComponentFormSchema({componentId, bundleId})

    const handleElementSave = useCallback((values) => {
      updateElement({element: {$id, props: {...values}}})
    }, [$id])
    const handleDrawerClose = useCallback((e, reason) => {

    }, [])
    const handleDeleteButtonClick = useCallback((e) => {

    }, [])


    return (
      <ToolboxDrawerComponent
        ref={ref}
        drawerWidth={drawerWidth}
        open={open}
        anchor="right"
        {...rest}
      >

        <MuiTabContext value={activeView}>
          <Box sx={{borderBottom: 1, borderColor: 'divider'}}>
            <MuiTabList
              onChange={handleTabChange}
              variant="fullWidth"
              indicatorColor="secondary"
              textColor="primary"
            >
              <MuiTab
                value="element-information"
                icon={<SvgPathIcon iconIds="information-variant" />}
              />
              <MuiTab
                value="element-form"
                icon={<SvgPathIcon iconIds="order-bool-descending-variant" />}
              />
            </MuiTabList>
          </Box>

          <MuiTabPanel
            value="element-information"
            sx={{p: 0, overflow: 'auto'}}
          >
            <Box px={2} py={2} width={1}>
            </Box>
          </MuiTabPanel>

          <MuiTabPanel
            value="element-form"
            sx={{p: 0, overflow: 'auto'}}
          >
            <Box px={2} py={2} width={1}>
              <FormRenderer
                FormTemplate={GridFormTemplate}
                componentMapper={componentMapper}
                onCancel={handleDrawerClose}
                onSubmit={handleElementSave}
                initialValues={elemProps}
                schema={formSchema}
              />

              <FormControl margin="none" fullWidth>
                <Button
                  onClick={handleDeleteButtonClick}
                  sx={{mt: 2, color: 'error.main'}}
                  fullWidth
                >
                  Delete Element
                </Button>
              </FormControl>
            </Box>
          </MuiTabPanel>
        </MuiTabContext>

        {children}
      </ToolboxDrawerComponent>
    )
  },
)

ToolboxRightComponent.displayName = 'ToolboxRightComponent'
ToolboxRightComponent.defaultProps = {}

export default ToolboxRightComponent
