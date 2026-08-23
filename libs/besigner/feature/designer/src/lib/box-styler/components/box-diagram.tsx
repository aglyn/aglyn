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

/**
 * The box diagram, as it was (AGL-2486).
 *
 * This file's styling is the ORIGINAL, recovered from git rather than
 * redrawn. Two rounds of repainting — a saturated version Zach called
 * "messed up", then a flat nested-rectangle version that "looks nothing
 * like how you built it before" — were both solving a problem he did not
 * have. His verdict on the original: "I thought it looked great."
 *
 * So the trapezoid geometry, the dashed outlines, the faint gradients, the
 * label chips and the legend are all untouched here. Four things are
 * different, and they are the four he actually reported:
 *
 *   1. the BORDER label sits on the border region instead of outside it,
 *   2. selection is an obvious fill rather than two darker outlines,
 *   3. one tooltip at a time, click-through, placed away from its neighbour,
 *   4. the editor animates closed instead of vanishing (in `box-styler`).
 *
 * The non-visual work from the same pass stays: the theme spacing ladder,
 * the per-unit docs links, the plain Top/Left/Right/Bottom names, and the
 * consolidation that removed the second, data-losing diagram.
 */

const GAP = 2
const BTN_SIZE = 20
const HORZ_BTN = {
  H: 48,
  W: 100,
}
const HEIGHT = 220
/**
 * Thickness of the border band, in px.
 *
 * Sized to its LABEL, not to taste: the BORDER chip has to clear the
 * PADDING chip below-right of it, and at 11px the two collided. The
 * outer height grows by the same 20px the band takes, so the margin and
 * padding bands keep the proportions they had.
 */
const RING = 20

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
  backgroundColor: theme.palette.common.black,
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  textAlign: 'center',
  overflow: 'hidden',
  borderStyle: 'dashed',
  borderWidth: 1,
  borderColor: tv.palette.warning.dark,
  padding: 1,

  '.marginButton': {
    overflow: 'hidden',
    textAlign: 'center',
    bgcolor: 'primary.light',
    cursor: 'pointer',
    backfaceVisibility: 'hidden',
    backgroundColor: `rgba(${tv.palette.surface.mainChannel} / 0.96)`,
    color: theme.palette.getContrastText(
      alpha(theme.palette.surface.main, 0.96),
    ),
    background: [
      'linear-gradient(',
      '260deg, ',
      `${darken(theme.palette.surface.light, 0.08)}, `,
      `${lighten(theme.palette.surface.light, 0.12)}`,
      ') content-box',
    ].join(''),

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

  // The border band (AGL-2486). The box model puts the border BETWEEN
  // margin and padding, and the BORDER label has to sit on the region it
  // names — which means the region has to exist. Drawn in the same idiom
  // as its neighbours (1px dashed, no fill of its own) and deliberately
  // thin, so the margin and padding bands keep the proportions they had.
  // It is drawn, not edited: border width, style and colour already have
  // one home in Borders & Shadows.
  '.borderRing': {
    width: `calc(${BTN_SIZE * 3}% - ${GAP * 2}px)`,
    height: `${BTN_SIZE * 3}%`,
    margin: `${GAP}px auto`,
    padding: RING,
    position: 'relative',
    boxSizing: 'border-box',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: tv.palette.info.dark,
    // The band needs a fill of its OWN. The wrapper's background is
    // `common.black`, and in the original nothing showed it because the
    // margin buttons and the padding box covered every pixel — a new
    // region with no fill turned that black into a heavy frame around
    // the padding box. `surface.light` is the same token the contents
    // box already uses, so this introduces no new colour.
    backgroundColor: tv.palette.surface.light,
  },

  '.paddingContainer': {
    width: '100%',
    height: '100%',
    display: 'flex',
    padding: 1,
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
    backgroundColor: `rgba(${tv.palette.surface.darkChannel} / 0.96)`,
    background: [
      'linear-gradient(',
      '65deg, ',
      `${lighten(theme.palette.secondary.main, 0.76)}, `,
      `${lighten(theme.palette.primary.main, 0.76)}`,
      ') content-box',
    ].join(''),
    color: theme.palette.getContrastText(
      lighten(theme.palette.secondary.main, 0.76),
    ),

    '&.paddingTop': {
      width: `calc(100% - ${GAP * 2}px)`,
      height: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
      marginLeft: GAP,
      // marginRight: GAP,
      clipPath: polygon({
        topLX: `0%`,
        topLY: `0%`,
        topRX: `100%`,
        topRY: `0%`,
        btmRX: `calc(${BTN_SIZE * 2}% + (${
          100 - BTN_SIZE
        }% * 0.3333334) - ${GAP}px)`,
        btmRY: `100%`,
        btmLX: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334) + ${GAP}px)`,
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
        topRY: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334) + ${GAP}px)`,
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
        topLY: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334) + ${GAP}px)`,
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
        topLX: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334) + ${GAP}px)`,
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
    borderColor: tv.palette.info.dark,
    color: tv.palette.text.primary,
    backgroundColor: tv.palette.surface.light,
    width: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334) - ${GAP * 2}px)`,
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
    fontSize: 12,

    ':before': {
      content: '""',
      position: 'absolute',
      left: '-0.09em',
      top: '-0.29em',
      width: '0',
      height: '0.5em',
      background: 'transparent',
      borderRight: `0.5em solid rgba(${tv.palette.info.darkChannel} / 0.36)`,
      borderBottom: '0.5em solid transparent',
      borderTop: '0.5em solid transparent',
      transform: 'rotate(45deg)',
    },
  },

  /**
   * Selection (fix 2). It was `outline: 2px solid`, which in a figure made
   * of nested dashed outlines read as one more outline rather than as
   * "this is the side you are editing". A fill is unambiguous because
   * nothing else in the diagram is filled with a solid colour.
   */
  '.isSelected': {
    backgroundColor: tv.palette.primary.main,
    backgroundImage: 'none',
    color: tv.palette.primary.contrastText,
    fontWeight: 700,
  },

  // A value that follows the theme carries a dot: the number alone cannot
  // say so, since `16px` and the step that resolves to 16px look identical
  // and behave differently when the theme changes.
  '.themeStep .sideValue::after': {
    content: '""',
    display: 'block',
    width: 3,
    height: 3,
    borderRadius: '50%',
    margin: '1px auto 0',
    backgroundColor: 'currentColor',
    opacity: 0.6,
  },

  '.sideValue': { fontSize: 11, fontWeight: 600, lineHeight: 1.2 },
  '.sideEmpty': { fontSize: 10, fontWeight: 400, lineHeight: 1.2, opacity: 0.7 },

  '.label': {
    width: 'auto',
    position: 'absolute',
    textAlign: 'left',
    pointerEvents: 'none',
    left: 1,
    top: 1,
    paddingLeft: theme.spacing(0.5),
    paddingRight: theme.spacing(0.5),
    paddingTop: theme.spacing(0.25),
    paddingBottom: theme.spacing(0.25),
    borderBottom: `1px solid ${tv.palette.text.secondary}`,
    borderRight: `1px solid ${tv.palette.text.secondary}`,
    color: theme.palette.getContrastText(
      alpha(theme.palette.surface.main, 0.76),
    ),
    backgroundColor: `rgba(${tv.palette.surface.darkChannel} / 0.12)`,
    fontSize: theme.typography.pxToRem(12),

    '& > .arrow:before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      borderTop: `0.5em solid ${emphasize(theme.palette.surface.main, 0.36)}`,
      borderRight: '0.5em solid transparent',
      overflow: 'hidden',
    },

    '&.margin': {
      borderColor: tv.palette.warning.dark,
      backgroundColor: lighten(theme.palette.warning.dark, 0.48),
      color: theme.palette.getContrastText(
        emphasize(theme.palette.warning.dark, 0.48),
      ),

      '& > .arrow:before': {
        borderTopColor: darken(theme.palette.warning.dark, 0.12),
      },
    },

    // Same chip as MARGIN and PADDING — only the colour differs, so the
    // three read as one family stepping inward.
    '&.border': {
      pointerEvents: 'auto',
      cursor: 'help',
      borderColor: tv.palette.info.dark,
      backgroundColor: lighten(theme.palette.info.dark, 0.48),
      color: theme.palette.getContrastText(
        emphasize(theme.palette.info.dark, 0.48),
      ),

      '& > .arrow:before': {
        borderTopColor: darken(theme.palette.info.dark, 0.12),
      },
    },

    '&.padding': {
      borderColor: tv.palette.success.dark,
      backgroundColor: lighten(theme.palette.success.dark, 0.48),
      color: theme.palette.getContrastText(
        emphasize(theme.palette.success.dark, 0.48),
      ),

      '& > .arrow:before': {
        borderTopColor: darken(theme.palette.success.dark, 0.12),
      },
    },
  },
}})

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
 * figure (fix 3).
 *
 * One placement for all eight cannot work here: this is a set of nested
 * bands, so whichever direction a tooltip opens it lands on top of a
 * neighbouring target unless the direction is chosen per side. Opening away
 * from the centre is the only choice with no neighbour behind it.
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
 * MUI's own `enterDelay` is ignored once `open` is controlled, and these
 * have to be controlled for only-one-at-a-time. So the delay moves to the
 * state that drives them. Without it, dragging the pointer across a figure
 * this dense fires a tooltip per region crossed.
 */
const HOVER_DELAY_MS = 400

export const BoxDiagram = forwardRef<any, BoxDiagramProps>((props, ref) => {
  const { measurements, steps, border, editing, onSelect, ...rest } = props
  const ladder = steps ?? []

  /**
   * Exactly ONE tooltip is open, because ONE piece of state says which
   * (fix 3).
   *
   * Nine independently-controlled tooltips could and did stack up: the
   * bands overlap, so a pointer crossing the figure is inside several hit
   * areas in quick succession and each tooltip decided its own visibility.
   * An enter delay alone would have hidden that without fixing it.
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
          onMouseDown={clearTimer}
          aria-label={SIDE_LABELS[key]}
          aria-pressed={selected}
        >
          {/* `text` is '' only when nothing is set — a `0` step resolves to
              '0px' and an `auto` margin to 'auto', so both show as values
              and neither is ever mistaken for an empty side. */}
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
            hovering padding opened the border tooltip too — that was one
            of the several tooltips Zach was seeing at once. */}
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
            <div className="arrow"></div>
            {'Border'}
          </div>
        </Tooltip>

        <div className="paddingContainer">
          {sideButton('paddingTop')}
          {sideButton('paddingLeft')}

          <div className="contents">
            <div>{'Contents'}</div>
          </div>

          {sideButton('paddingRight')}
          {sideButton('paddingBottom')}

          <div className="label padding">
            <div className="arrow"></div>
            {'Padding'}
          </div>
        </div>
      </div>

      {sideButton('marginRight')}
      {sideButton('marginBottom')}

      <div className="label margin">
        <div className="arrow"></div>
        {'Margin'}
      </div>
    </StyledWrapper>
  )
})
BoxDiagram.displayName = 'BoxDiagram'

export default BoxDiagram
