/**
 * @license
 * Copyright 2026 Aglyn LLC
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
  ICON_VARIANT_CLOSE,
  ICON_VARIANT_FILTER,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  AppBar,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogContent,
  Divider,
  DialogProps,
  Grid,
  IconButton,
  Slide,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material'
import type { TransitionProps } from '@mui/material/transitions'
import { Observer, observer } from 'mobx-react-lite'
import { forwardRef, SyntheticEvent, useCallback, useState } from 'react'
import usePickerFilter from '../hooks/use-picker-filter'
import useVisibleComponentCategories from '../hooks/use-visible-component-categories'
import { describeElement } from '../utils/describe-element'
import AccordionListComponent from './accordion-list.component'
import ElementDetailView from './element-detail.component'
import EmptyResults from './empty-results'
import NodeCard from './node-card'
import PickerSearchField from './picker-search-field'

const Transition = forwardRef(function Transition(
  props: TransitionProps & {
    children: React.ReactElement
  },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />
})

type PickerOption = Aglyn.ComponentSchema<any> | Aglyn.PresetSchema<any>

export interface ComponentPickerProps extends DialogProps {
  onSelectItem?: (e: SyntheticEvent, item?: { option: PickerOption }) => void
}

export const ComponentPicker = observer(
  forwardRef<any, ComponentPickerProps>((props, forwardRef) => {
    const { open, onClose, onSelectItem, ...rest } = props
    const allItems = useVisibleComponentCategories()

    const [filterOpen, setFilterOpen] = useState(false)
    const [selected, setSelected] = useState<PickerOption>(null)

    const clearSelected = useCallback(() => setSelected(null), [])

    // The SAME search the Elements panel runs (AGL-2486). Both surfaces read
    // one hook so a query cannot mean two different things depending on
    // which picker you happened to open.
    const { filter, items, handleFilterChange } = usePickerFilter(
      allItems,
      clearSelected,
    )

    const handleConfirm = useCallback(
      (e: SyntheticEvent) => {
        onSelectItem?.(e, { option: selected })
      },
      [selected, onSelectItem],
    )

    const handleClose = useCallback(
      (e: object, reason = 'canceled') => {
        onClose?.(
          e,
          reason as Parameters<NonNullable<DialogProps['onClose']>>[1],
        )
      },
      [onClose],
    )

    const handleItemClick = useCallback((e, item: PickerOption) => {
      setSelected((prev) => {
        if (prev && prev?.$id === item?.$id) {
          return null
        }
        return item
      })
    }, [])

    return (
      <Dialog
        ref={forwardRef}
        onClose={handleClose}
        open={open}
        maxWidth="sm"
        slotProps={{ paper: { sx: { width: '100%' } } }}
        slots={{ transition: Transition }}
        {...rest}
      >
        {/* Shared app-bar treatment (AGL-704) — see the console's
            secondary-app-bar. enableColorOnDark is required or AppBar
            substitutes its own dark-mode colour. */}
        <AppBar position="relative" color="surface" enableColorOnDark>
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
              variant="h6"
              component="div"
              noWrap
              sx={{
                textOverflow: 'ellipsis',
                ml: 2,
                flex: 1,
              }}
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
              <PickerSearchField value={filter} onChange={handleFilterChange} />
            </Toolbar>
          </Collapse>
        </AppBar>
        <DialogContent dividers sx={{ p: 0 }}>
          {!items?.length ? (
            <EmptyResults sx={{ minHeight: '40vh', height: 1 }} />
          ) : (
            <AccordionListComponent
              // `defaultExpanded` is read once per mount, so the results
              // group would arrive collapsed without a fresh mount when the
              // list flips between grouped and flat. Keyed on the SHAPE,
              // not the filter text, so typing does not remount per press.
              key={filter ? 'results' : 'categories'}
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
                        {item?.items?.map(
                          (
                            node: (typeof allItems)[number]['items'][number],
                            index: number,
                          ) => (
                            <Observer key={node?.$id ?? index}>
                              {() => (
                                <Grid
                                  size={{
                                    xs: 4,
                                    sm: 3,
                                  }}
                                >
                                  <NodeCard
                                    sx={[
                                      { cursor: 'pointer' },
                                      selected?.$id === node?.$id
                                        ? { borderColor: 'primary.main' }
                                        : null,
                                    ]}
                                    node={node as any}
                                    onClick={(e) => handleItemClick(e, node)}
                                  />
                                </Grid>
                              )}
                            </Observer>
                          ),
                        )}
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
              sx={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              {/* Was the element's NAME and nothing else — the one thing the
                  card you just clicked already told you. Capped and
                  scrollable so a heavily-restricted element cannot push
                  Confirm off the dialog. */}
              <Box
                sx={{ flex: 1, minWidth: 0, maxHeight: 168, overflowY: 'auto' }}
              >
                <ElementDetailView detail={describeElement(selected)} />
              </Box>
              <Button onClick={handleConfirm} sx={{ flex: '0 0 auto' }}>
                {'Confirm'}
              </Button>
            </Stack>
          </Collapse>
        </Box>
      </Dialog>
    )
  }),
)
ComponentPicker.displayName = 'ComponentPicker'

export default ComponentPicker
