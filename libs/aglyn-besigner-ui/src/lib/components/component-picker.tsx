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
import {
  ICON_VARIANT_CLEAR,
  ICON_VARIANT_FILTER,
  ICON_VARIANT_SEARCH,
} from '@aglyn/shared-data-enums'
import useAsyncEffect from '@aglyn/shared-ui-jsx/hooks/use-async-effect'
import MdiIcon from '@aglyn/shared-ui-mdi-jsx/components/mdi-icon'
import {
  Box,
  Collapse,
  Divider,
  Grid,
  IconButton,
  InputBase,
} from '@mui/material'
import { Observer, observer } from 'mobx-react-lite'
import { forwardRef, useCallback, useState } from 'react'
import AccordionListComponent from './accordion-list.component'
import CloseableDrawerComponent, {
  type CloseableDrawerProps,
} from './closeable-drawer.component'
import EmptyResults from './empty-results'
import NodeCard from './node-card'

export interface ComponentPickerProps extends CloseableDrawerProps {
  onSelect?: (item?: Aglyn.NodeSchema<any>) => void
}

export const ComponentPicker = observer(
  forwardRef<any, ComponentPickerProps>((props, forwardRef) => {
    const { open, ...rest } = props
    const allItems = Aglyn.components.schemasBySortedCategories

    const [searching, setSearching] = useState(false)
    const [filter, setFilter] = useState<string>('')
    const [items, setItems] = useState(allItems)

    useAsyncEffect(
      async (isMounted) => {
        let items = allItems
        if (filter) {
          // Dynamically load fuse.js
          const Fuse = (await import('fuse.js')).default
          const fuse = new Fuse<typeof allItems[number]['items'][number]>([], {
            shouldSort: true,
            keys: [
              'displayName',
              'title',
              'description',
              'subtitle',
              'category',
              'pluginId',
              'kind',
              '$id',
            ],
          })

          items = allItems
            .map((i) => {
              fuse.setCollection(i.items)
              return { ...i, items: fuse.search(filter).map((i) => i.item) }
            })
            .filter((i) => Boolean(i.items.length))
        }

        isMounted && setItems(items)
      },
      [filter, allItems],
    )

    const handleFilterChange = useCallback((e) => {
      const value = e.currentTarget?.value || ''
      setFilter(value)
    }, [])

    return (
      <CloseableDrawerComponent
        ref={forwardRef}
        action={'Close'}
        drawerTitle={'Add new element'}
        open={open}
        extraActions={
          <>
            <IconButton
              type="button"
              color="inherit"
              sx={{ p: '10px' }}
              aria-label="search"
              onClick={() => setSearching((prev) => !prev)}
            >
              <MdiIcon path={ICON_VARIANT_FILTER.path} />
            </IconButton>
            <Divider sx={{ height: 28, m: 0.5 }} orientation="vertical" />
          </>
        }
        childrenAfterToolbar={
          <Collapse orientation="vertical" in={searching}>
            <Box
              component="form"
              sx={{
                p: '2px 4px',
                display: 'flex',
                alignItems: 'center',
                width: 1,
                borderTop: 1,
                borderColor: 'divider',
              }}
            >
              <IconButton
                type="button"
                color="inherit"
                sx={{ p: '10px' }}
                aria-label="search"
                disabled
              >
                <MdiIcon path={ICON_VARIANT_SEARCH.path} />
              </IconButton>
              {/*<Divider sx={{ height: 28, m: 0.5 }} orientation="vertical" />*/}
              <InputBase
                sx={{ ml: 1, flex: 1 }}
                placeholder="Search Elements"
                inputProps={{ 'aria-label': 'search elements' }}
                value={filter}
                onChange={handleFilterChange}
              />
              {Boolean(filter) && (
                <>
                  <Divider sx={{ height: 28, m: 0.5 }} orientation="vertical" />
                  <IconButton
                    type="button"
                    color="inherit"
                    sx={{ p: '10px' }}
                    aria-label="search"
                    onClick={() => setFilter('')}
                  >
                    <MdiIcon path={ICON_VARIANT_CLEAR.path} />
                  </IconButton>
                </>
              )}
            </Box>
          </Collapse>
        }
        {...rest}
      >
        {!items?.length ? (
          <EmptyResults sx={{ minHeight: '40vh', height: 1 }} />
        ) : (
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
                    <Grid spacing={3} container sx={{ overflowX: 'hidden' }}>
                      {item?.items?.map((node, index) => (
                        <Grid key={node?.$id ?? index} xs={4} sm={3} item>
                          <NodeCard
                            sx={{ cursor: 'pointer' }}
                            node={node as any}
                          />
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                )}
              </Observer>
            )}
          />
        )}
      </CloseableDrawerComponent>
    )
  }),
)
ComponentPicker.displayName = 'ComponentPicker'

export default ComponentPicker
