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

import { mdiCheckCircle } from '@aglyn/shared-data-mdi'
import { Box, Card, CardActionArea, Chip, Stack, Typography, type ChipProps } from '@mui/material'
import { alpha, type Theme } from '@mui/material/styles'
import { useRef, type KeyboardEvent } from 'react'
import { MdiIcon } from './mdi-icon/mdi-icon'

/**
 * A picture across the top of an {@link OptionCard} (AGL-3898): a real
 * example of the choice, at a fixed size so the grid does not shift while it
 * loads, and loaded lazily, since a grid of them is mostly below the fold.
 */
export interface OptionCardImage {
  src: string
  /** What the picture shows, for a reader who cannot see it. */
  alt: string
  width: number
  height: number
}

/**
 * A short fact about a choice, drawn as a small chip under its line: a price,
 * who made it, how many pages it has. Theme colors only; the label is read
 * with the card's name, so a chip is never the only place a fact is said.
 */
export interface OptionCardChip {
  label: string
  /** A theme palette color; `default` when absent. */
  color?: ChipProps['color']
  /** `outlined` when absent. */
  variant?: 'filled' | 'outlined'
}

/** One choice in an {@link OptionCardGrid}. */
export interface OptionCard<T extends string = string> {
  id: T
  title: string
  description?: string
  /** An SVG path, such as an MDI icon's. */
  icon?: string
  /** A picture of the choice, drawn above its title. */
  image?: OptionCardImage
  /** Facts drawn as chips under its line, in this order. */
  chips?: readonly OptionCardChip[]
}

/**
 * What a card is called for assistive technology: its title, its line after a
 * colon, and its chips in parentheses — every word the card shows, since the
 * card is one control and its name is all a screen reader says of it.
 */
export function optionCardLabel(option: Pick<OptionCard, 'title' | 'description' | 'chips'>): string {
  const named = option.description ? `${option.title}: ${option.description}` : option.title
  const chips = (option.chips ?? []).map((chip) => chip.label).filter(Boolean)
  return chips.length ? `${named} (${chips.join(', ')})` : named
}

export interface OptionCardGridProps<T extends string = string> {
  /** What the group is, for assistive technology. */
  label: string
  options: readonly OptionCard<T>[]
  /** The selected option, or `null` for none. */
  value: T | null
  onChange: (value: T) => void
  /** Columns at each breakpoint. */
  columns?: { xs?: number; sm?: number; md?: number }
  /** `data-*` attributes for the grid's root, such as a page's own marker for where clicks land. */
  [data: `data-${string}`]: string | undefined
}

/**
 * How an option card sits on the page around it (AGL-3985). A grid of them is
 * often drawn on a dialog's gray, where a transparent card with a divider
 * outline melted into the page, so each card is:
 *
 *  - a surface of its own, `background.paper`;
 *  - outlined as strongly as an outlined field (the text color at 23%, the
 *    border MUI's OutlinedInput draws), the text color on hover;
 *  - once picked, outlined 2px in the primary color, from a 1px ring laid
 *    outside its 1px border so the grid never shifts, with a check in a disc
 *    at its top corner ({@link OptionCardCheck});
 *  - ringed in the primary color while it has the keyboard's focus.
 *
 * Theme values only, so it reads the same in light and dark mode.
 */
export function optionCardSx(selected: boolean) {
  return (theme: Theme) => ({
    position: 'relative' as const,
    borderRadius: 2,
    bgcolor: 'background.paper',
    borderColor: selected ? theme.palette.primary.main : alpha(theme.palette.text.primary, 0.23),
    boxShadow: selected ? `0 0 0 1px ${theme.palette.primary.main}` : 'none',
    transition: theme.transitions.create(['border-color', 'box-shadow']),
    '&:hover': { borderColor: selected ? theme.palette.primary.main : theme.palette.text.primary },
    '&:has(.Mui-focusVisible)': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: '2px',
    },
  })
}

/** The check a picked card carries in its top corner: over its picture, or beside its words. */
export function OptionCardCheck() {
  return (
    <Box
      aria-hidden
      data-option-card-check=""
      sx={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 1,
        display: 'flex',
        borderRadius: '50%',
        bgcolor: 'background.paper',
        color: 'primary.main',
        boxShadow: 2,
        pointerEvents: 'none',
      }}
    >
      <MdiIcon path={mdiCheckCircle.path} sx={{ fontSize: 24 }} />
    </Box>
  )
}

/**
 * A grid of cards to pick one from (AGL-3660): a radio group drawn as cards,
 * each with an icon or a picture (AGL-3898), a title, a line under it and any
 * facts as chips under that (AGL-4049), which its accessible name reads too. Each
 * card is a surface with an outline that reads on a gray page, its title in
 * the text color and its line in the secondary text color, both at AA on the
 * card (AGL-3985). The picked card is outlined 2px in the primary color and
 * carries a check; the arrow keys move between cards and pick, as a radio
 * group's do, only the picked card is in the tab order, and the focused card
 * is ringed.
 */
export function OptionCardGrid<T extends string = string>({
  label,
  options,
  value,
  onChange,
  columns = { xs: 1, sm: 2, md: 3 },
  ...rest
}: OptionCardGridProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = options.findIndex((option) => option.id === value)
  const focusable = selectedIndex === -1 ? 0 : selectedIndex

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (!step) return
    event.preventDefault()
    const next = (index + step + options.length) % options.length
    refs.current[next]?.focus()
    onChange(options[next].id)
  }

  const template = (count?: number) => (count ? `repeat(${count}, minmax(0, 1fr))` : undefined)
  return (
    <Box
      role="radiogroup"
      aria-label={label}
      {...rest}
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: {
          xs: template(columns.xs ?? 1),
          sm: template(columns.sm),
          md: template(columns.md),
        },
      }}
    >
      {options.map((option, index) => {
        const selected = option.id === value
        return (
          <Card key={option.id} variant="outlined" sx={optionCardSx(selected)}>
            {selected && <OptionCardCheck />}
            <CardActionArea
              ref={(node: HTMLButtonElement | null) => {
                refs.current[index] = node
              }}
              role="radio"
              aria-checked={selected}
              aria-label={optionCardLabel(option)}
              tabIndex={index === focusable ? 0 : -1}
              onClick={() => onChange(option.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              sx={{
                p: option.image ? 0 : 2,
                // Room for the check beside a card's words, where no picture carries it.
                pr: option.image ? 0 : 5,
                height: '100%',
                minHeight: 44,
                display: 'flex',
                flexDirection: option.image ? 'column' : 'row',
                alignItems: option.image ? 'stretch' : 'flex-start',
                justifyContent: 'flex-start',
              }}
            >
              {option.image && (
                <Box
                  component="img"
                  src={option.image.src}
                  alt={option.image.alt}
                  width={option.image.width}
                  height={option.image.height}
                  loading="lazy"
                  decoding="async"
                  sx={{
                    display: 'block',
                    width: '100%',
                    height: 'auto',
                    aspectRatio: `${option.image.width} / ${option.image.height}`,
                    objectFit: 'cover',
                    objectPosition: 'top',
                    borderBottom: 1,
                    borderColor: 'divider',
                    bgcolor: 'action.hover',
                  }}
                />
              )}
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'flex-start', width: '100%', px: option.image ? 2 : 0, py: option.image ? 1.5 : 0 }}
              >
                {option.icon && (
                  <Box sx={{ color: selected ? 'primary.main' : 'text.secondary', display: 'flex', pt: 0.25 }} aria-hidden>
                    <MdiIcon path={option.icon} sx={{ fontSize: 22 }} />
                  </Box>
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    variant="subtitle2"
                    component="span"
                    sx={{ display: 'block', color: 'text.primary', fontWeight: 600, lineHeight: 1.4 }}
                  >
                    {option.title}
                  </Typography>
                  {option.description && (
                    <Typography variant="body2" component="span" sx={{ display: 'block', color: 'text.secondary', mt: 0.25 }}>
                      {option.description}
                    </Typography>
                  )}
                  {option.chips && option.chips.length > 0 && (
                    <Stack
                      component="span"
                      direction="row"
                      useFlexGap
                      aria-hidden
                      data-option-card-chips=""
                      sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }}
                    >
                      {option.chips.map((chip, chipIndex) => (
                        <Chip
                          key={`${chipIndex}-${chip.label}`}
                          component="span"
                          size="small"
                          label={chip.label}
                          color={chip.color ?? 'default'}
                          variant={chip.variant ?? 'outlined'}
                        />
                      ))}
                    </Stack>
                  )}
                </Box>
              </Stack>
            </CardActionArea>
          </Card>
        )
      })}
    </Box>
  )
}

export default OptionCardGrid
