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

import { alpha, darken } from '@aglyn/shared-ui-theme'
import { ButtonBase, lighten, styled, Tooltip, Typography } from '@mui/material'
import { emphasize } from '@mui/system/colorManipulator'
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

const GAP = 2
const BTN_SIZE = 20
const HEIGHT = 216
/**
 * Thickness of the border band, in px.
 *
 * It is 18 rather than the 7 it started at because the band has to carry
 * its own LABEL. Parking `BORDER` outside the ring — where it first went —
 * put the word below and to the right of the margin controls, which reads
 * as "the border is outside the margin": the exact opposite of the box
 * model the diagram exists to teach. A label belongs on the region it
 * names, so the region has to be tall enough to hold one.
 */
const RING = 18

export type PolyType = {
  topLX: string
  topLY: string
  topRX: string
  topRY: string
  btmRX: string
  btmRY: string
  btmLX: string
  btmLY: string
}

const polygon = (options: PolyType) => {
  const topL = `${options.topLX || '0%'} ${options.topLY || '0%'}`
  const topR = `${options.topRX || '0%'} ${options.topRY || '0%'}`
  const btmR = `${options.btmRX || '0%'} ${options.btmRY || '0%'}`
  const btmL = `${options.btmLX || '0%'} ${options.btmLY || '0%'}`
  return `polygon(${topL}, ${topR}, ${btmR}, ${btmL})`
}

const StyledWrapper = styled('div')(({ theme }) => {
  // In CSS vars mode theme.palette.* always returns static light values;
  // use (theme.vars || theme) so palette refs become live CSS custom-property
  // references that switch when the .dark class toggles on <html>.
  const tv = (theme as any).vars || theme
  return {
    width: '100%',
    height: HEIGHT,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    textAlign: 'center',
    overflow: 'hidden',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderRadius: theme.shape.borderRadius,
    borderColor: tv.palette.warning.dark,
    padding: 1,
    // The four regions read as one nested figure rather than four
    // unrelated shapes, so the ground behind the margin band is the
    // canvas colour rather than pure black (AGL-2486).
    backgroundColor: tv.palette.background.paper,

    '.marginButton': {
      overflow: 'hidden',
      textAlign: 'center',
      cursor: 'pointer',
      backfaceVisibility: 'hidden',
      color: theme.palette.getContrastText(
        alpha(theme.palette.surface.main, 0.96),
      ),
      transition: theme.transitions.create(['filter'], { duration: 120 }),
      background: [
        'linear-gradient(',
        '260deg, ',
        `${darken(theme.palette.warning.light, 0.06)}, `,
        `${lighten(theme.palette.warning.light, 0.34)}`,
        ') content-box',
      ].join(''),

      '&:hover': { filter: 'brightness(1.06)' },

      '&.marginTop': {
        width: `calc(100% - ${GAP * 2}px)`,
        marginLeft: GAP,
        marginRight: GAP,
        height: `calc(${BTN_SIZE}% - ${GAP}px)`,
        borderBottomWidth: 0,
        clipPath: polygon({
          topLX: '0%',
          topLY: '0%',
          topRX: '100%',
          topRY: '0%',
          btmRX: `${100 - BTN_SIZE}%`,
          btmRY: '100%',
          btmLX: `${BTN_SIZE}%`,
          btmLY: '100%',
        }),
      },

      '&.marginBottom': {
        width: `calc(100% - ${GAP}px)`,
        marginLeft: GAP,
        borderTopWidth: 0,
        height: `${BTN_SIZE}%`,
        clipPath: polygon({
          topLX: `${BTN_SIZE}%`,
          topLY: `0%`,
          topRX: `${100 - BTN_SIZE}%`,
          topRY: '0%',
          btmRX: `100%`,
          btmRY: '100%',
          btmLX: `0%`,
          btmLY: `100%`,
        }),
      },

      '&.marginLeft': {
        left: 1,
        top: 0,
        position: 'absolute',
        borderRightWidth: 0,
        height: `calc(100% - ${GAP}px)`,
        width: `${BTN_SIZE}%`,
        clipPath: polygon({
          topLX: `0%`,
          topLY: `0%`,
          topRX: `100%`,
          topRY: `${BTN_SIZE}%`,
          btmRX: `100%`,
          btmRY: `${100 - BTN_SIZE}%`,
          btmLX: `0%`,
          btmLY: `100%`,
        }),
      },

      '&.marginRight': {
        right: 1,
        borderLeftWidth: 0,
        height: `calc(100% - ${GAP * 2}px)`,
        width: `${BTN_SIZE}%`,
        position: 'absolute',
        clipPath: polygon({
          topLX: '0%',
          topLY: `${BTN_SIZE}%`,
          topRX: '100%',
          topRY: '0%',
          btmRX: `100%`,
          btmRY: '100%',
          btmLX: `0%`,
          btmLY: `${100 - BTN_SIZE}%`,
        }),
      },
    },

    // The border band (AGL-2486). The CSS box model puts the border
    // BETWEEN margin and padding, and a diagram that skips it teaches an
    // author the wrong shape — the padding they set is inside the border,
    // not inside the margin. It is drawn, not edited: border width, style
    // and colour have one home already, in Borders & Shadows, and a second
    // editor here is exactly the duplication this issue exists to remove.
    '.borderRing': {
      width: `calc(${BTN_SIZE * 3.4}% - ${GAP * 2}px)`,
      height: `${BTN_SIZE * 3.4}%`,
      margin: `${GAP}px auto`,
      padding: RING,
      position: 'relative',
      boxSizing: 'border-box',
      borderStyle: 'solid',
      borderWidth: 1,
      borderColor: tv.palette.info.main,
      background: `repeating-linear-gradient(45deg, rgba(${tv.palette.info.mainChannel} / 0.30) 0 3px, rgba(${tv.palette.info.mainChannel} / 0.14) 3px 6px) border-box`,
    },

    '.paddingContainer': {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      textAlign: 'center',
      overflow: 'hidden',
      borderStyle: 'dashed',
      borderWidth: 1,
      borderColor: tv.palette.success.dark,
      boxSizing: 'border-box',
    },

    '.paddingButton': {
      overflow: 'hidden',
      backfaceVisibility: 'hidden',
      cursor: 'pointer',
      transition: theme.transitions.create(['filter'], { duration: 120 }),
      background: [
        'linear-gradient(',
        '65deg, ',
        `${lighten(theme.palette.secondary.main, 0.7)}, `,
        `${lighten(theme.palette.primary.main, 0.7)}`,
        ') content-box',
      ].join(''),
      color: theme.palette.getContrastText(
        lighten(theme.palette.secondary.main, 0.7),
      ),

      '&:hover': { filter: 'brightness(1.06)' },

      '&.paddingTop': {
        width: `calc(100% - ${GAP * 2}px)`,
        height: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
        marginLeft: GAP,
        clipPath: polygon({
          topLX: `0%`,
          topLY: `0%`,
          topRX: `100%`,
          topRY: `0%`,
          btmRX: `calc(${BTN_SIZE * 2}% + (${
            100 - BTN_SIZE
          }% * 0.3333334) - ${GAP}px)`,
          btmRY: `100%`,
          btmLX: `calc(${BTN_SIZE}% + (${
            BTN_SIZE * 2
          }% * 0.3333334) + ${GAP}px)`,
          btmLY: `100%`,
        }),
      },

      '&.paddingLeft': {
        position: 'absolute',
        top: 0,
        left: 1,
        height: `calc(100% - ${GAP * 2}px)`,
        width: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
        marginTop: GAP,
        marginBottom: GAP,
        clipPath: polygon({
          topLX: `0%`,
          topLY: `0%`,
          topRX: `100%`,
          topRY: `calc(${BTN_SIZE}% + (${
            BTN_SIZE * 2
          }% * 0.3333334) + ${GAP}px)`,
          btmRX: `100%`,
          btmRY: `calc(${BTN_SIZE * 2}% + (${
            100 - BTN_SIZE
          }% * 0.3333334) - ${GAP}px)`,
          btmLX: `0%`,
          btmLY: `100%`,
        }),
      },

      '&.paddingRight': {
        position: 'absolute',
        top: 0,
        right: 1,
        height: `calc(100% - ${GAP * 2}px)`,
        width: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
        marginTop: GAP,
        marginBottom: GAP,
        clipPath: polygon({
          topLX: `0%`,
          topLY: `calc(${BTN_SIZE}% + (${
            BTN_SIZE * 2
          }% * 0.3333334) + ${GAP}px)`,
          topRX: `100%`,
          topRY: `0%`,
          btmRX: `100%`,
          btmRY: `100%`,
          btmLX: `0%`,
          btmLY: `calc(${BTN_SIZE * 2}% + (${
            100 - BTN_SIZE
          }% * 0.3333334) - ${GAP}px)`,
        }),
      },

      '&.paddingBottom': {
        width: `calc(100% - ${GAP * 2}px)`,
        height: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
        marginLeft: GAP,
        marginRight: GAP,
        clipPath: polygon({
          topLX: `calc(${BTN_SIZE}% + (${
            BTN_SIZE * 2
          }% * 0.3333334) + ${GAP}px)`,
          topLY: `0%`,
          topRX: `calc(${BTN_SIZE * 2}% + (${
            100 - BTN_SIZE
          }% * 0.3333334) - ${GAP}px)`,
          topRY: `0%`,
          btmRX: `100%`,
          btmRY: `100%`,
          btmLX: `0%`,
          btmLY: `100%`,
        }),
      },
    },

    '.contents': {
      borderStyle: 'solid',
      borderWidth: 1,
      borderColor: tv.palette.text.secondary,
      color: tv.palette.text.primary,
      backgroundColor: tv.palette.background.default,
      width: `calc(${BTN_SIZE}% + (${
        BTN_SIZE * 2
      }% * 0.3333334) - ${GAP * 2}px)`,
      height: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334) - ${
        GAP * 2
      }px)`,
      margin: `${GAP}px auto`,
      position: 'relative',
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 11,
    },

    // The selected side (AGL-2486, Zach 2026-08-23). It was a 2px
    // outline, which in a control whose whole subject is borders read as
    // a border artefact rather than as selection — and in a figure of
    // nested boxes any new LINE is ambiguous by construction. So
    // selection is a FILL: the side takes the theme's primary colour and
    // its contrast text, which nothing else in the diagram uses.
    '.isSelected': {
      background: [
        'linear-gradient(',
        '65deg, ',
        `${darken(theme.palette.primary.main, 0.14)}, `,
        `${theme.palette.primary.main}`,
        ') content-box',
      ].join(''),
      color: theme.palette.primary.contrastText,
      fontWeight: 700,
      '&:hover': { filter: 'brightness(1.1)' },
      '&::before': {
        content: '""',
        position: 'absolute',
        inset: 0,
        boxShadow: `inset 0 0 0 99px rgba(${tv.palette.primary.mainChannel} / 0.001)`,
      },
    },

    // A side whose value follows the theme is marked, because the number
    // alone cannot say so — `16px` and the step that resolves to 16px look
    // identical and behave completely differently when the theme changes.
    '.themeStep .sideValue::after': {
      content: '""',
      display: 'block',
      width: 4,
      height: 4,
      borderRadius: '50%',
      margin: '1px auto 0',
      backgroundColor: tv.palette.primary.main,
    },
    '.isSelected.themeStep .sideValue::after': {
      backgroundColor: tv.palette.primary.contrastText,
    },

    '.sideValue': {
      fontSize: 11,
      fontWeight: 600,
      lineHeight: 1.1,
    },
    '.sideEmpty': {
      fontSize: 10,
      opacity: 0.62,
      fontWeight: 400,
      lineHeight: 1.1,
    },

    '.label': {
      width: 'auto',
      position: 'absolute',
      textAlign: 'left',
      pointerEvents: 'none',
      left: 1,
      top: 1,
      zIndex: 1,
      paddingLeft: theme.spacing(0.5),
      paddingRight: theme.spacing(0.5),
      borderBottomRightRadius: theme.shape.borderRadius,
      color: theme.palette.getContrastText(
        alpha(theme.palette.surface.main, 0.76),
      ),
      backgroundColor: `rgba(${tv.palette.surface.darkChannel} / 0.12)`,
      fontSize: theme.typography.pxToRem(10),
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      fontWeight: 600,

      '&.margin': {
        border: `1px solid ${tv.palette.warning.dark}`,
        backgroundColor: lighten(theme.palette.warning.dark, 0.48),
        color: theme.palette.getContrastText(
          emphasize(theme.palette.warning.dark, 0.48),
        ),
      },
      // On the band it names, same corner as Margin and Padding, so the
      // three labels step inwards exactly as the regions do.
      '&.border': {
        // The one label that IS a hover target — it carries the border
        // tooltip, now that the ring no longer wraps the padding buttons.
        pointerEvents: 'auto',
        cursor: 'help',
        fontSize: theme.typography.pxToRem(8),
        lineHeight: 1.4,
        border: `1px solid ${tv.palette.info.main}`,
        backgroundColor: lighten(theme.palette.info.main, 0.48),
        color: theme.palette.getContrastText(
          emphasize(theme.palette.info.main, 0.48),
        ),
      },
      '&.padding': {
        border: `1px solid ${tv.palette.success.dark}`,
        backgroundColor: lighten(theme.palette.success.dark, 0.48),
        color: theme.palette.getContrastText(
          emphasize(theme.palette.success.dark, 0.48),
        ),
      },
    },
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
 * figure (AGL-2486, Zach 2026-08-23).
 *
 * One placement for all eight cannot work here: this is a set of nested
 * boxes, so whichever direction a tooltip opens it lands on top of a
 * neighbouring target unless the direction is chosen per side. Opening
 * away from the centre is the only choice with no neighbour behind it.
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
   * Exactly ONE tooltip is open, because ONE piece of state says which
   * (AGL-2486, Zach 2026-08-23).
   *
   * Nine independently-controlled tooltips could and did stack up: the
   * regions overlap, so a pointer crossing the figure can be inside
   * several hit areas in quick succession, and each tooltip decided its
   * own visibility. An enter delay would have hidden that without fixing
   * it. Naming the hovered target makes more than one open impossible by
   * construction, and the delay below is then only about calm.
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
            key.startsWith('margin') ? 'marginButton' : 'paddingButton',
            key,
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
          // A click is an answer, not a question — drop the tooltip so it
          // cannot sit over the editor that just opened beneath it.
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
      {sideButton('marginTop')}
      {sideButton('marginLeft')}

      <div className="borderRing">
        {/* The border tooltip hangs off the LABEL, not off the ring.
            Wrapping the ring wrapped every padding button inside it, so
            hovering padding opened the border tooltip too — that was the
            second tooltip Zach was seeing. */}
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
          {sideButton('paddingTop')}
          {sideButton('paddingLeft')}

          <div className="contents">
            <div>{'Content'}</div>
          </div>

          {sideButton('paddingRight')}
          {sideButton('paddingBottom')}

          <div className="label padding">{'Padding'}</div>
        </div>
      </div>

      {sideButton('marginRight')}
      {sideButton('marginBottom')}

      <div className="label margin">{'Margin'}</div>
    </StyledWrapper>
  )
})
BoxDiagram.displayName = 'BoxDiagram'

export default BoxDiagram
