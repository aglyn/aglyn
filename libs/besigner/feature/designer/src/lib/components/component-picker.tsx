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
  IconButton,
  Slide,
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

/**
 * How the two panes share the dialog above the stacking breakpoint
 * (AGL-2486).
 *
 * An even split, because the preview is sized by the pane and nothing else:
 * `ElementPreview` composes at a fixed 1280px stage and scales by
 * `paneWidth / 1280`, so the pane's width IS the preview's size. A 420px
 * pane rendered at 0.30; half of a 1536px dialog renders at 0.57, which is
 * the "make the preview bigger" ask answered by arithmetic rather than by a
 * bigger `previewHeight` cap on the same small stage.
 *
 * The grid does not pay for it. At an even split the tiles keep their full
 * `MIN_TILE_WIDTH` — a 1944px screen runs four 166px tiles where the fixed
 * pane ran six 161px ones. Fewer columns, no narrower tiles.
 */
const PANE_SPLIT = '1 1 50%'

/**
 * Narrowest a tile may be before its label stops fitting, in px (AGL-2486).
 *
 * The grid used to size its tiles off the VIEWPORT breakpoint (`sm` → 3/12 →
 * four columns) which is the wrong question to ask: the tiles live in a pane
 * whose width is the dialog minus the detail pane, and a viewport breakpoint
 * cannot see the pane. So the detail pane came out of the tiles — four
 * columns in 448px, 94px each, with `Announcement Bar` painting outside its
 * own card. `auto-fill` asks the pane instead, so the two panes stop trading:
 * widening the dialog adds columns, and the detail pane costs columns rather
 * than shrinking every tile.
 *
 * 150px is measured, not chosen: the widest single word in the catalogue
 * (`Announcement`) needs ~100px at `subtitle2`, and the tiles that survive
 * on one line at 150 are the ones that wrapped at 94.
 */
const MIN_TILE_WIDTH = 150

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
        // Picking one of ~110 elements is a browsing task, not a confirm box
        // (AGL-2486). At `md` the paper was 900px on a 1944px screen and the
        // detail pane took 420 of it, leaving the grid narrower than the
        // whole dialog had been before the pane existed.
        //
        // `fullWidth` rather than the `width: '100%'` this carried before:
        // `100%` ignores the paper's own 32px margins, so the paper overflows
        // the viewport at any width below its cap. That was invisible while
        // the cap was 900 and would be a horizontal scrollbar on every laptop
        // at this one.
        maxWidth="xl"
        fullWidth
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
        {/* Grid left, detail right (AGL-2486). The detail used to be a strip
            under the grid, which gave a preview and five facts about a
            quarter of the height they need while the modal's width sat
            unused. A full-height pane is also the first place the rendered
            preview has room to be worth drawing. */}
        <DialogContent
          dividers
          sx={{
            p: 0,
            display: 'flex',
            // `md` is where an even split stops paying for itself, and the
            // number is derived rather than picked: at a 900px viewport the
            // paper is 836px, so each pane is 418. That is the LAST width at
            // which the grid still runs two full-width tiles (2×150 + a 24
            // gap + 32 of padding = 356) and the preview still composes at
            // the 0.30 scale it had in the old fixed 420px pane. Below it,
            // sharing a row makes both panes worse than stacking, where each
            // gets the dialog's whole width — so the preview gets BIGGER on
            // a tablet, not smaller.
            //
            // Stacking also keeps Confirm reachable. The pane used to be
            // `display: none` under `sm` and Confirm lives inside it, so the
            // dialog could be browsed and never used on a phone.
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: 'stretch',
            minHeight: '60vh',
          }}
        >
          <Box
            sx={{
              flex: { xs: '1 1 auto', md: PANE_SPLIT },
              // Without this the tiles' intrinsic width becomes the pane's
              // floor and the split silently stops being even.
              minWidth: 0,
              // Stacked, the panes scroll together as one column; side by
              // side, the grid scrolls under a detail pane that stays put.
              overflowY: { xs: 'visible', md: 'auto' },
            }}
          >
            {!items?.length ? (
              <EmptyResults sx={{ minHeight: '40vh', height: 1 }} />
            ) : (
              <AccordionListComponent
                // No `key` remount to force the results group open
                // (AGL-2486) — see the Elements panel for why that could not
                // work. The list opens a group when it first appears.
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
                        {/* A CSS grid, not a 12-column one: the column count
                            has to come from the pane's own width. See
                            MIN_TILE_WIDTH. `1fr` as the max so the last
                            column is not a ragged remainder. */}
                        <Box
                          data-testid="picker-element-grid"
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_TILE_WIDTH}px, 1fr))`,
                            gap: 3,
                            minWidth: 0,
                          }}
                        >
                          {item?.items?.map(
                            (
                              node: (typeof allItems)[number]['items'][number],
                              index: number,
                            ) => (
                              <Observer key={node?.$id ?? index}>
                                {() => (
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
                                )}
                              </Observer>
                            ),
                          )}
                        </Box>
                      </Box>
                    )}
                  </Observer>
                )}
              />
            )}
          </Box>
          <Box
            sx={{
              flex: { xs: '0 0 auto', md: PANE_SPLIT },
              width: { xs: 1, md: 'auto' },
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              // Stacked, the divider that separates the panes is above it,
              // not beside it.
              borderLeft: { xs: 0, md: 1 },
              borderTop: { xs: 1, md: 0 },
              borderColor: 'divider',
              backgroundColor: 'surface.main',
            }}
          >
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2 }}>
              {selected ? (
                /* The same content component the panel floats over the
                   canvas — one description of an element, two placements. */
                <ElementDetailView
                  detail={describeElement(selected)}
                  node={selected}
                  previewHeight={380}
                />
              ) : (
                <Typography variant="caption" color="textSecondary">
                  {'Choose an element to see what it does.'}
                </Typography>
              )}
            </Box>
            {/* Anchored to the pane rather than the dialog: Confirm belongs
                with the thing being confirmed. */}
            <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
              <Button
                fullWidth
                variant="contained"
                disabled={!selected}
                onClick={handleConfirm}
              >
                {'Confirm'}
              </Button>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    )
  }),
)
ComponentPicker.displayName = 'ComponentPicker'

export default ComponentPicker
