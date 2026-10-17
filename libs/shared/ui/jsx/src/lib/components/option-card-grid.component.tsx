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
import { Box, Card, CardActionArea, Stack, Typography } from '@mui/material'
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

/** One choice in an {@link OptionCardGrid}. */
export interface OptionCard<T extends string = string> {
  id: T
  title: string
  description?: string
  /** An SVG path, such as an MDI icon's. */
  icon?: string
  /** A picture of the choice, drawn above its title. */
  image?: OptionCardImage
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
 * A grid of cards to pick one from (AGL-3660): a radio group drawn as cards,
 * each with an icon or a picture (AGL-3898), a title and a line under it. The
 * selected card carries the primary color, and a picture card a check over
 * its picture; the arrow keys move between cards and pick, as a radio group's
 * do, and only the picked card is in the tab order.
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
        gap: 1.5,
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
          <Card
            key={option.id}
            variant="outlined"
            sx={(theme: Theme) => ({
              borderRadius: 2,
              borderColor: selected ? 'primary.main' : 'divider',
              bgcolor: selected ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
            })}
          >
            <CardActionArea
              ref={(node: HTMLButtonElement | null) => {
                refs.current[index] = node
              }}
              role="radio"
              aria-checked={selected}
              aria-label={option.description ? `${option.title}: ${option.description}` : option.title}
              tabIndex={index === focusable ? 0 : -1}
              onClick={() => onChange(option.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              sx={{
                p: option.image ? 0 : 2,
                height: '100%',
                minHeight: 44,
                display: 'flex',
                flexDirection: option.image ? 'column' : 'row',
                alignItems: option.image ? 'stretch' : 'flex-start',
                justifyContent: 'flex-start',
              }}
            >
              {option.image && (
                <Box sx={{ position: 'relative', width: '100%' }}>
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
                  {selected && (
                    <Box
                      aria-hidden
                      sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        display: 'flex',
                        borderRadius: '50%',
                        bgcolor: 'background.paper',
                        color: 'primary.main',
                        boxShadow: 2,
                      }}
                    >
                      <MdiIcon path={mdiCheckCircle.path} sx={{ fontSize: 24 }} />
                    </Box>
                  )}
                </Box>
              )}
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', width: '100%', p: option.image ? 1.5 : 0 }}>
                {option.icon && (
                  <Box sx={{ color: selected ? 'primary.main' : 'text.secondary', display: 'flex', pt: 0.25 }} aria-hidden>
                    <MdiIcon path={option.icon} sx={{ fontSize: 22 }} />
                  </Box>
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" component="span" sx={{ display: 'block' }}>
                    {option.title}
                  </Typography>
                  {option.description && (
                    <Typography variant="body2" color="text.secondary" component="span" sx={{ display: 'block' }}>
                      {option.description}
                    </Typography>
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
