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
import {useAglynAppContext} from '@aglyn/core-feature-renderer'
import {ICON_VARIANT_TREE_VIEW} from '@aglyn/shared-data-enums'
import {styled} from '@aglyn/shared-feature-themes'
import {MdiIcon, mdiPlus} from '@aglyn/shared-ui-mdi-jsx'
import {numberFromHexadecimal, numberToHexadecimal} from '@aglyn/shared-util-tools'
import {TabContext as MuiTabContext, TabList as MuiTabList, TabPanel as MuiTabPanel} from '@mui/lab'
import {Box, Button, Tab as MuiTab} from '@mui/material'
import {forwardRef, useCallback} from 'react'
import {useAddElementCallback} from '../hooks/use-add-element-callback'
import {useAglynBesignerStoreState} from '../hooks/use-aglyn-besigner-store-state'
import {
  ElementsTreeViewComponent,
  type ElementsTreeViewComponentProps,
} from './elements-tree-view.component'
import {
  WorkspacePanelComponent,
  type WorkspacePanelComponentProps,
} from './workspace-panel.component'


const TabPanelInner = styled('div', {
  name: 'AglynTabPanelInner',
})(({theme}) => ({
  width: '100%',
  height: '100%',
}))
const TabPanel = styled(MuiTabPanel, {
  name: 'AglynTabPanel',
})({
  padding: 0,
  overflow: 'auto',
  height: '100%',
})

const ElementsTree = forwardRef<any, ElementsTreeViewComponentProps>(
  function RefRenderFn(props, ref) {
    const handleAddElementClick = useAddElementCallback()
    return (
      <ElementsTreeViewComponent ref={ref} {...props}>
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
    )
  },
)

export interface PanelLeftComponentProps extends WorkspacePanelComponentProps {}

const PanelLeftComponent = forwardRef<any, PanelLeftComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    const {getApp} = useAglynAppContext()
    const {toggled, tab, size} = useAglynBesignerStoreState('panels', 'panelLeft') || {}
    const value = tab || BesignerPanelTabFlag.ELEMENTS_TREE

    const handleTabChange = useCallback((e, val) => {
      setBesignerPanels(getApp(), {
        panels: (panels) => ({
          ...panels,
          panelLeft: {
            ...panels.panelLeft,
            tab: numberFromHexadecimal(val),
          },
        }),
      })
    }, [getApp])

    return (
      <WorkspacePanelComponent
        ref={ref}
        id="aglyn:panel-left"
        aria-label="left toolbox panel"
        size={size}
        open={toggled}
        anchor="left"
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
                value={numberToHexadecimal(BesignerPanelTabFlag.ELEMENTS_TREE)}
                icon={<MdiIcon path={ICON_VARIANT_TREE_VIEW.path} />}
              />
            </MuiTabList>
          </Box>

          <TabPanel value={numberToHexadecimal(BesignerPanelTabFlag.ELEMENTS_TREE)}>
            <TabPanelInner>
              <ElementsTree />
            </TabPanelInner>
          </TabPanel>

        </MuiTabContext>

        {children}
      </WorkspacePanelComponent>
    )
  },
)

PanelLeftComponent.displayName = 'PanelLeftComponent'
PanelLeftComponent.aglyn = true
PanelLeftComponent.defaultProps = {}

export {PanelLeftComponent}
export default PanelLeftComponent
