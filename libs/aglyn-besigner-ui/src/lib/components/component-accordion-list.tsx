/**
 * @license
 * Copyright 2023 Aglyn LLC
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
import { DragType } from '@aglyn/besigner'
import { mergeRefs } from '@aglyn/shared-ui-jsx'
import { DragOverlay } from '@dnd-kit/core'
import { Box, Grid } from '@mui/material'
import { Observer, observer } from 'mobx-react-lite'
import { AccordionListComponent } from './accordion-list.component'
import Draggable from './dnd/draggable'
import NodeCard, { type NodeCardItemData } from './node-card'

export type ComponentGridGroupItemData = {
  $id: string
  label: string
  items: NodeCardItemData[]
}

NodeCard.displayName = 'NodeCard'

interface ComponentAccordionListProp {}

export const ComponentAccordionList = observer(
  (props: ComponentAccordionListProp) => {
    const { ...rest } = props
    const items = Aglyn.components.schemasBySortedCategories

    return (
      <AccordionListComponent
        items={items}
        defaultExpanded={items.map((i) => i.$id)}
        getItemId={(item) => item?.$id}
        onRenderSummary={({ item }) => (
          <Observer>{() => <>{item?.label}</>}</Observer>
        )}
        AccordionDetailsProps={{
          sx: { overflowX: 'hidden' },
        }}
        onRenderDetail={({ item }) => (
          <Observer>
            {() => (
              <Box>
                <Grid spacing={2} container sx={{ overflowX: 'hidden' }}>
                  {item?.items?.map((node, index) => (
                    <Grid key={node?.$id ?? index} xs={6} item>
                      <Draggable
                        node={node}
                        type={DragType.PRESET}
                        idSuffix={item?.$id}
                      >
                        {({ draggable, node, forwardRef }) => (
                          <>
                            <NodeCard
                              ref={mergeRefs(forwardRef, draggable.setNodeRef)}
                              node={node as any}
                              style={
                                draggable.isDragging ? { opacity: 0.5 } : {}
                              }
                              {...draggable.listeners}
                            />
                            <DragOverlay dropAnimation={null}>
                              {draggable.isDragging && (
                                <NodeCard
                                  node={node as any}
                                  sx={{ zIndex: 9999 }}
                                />
                              )}
                            </DragOverlay>
                          </>
                        )}
                      </Draggable>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}
          </Observer>
        )}
        {...rest}
      />
    )
  },
)
ComponentAccordionList.displayName = 'ComponentAccordionList'

export default ComponentAccordionList
