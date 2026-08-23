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

import { ButtonBase, styled, Tooltip, Typography } from '@mui/material'
import {
  type ComponentProps,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import type { SpacingScaleOption } from '../../utils/theme-scale-options'
import {
  isThemeSpacingStep,
  spacingDescription,
  spacingDisplayText,
} from '../spacing-value'
import type { Measurements } from '../types'

export type { Measurements }

/**
 * The box model, drawn the way browser devtools draws it (AGL-2486).
 *
 * The first version of this was louder than the thing it replaced:
 * saturated fills, diagonal gradient wedges, corner slashes where clipped
 * trapezoids met, a hatched border band and four coloured tag chips, with a
 * swatch legend underneath to explain the result. Zach's verdict was that it
 * "got messed up", and he was right — legibility went backwards while
 * decoration went forwards, which is the opposite of what "polish the
 * styling" asked for.
 *
 * Devtools has never confused anyone and it uses four quiet fills and
 * nothing else. So: flat nested rectangles, muted colour, no gradients, no
 * clip paths, no hatching, no legend. The most salient things in the
 * control are the four numbers and the four region names, because those are
 * what an author came to read.
 *
 * The layout is a 3x3 grid per region rather than absolutely-positioned
 * trapezoids — top spans the width, then left / inner / right, then bottom.
 * That is what removes the corner slashes: there are no clipped shapes left
 * to leave gaps between them.
 */

const StyledWrapper = styled('div')(({ theme }) => {
  // In CSS vars mode theme.palette.* always returns static light values;
  // use (theme.vars || theme) so palette refs become live CSS custom-property
  // references that switch when the .dark class toggles on <html>.
  const tv = (theme as any).vars || theme

  /** One nested region: a quiet fill, a hairline edge, room for a label. */
  const region = (channel: string) => ({
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    gridTemplateRows: 'auto minmax(0, 1fr) auto',
    position: 'relative' as const,
    borderRadius: 3,
    border: `1px solid rgba(${channel} / 0.40)`,
    backgroundColor: `rgba(${channel} / 0.13)`,
    paddingTop: 13,
  })

  return {
    ...region(tv.palette.warning.mainChannel),
    width: '100%',
    fontSize: theme.typography.pxToRem(11),
    color: tv.palette.text.primary,

    '.borderRing': {
      ...region(tv.palette.info.mainChannel),
      gridColumn: 2,
      gridRow: 2,
      // The band is the whole ring: border width is not edited here, so it
      // needs thickness enough to carry its name and nothing more.
      padding: '13px 7px 7px',
    },

    '.paddingContainer': {
      ...region(tv.palette.success.mainChannel),
      gridColumn: '1 / -1',
      minHeight: 76,
    },

    '.contents': {
      gridColumn: 2,
      gridRow: 2,
      minHeight: 30,
      margin: 3,
      borderRadius: 3,
      border: `1px solid rgba(${tv.palette.text.primaryChannel} / 0.20)`,
      backgroundColor: tv.palette.background.paper,
      color: tv.palette.text.secondary,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: theme.typography.pxToRem(10),
    },

    // Every side is a plain, transparent hit area. The region behind it
    // supplies the colour — a button with a fill of its own would put a
    // fifth and sixth tone into a figure that has four things to say.
    '.side': {
      background: 'none',
      borderRadius: 2,
      padding: '1px 5px',
      minWidth: 26,
      color: 'inherit',
      '&:hover': {
        backgroundColor: `rgba(${tv.palette.text.primaryChannel} / 0.08)`,
      },
    },
    '.sideTop': { gridColumn: '1 / -1', gridRow: 1, justifySelf: 'center' },
    '.sideBottom': { gridColumn: '1 / -1', gridRow: 3, justifySelf: 'center' },
    '.sideLeft': { gridColumn: 1, gridRow: 2, alignSelf: 'center' },
    '.sideRight': { gridColumn: 3, gridRow: 2, alignSelf: 'center' },

    // A set value is the most salient thing in the control; an unset side
    // names itself quietly, so it reads as a label rather than a number.
    '.sideValue': {
      fontSize: theme.typography.pxToRem(11),
      fontWeight: 600,
      lineHeight: 1.25,
    },
    '.sideEmpty': {
      fontSize: theme.typography.pxToRem(10),
      fontWeight: 400,
      lineHeight: 1.25,
      color: tv.palette.text.secondary,
    },

    /**
     * Selection, re-checked now that the fills are calm.
     *
     * It was a 2px outline, which in a figure made of nested borders read
     * as one more border. It is a solid primary fill — the only saturated
     * colour anywhere in the control now, which is exactly why it reads.
     */
    '.isSelected': {
      backgroundColor: tv.palette.primary.main,
      color: tv.palette.primary.contrastText,
      '&:hover': { backgroundColor: tv.palette.primary.dark },
      '& .sideEmpty': { color: 'inherit' },
    },

    // A value that follows the theme carries a dot: the number alone
    // cannot say so, since `16px` and the step that resolves to 16px look
    // identical and behave differently when the theme changes.
    '.themeStep .sideValue::after': {
      content: '""',
      display: 'block',
      width: 3,
      height: 3,
      borderRadius: '50%',
      margin: '1px auto 0',
      backgroundColor: 'currentColor',
      opacity: 0.55,
    },

    /**
     * The region's name, ON the region it names.
     *
     * That placement was the real bug in the previous round — `BORDER` sat
     * outside the ring it labelled, overlapping the margin controls, so it
     * read as though the border were outside the margin. The placement
     * stays; the coloured tag chip it used to sit in does not, because four
     * chips competing with four numbers is what made this hard to read.
     */
    '.label': {
      position: 'absolute',
      top: 2,
      left: 5,
      pointerEvents: 'none',
      fontSize: theme.typography.pxToRem(9),
      lineHeight: 1.2,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      fontWeight: 700,
      color: tv.palette.text.secondary,
    },
    // The one label that is a hover target: it carries the border tooltip.
    '.label.border': { pointerEvents: 'auto', cursor: 'help' },
  }
})

/**
 * What each side is called, in the words an author would use.
 *
 * The abbreviations these replace (`mt`, `ml`, `mr`, `mb`) were the panel's
 * plainest example of developer shorthand leaking into a customer-facing
 * control: they are the MUI prop names, and they mean nothing at all to
 * someone who has never written `sx`.
 */
export const SIDE_LABELS: Record<keyof Measurements, string> = {
  marginTop: 'Space outside — top',
  marginRight: 'Space outside — right',
  marginBottom: 'Space outside — bottom',
  marginLeft: 'Space outside — left',
  paddingTop: 'Space inside — top',
  paddingRight: 'Space inside — right',
  paddingBottom: 'Space inside — bottom',
  paddingLeft: 'Space inside — left',
}

/** The one-word name a side shows while it has no value of its own. */
export const SIDE_SHORT: Record<keyof Measurements, string> = {
  marginTop: 'Top',
  marginRight: 'Right',
  marginBottom: 'Bottom',
  marginLeft: 'Left',
  paddingTop: 'Top',
  paddingRight: 'Right',
  paddingBottom: 'Bottom',
  paddingLeft: 'Left',
}

/** Which grid cell a side occupies within its own region. */
const SIDE_SLOT: Record<keyof Measurements, string> = {
  marginTop: 'sideTop',
  marginRight: 'sideRight',
  marginBottom: 'sideBottom',
  marginLeft: 'sideLeft',
  paddingTop: 'sideTop',
  paddingRight: 'sideRight',
  paddingBottom: 'sideBottom',
  paddingLeft: 'sideLeft',
}

export interface BoxDiagramProps
  extends Omit<ComponentProps<typeof StyledWrapper>, 'onChange' | 'onSelect'> {
  measurements?: Measurements
  /** The theme's spacing ladder, so a step can be shown resolved. */
  steps?: readonly SpacingScaleOption[]
  /** The element's border shorthand, drawn for context only. */
  border?: string
  /** Which side's editor is open, so the diagram can mark it. */
  editing?: keyof Measurements
  onSelect?: (key: keyof Measurements) => void
}

/**
 * Where each side's tooltip opens — OUTWARD, away from the middle of the
 * figure. One placement for all eight cannot work in nested boxes: whichever
 * direction a tooltip opens it lands on a neighbouring target unless the
 * direction is chosen per side.
 */
const TOOLTIP_PLACEMENT: Record<
  keyof Measurements,
  'top' | 'bottom' | 'left' | 'right'
> = {
  marginTop: 'top',
  marginRight: 'right',
  marginBottom: 'bottom',
  marginLeft: 'left',
  paddingTop: 'top',
  paddingRight: 'right',
  paddingBottom: 'bottom',
  paddingLeft: 'left',
}

/** Anything in the diagram a tooltip can describe. */
type HoverTarget = keyof Measurements | 'border'

/**
 * How long the pointer must rest on a region before its tooltip opens.
 *
 * MUI's own `enterDelay` is ignored once `open` is controlled, and the
 * tooltips here HAVE to be controlled for only-one-at-a-time. So the delay
 * moves to the state that drives them. Without it, dragging the pointer
 * across a figure this dense fires a tooltip per region crossed.
 */
const HOVER_DELAY_MS = 400

export const BoxDiagram = forwardRef<any, BoxDiagramProps>((props, ref) => {
  const { measurements, steps, border, editing, onSelect, ...rest } = props
  const ladder = steps ?? []

  /**
   * Exactly ONE tooltip is open, because ONE piece of state says which.
   *
   * Independently-controlled tooltips could and did stack up: the regions
   * are adjacent, so a pointer crossing the figure enters several hit areas
   * in quick succession and each tooltip decided its own visibility. An
   * enter delay alone would have hidden that without fixing it.
   */
  const [hovered, setHovered] = useState<HoverTarget | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  // A pending open must not fire after the diagram has gone.
  useEffect(() => clearTimer, [])

  const hoverOn = useCallback((target: HoverTarget) => {
    clearTimer()
    timer.current = setTimeout(() => setHovered(target), HOVER_DELAY_MS)
  }, [])

  const hoverOff = useCallback((target: HoverTarget) => {
    clearTimer()
    setHovered((prev) => (prev === target ? null : prev))
  }, [])

  const sideButton = (key: keyof Measurements) => {
    const value = measurements?.[key]
    const text = spacingDisplayText(value, ladder)
    const isStep = isThemeSpacingStep(value)
    const selected = editing === key
    return (
      <Tooltip
        open={hovered === key}
        placement={TOOLTIP_PLACEMENT[key]}
        // The tooltip must never be a click target: it used to open over
        // the button that summoned it and swallow the click.
        disableInteractive
        slotProps={{ popper: { sx: { pointerEvents: 'none' } } }}
        title={`${SIDE_LABELS[key]} · ${spacingDescription(value, ladder)}`}
      >
        <ButtonBase
          className={[
            'side',
            SIDE_SLOT[key],
            isStep ? 'themeStep' : '',
            selected ? 'isSelected' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => {
            clearTimer()
            setHovered(null)
            onSelect?.(key)
          }}
          onMouseEnter={() => hoverOn(key)}
          onMouseLeave={() => hoverOff(key)}
          onFocus={() => hoverOn(key)}
          onBlur={() => hoverOff(key)}
          onMouseDown={clearTimer}
          aria-label={SIDE_LABELS[key]}
          aria-pressed={selected}
        >
          {/* `text` is '' only when nothing is set — a `0` step resolves
              to '0px' and shows as a value, never as the empty state. */}
          <Typography
            component="span"
            className={text === '' ? 'sideEmpty' : 'sideValue'}
          >
            {text === '' ? SIDE_SHORT[key] : text}
          </Typography>
        </ButtonBase>
      </Tooltip>
    )
  }

  return (
    <StyledWrapper ref={ref} {...rest}>
      <div className="label margin">{'Margin'}</div>
      {sideButton('marginTop')}
      {sideButton('marginLeft')}

      <div className="borderRing">
        {/* The border tooltip hangs off the LABEL, not off the ring.
            Wrapping the ring wrapped every padding button inside it, so
            hovering padding opened the border tooltip too. */}
        <Tooltip
          open={hovered === 'border'}
          placement="left"
          disableInteractive
          slotProps={{ popper: { sx: { pointerEvents: 'none' } } }}
          title={`Border: ${border || 'none'} — edit it under Borders & Shadows`}
        >
          <div
            className="label border"
            aria-label={`Border: ${border || 'none'}`}
            onMouseEnter={() => hoverOn('border')}
            onMouseLeave={() => hoverOff('border')}
          >
            {'Border'}
          </div>
        </Tooltip>

        <div className="paddingContainer">
          <div className="label padding">{'Padding'}</div>
          {sideButton('paddingTop')}
          {sideButton('paddingLeft')}
          <div className="contents">{'Content'}</div>
          {sideButton('paddingRight')}
          {sideButton('paddingBottom')}
        </div>
      </div>

      {sideButton('marginRight')}
      {sideButton('marginBottom')}
    </StyledWrapper>
  )
})
BoxDiagram.displayName = 'BoxDiagram'

export default BoxDiagram
