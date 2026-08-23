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

import { REUSABLE_COMPONENT_CATEGORY } from '@aglyn/aglyn'
import { DragType } from '@aglyn/besigner'
import { mergeRefs } from '@aglyn/shared-ui-jsx'
import { DragOverlay } from '@dnd-kit/core'
import { Box, Grid, Stack } from '@mui/material'
import { Observer, observer } from 'mobx-react-lite'
import usePickerFilter from '../hooks/use-picker-filter'
import useVisibleComponentCategories from '../hooks/use-visible-component-categories'
import { besignerDocsUrl } from '../utils/docs-help'
import { AccordionListComponent } from './accordion-list.component'
import Draggable from './dnd/draggable'
import EmptyResults from './empty-results'
import NodeCard, { type NodeCardItemData } from './node-card'
import PickerSearchField from './picker-search-field'

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
    const allItems = useVisibleComponentCategories()

    // The SAME search the Choose-element dialog runs (AGL-2486). The panel
    // had no search at all; giving it a second implementation would mean two
    // pickers disagreeing about what `icon` matches, which is worse than one
    // of them having none.
    const { filter, items, handleFilterChange } = usePickerFilter(allItems)

    return (
      <Stack sx={{ height: 1, minHeight: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            px: 1,
            py: 0.5,
            borderBottom: 1,
            borderColor: 'divider',
            // The panel is a scrolling column; the search must stay reachable
            // without scrolling back to the top of ~45 elements.
            position: 'sticky',
            top: 0,
            zIndex: 6,
            backgroundColor: 'surface.main',
          }}
        >
          <PickerSearchField value={filter} onChange={handleFilterChange} />
        </Box>
        {!items?.length ? (
          <EmptyResults sx={{ minHeight: 200 }} />
        ) : (
          <AccordionListComponent
            // `defaultExpanded` is read once per mount, so the results group
            // would arrive collapsed without a fresh mount when the list flips
            // between grouped and flat. Keyed on the SHAPE, not the filter text,
            // so typing does not remount per press.
            key={filter ? 'results' : 'categories'}
            items={items}
            defaultExpanded={items.map((i) => i.$id)}
            getItemId={(item) => item?.$id}
            // Only the host's own components group carries help (AGL-2167).
            // The built-in groups are self-evident from their contents; this one
            // is the only group whose items the user has to CREATE before it
            // holds anything, and an empty-looking group explains nothing.
            getItemHelp={(item) =>
              item?.$id === REUSABLE_COMPONENT_CATEGORY
                ? {
                    title: 'Your components',
                    excerpt:
                      'Sections you promoted into reusable components. Drop one to place an instance — edit the component once and every instance follows.',
                    href: besignerDocsUrl(
                      'reusableComponents',
                      '#insert-instances',
                    ),
                  }
                : undefined
            }
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
                        <Grid key={node?.$id ?? index} size={6}>
                          <Draggable
                            node={node}
                            type={DragType.PRESET}
                            idSuffix={item?.$id}
                          >
                            {({ draggable, node, forwardRef }) => (
                              <>
                                <NodeCard
                                  ref={mergeRefs(
                                    forwardRef,
                                    draggable.setNodeRef,
                                  )}
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
        )}
      </Stack>
    )
  },
)
ComponentAccordionList.displayName = 'ComponentAccordionList'

export default ComponentAccordionList
