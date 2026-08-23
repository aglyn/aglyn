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
import { DragOverlay, useDndMonitor } from '@dnd-kit/core'
import { Box, Grid, Stack } from '@mui/material'
import { Observer, observer } from 'mobx-react-lite'
import { useEffect } from 'react'
import { useElementDrawerContext } from '../contexts/element-drawer-context'
import useDetailHoverIntent from '../hooks/use-detail-hover-intent'
import usePickerFilter from '../hooks/use-picker-filter'
import useVisibleComponentCategories from '../hooks/use-visible-component-categories'
import { besignerDocsUrl } from '../utils/docs-help'
import { AccordionListComponent } from './accordion-list.component'
import Draggable from './dnd/draggable'
import ElementDetailOverlay from './element-detail-overlay.component'
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

    // Hover previews, click PINS, and the pin outranks the pointer — which
    // is what makes the floating panel clickable at all. See
    // `useDetailHoverIntent` for why each half is load-bearing.
    const detail = useDetailHoverIntent<NodeCardItemData>()

    // The panel floats over the CANVAS, which is exactly where a dragged
    // element is going. It leaves the drop path on drag START — waiting for
    // the drop would leave it sitting under the pointer for the whole
    // gesture — and stays suspended until the drag ends so the cards the
    // pointer crosses on the way out cannot re-open it.
    useDndMonitor({
      onDragStart: detail.suspend,
      onDragEnd: detail.resume,
      onDragCancel: detail.resume,
    })

    // A modal opening over the panel is a context change, and a pinned
    // detail has no business outliving it.
    const drawerOpen = useElementDrawerContext()?.open
    useEffect(() => {
      if (drawerOpen) detail.dismiss()
    }, [drawerOpen, detail])

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
          // The grid scrolls; the detail region below it does not, so the
          // description stays put while you browse.
          // Scrolling moves the card the panel is anchored to, so a pinned
          // panel would end up pointing at whatever slid into its place.
          <Box
            sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
            onScroll={detail.dismiss}
          >
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
                          <Grid
                            key={node?.$id ?? index}
                            size={6}
                            onMouseEnter={(e) =>
                              detail.open(node, e.currentTarget as HTMLElement)
                            }
                            onMouseLeave={detail.scheduleClose}
                            onClick={(e) =>
                              detail.togglePin(
                                node,
                                e.currentTarget as HTMLElement,
                              )
                            }
                          >
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
                                      draggable.isDragging
                                        ? { opacity: 0.5 }
                                        : {}
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
          </Box>
        )}
        <ElementDetailOverlay
          item={detail.active?.item}
          anchor={detail.active?.anchor ?? null}
          pinned={detail.isPinned}
          onPointerEnter={detail.keepOpen}
          onPointerLeave={detail.scheduleClose}
          onDismiss={detail.dismiss}
        />
      </Stack>
    )
  },
)
ComponentAccordionList.displayName = 'ComponentAccordionList'

export default ComponentAccordionList
