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
import {useAglynAppContext} from '@aglyn/core-feature-renderer'
import {IconVariant} from '@aglyn/shared-data-brand'
import {SvgPathIcon} from '@aglyn/shared-ui-jsx'
import {_isEqualitySameType} from '@aglyn/shared-util-guards'
import {hexadecimalFromNumber, hexadecimalToNumber} from '@aglyn/shared-util-tools'
import MuiTabContext from '@mui/lab/TabContext'
import MuiTabList from '@mui/lab/TabList'
import MuiTabPanel from '@mui/lab/TabPanel'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MuiTab from '@mui/material/Tab'
import {forwardRef, memo, useCallback, useMemo} from 'react'
import {useAddElementCallback} from '../hooks/use-add-element-callback'
import {useAglynBesignerStoreState} from '../hooks/use-aglyn-besigner-store-state'
import {ElementsTreeViewComponent} from './elements-tree-view.component'
import {WorkspacePanelComponent, WorkspacePanelComponentProps} from './workspace-panel.component'


const ElementsTree = memo(function ElementsTree() {
  const handleAddElementClick = useAddElementCallback()
  return (
    <>
      <Box sx={{px: 0.5, pb: 1, pt: 1}}>
        <Button
          color="secondary"
          startIcon={<SvgPathIcon fontSize="inherit" iconIds="plus" />}
          onClick={handleAddElementClick}
        >
          Add Element
        </Button>
      </Box>
      <ElementsTreeViewComponent />
    </>
  )
})

const tabs = [
  {
    id: BesignerPanelTabFlag.ELEMENTS_TREE,
    iconIds: IconVariant.TREE_VIEW,
    component: ElementsTree,
  },
]

export interface PanelLeftComponentProps extends WorkspacePanelComponentProps {}

const PanelLeftComponent = forwardRef<any, PanelLeftComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    const {getApp} = useAglynAppContext()
    const {toggled, tab, size} = useAglynBesignerStoreState('panels', 'panelLeft') || {}
    const value = useMemo(() => {
      return tab && _isEqualitySameType(tab, ...tabs.map((i) => i.id))
        ? tab : BesignerPanelTabFlag.ELEMENTS_TREE
    }, [tab])

    const handleTabChange = useCallback((e, val) => {
      setBesignerPanels(getApp(), {panelRight: {tab: hexadecimalToNumber(val)}})
    }, [])

    return (
      <WorkspacePanelComponent
        ref={ref}
        size={size}
        open={toggled}
        anchor="left"
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
              {tabs.map(({id, iconIds}) => (
                <MuiTab
                  key={id}
                  value={hexadecimalFromNumber(id)}
                  icon={<SvgPathIcon iconIds={iconIds} />}
                />
              ))}
            </MuiTabList>
          </Box>
          {tabs.map(({id, component: Component}) => (
            <MuiTabPanel
              key={id}
              value={hexadecimalFromNumber(id)}
              sx={{p: 0, overflow: 'auto'}}
            >
              <Component />
            </MuiTabPanel>
          ))}
        </MuiTabContext>

        {children}
      </WorkspacePanelComponent>
    )
  },
)

PanelLeftComponent.displayName = 'PanelLeftComponent'
PanelLeftComponent.defaultProps = {}

export {PanelLeftComponent}
export default PanelLeftComponent
