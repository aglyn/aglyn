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
  ICON_VARIANT_CLOSE,
  ICON_VARIANT_FILTER,
  ICON_VARIANT_SEARCH,
} from '@aglyn/shared-data-enums'
import MdiIcon from '@aglyn/shared-ui-mdi-jsx/components/mdi-icon'
import {
  AppBar,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogContent,
  Divider,
  DrawerProps,
  Grid,
  IconButton,
  InputAdornment,
  InputBase,
  Slide,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material'
import type { TransitionProps } from '@mui/material/transitions'
import { Observer, observer } from 'mobx-react-lite'
import { forwardRef, SyntheticEvent, useCallback, useState } from 'react'
import AccordionListComponent from './accordion-list.component'
import EmptyResults from './empty-results'
import NodeCard from './node-card'

const Transition = forwardRef(function Transition(
  props: TransitionProps & {
    children: React.ReactElement
  },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />
})

export interface ComponentPickerProps extends DrawerProps {
  onSelectItem?: (
    e: SyntheticEvent,
    item?: { option: Aglyn.NodeSchema<any> },
  ) => void
}

export const ComponentPicker = observer(
  forwardRef<any, ComponentPickerProps>((props, forwardRef) => {
    const { open, onClose, onSelectItem, ...rest } = props
    const allItems = Aglyn.components.schemasBySortedCategories

    const [filterOpen, setFilterOpen] = useState(false)
    const [filter, setFilter] = useState('')
    const [items, setItems] = useState(allItems)
    const [selected, setSelected] = useState<Aglyn.NodeSchema<any>>(null)

    const clearSelected = useCallback(() => setSelected(null), [])
    const handleConfirm = useCallback(
      (e: SyntheticEvent) => {
        onSelectItem?.(e, { option: selected })
      },
      [selected, onSelectItem],
    )

    const handleFilterChange = useCallback(
      async (e) => {
        const filter = e.currentTarget?.value || ''
        setFilter(filter)
        clearSelected()
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

        setItems(items)
      },
      [allItems, clearSelected],
    )

    const handleClose = useCallback(
      (e, reason = 'unknown') => {
        onClose?.(e, reason as any)
      },
      [onClose],
    )

    return (
      <Dialog
        ref={forwardRef}
        onClose={handleClose}
        open={open}
        maxWidth="sm"
        PaperProps={{ sx: { width: '100%' } }}
        TransitionComponent={Transition}
        {...rest}
      >
        <AppBar position="relative">
          <Toolbar>
            <IconButton
              edge="start"
              color="inherit"
              onClick={handleClose}
              aria-label="close"
            >
              <MdiIcon path={ICON_VARIANT_CLOSE.path} />
            </IconButton>
            <Typography
              sx={{ ml: 2, flex: 1 }}
              variant="h6"
              component="div"
              textOverflow="ellipsis"
              noWrap
            >
              {'Choose element'}
            </Typography>
            <IconButton
              type="button"
              color="inherit"
              sx={{ p: '10px' }}
              aria-label="search"
              onClick={() => setFilterOpen((prev) => !prev)}
            >
              <MdiIcon path={ICON_VARIANT_FILTER.path} />
            </IconButton>
            <Divider sx={{ height: 28, m: 0.5 }} orientation="vertical" />
            <Button autoFocus color="inherit" onClick={handleClose}>
              {'Close'}
            </Button>
          </Toolbar>

          <Collapse orientation="vertical" in={filterOpen}>
            <Toolbar
              component="form"
              variant="dense"
              sx={{
                display: 'flex',
                alignItems: 'center',
                width: 1,
                borderTop: 1,
                borderColor: 'divider',
              }}
            >
              {/*<Divider sx={{ height: 28, m: 0.5 }} orientation="vertical" />*/}
              <InputBase
                sx={{ flex: 1, color: 'inherit' }}
                placeholder="Search elements"
                inputProps={{ 'aria-label': 'search elements' }}
                value={filter}
                onChange={handleFilterChange}
                startAdornment={
                  <InputAdornment sx={{ color: 'inherit' }} position="start">
                    <MdiIcon path={ICON_VARIANT_SEARCH.path} />
                  </InputAdornment>
                }
                endAdornment={
                  filter && (
                    <InputAdornment sx={{ color: 'inherit' }} position="end">
                      <IconButton
                        type="button"
                        color="inherit"
                        sx={{ p: '10px' }}
                        aria-label="clear filter"
                        onClick={handleFilterChange}
                      >
                        <MdiIcon path={ICON_VARIANT_CLEAR.path} />
                      </IconButton>
                    </InputAdornment>
                  )
                }
              />
            </Toolbar>
          </Collapse>
        </AppBar>

        <DialogContent dividers sx={{ p: 0 }}>
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
                        {item?.items?.map((node: any, index) => (
                          <Observer key={node?.$id ?? index}>
                            {() => (
                              <Grid xs={4} sm={3} item>
                                <NodeCard
                                  sx={[
                                    { cursor: 'pointer' },
                                    selected?.$id === node?.$id
                                      ? { borderColor: 'secondary.main' }
                                      : null,
                                  ]}
                                  node={node as any}
                                  onClick={(e) => setSelected(node)}
                                />
                              </Grid>
                            )}
                          </Observer>
                        ))}
                      </Grid>
                    </Box>
                  )}
                </Observer>
              )}
            />
          )}
        </DialogContent>
        <Box sx={{ flex: '0 0 auto', display: 'flex' }}>
          <Collapse in={Boolean(selected)} sx={{ p: 1, pl: 2, width: 1 }}>
            <Stack
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Typography
                variant="subtitle1"
                textOverflow="ellipsis"
                color="textSecondary"
                noWrap
              >
                {selected?.['displayName'] || selected?.$id}
              </Typography>
              <Button onClick={handleConfirm}>{'Confirm'}</Button>
            </Stack>
          </Collapse>
        </Box>
      </Dialog>
    )
  }),
)
ComponentPicker.displayName = 'ComponentPicker'

export default ComponentPicker
