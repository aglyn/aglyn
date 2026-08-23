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
import { regionFills } from '../region-fills'
import {
  isThemeSpacingStep,
  spacingDescription,
  spacingDisplayText,
} from '../spacing-value'
import type { Measurements } from '../types'

export type { Measurements }

/**
 * The box diagram (AGL-2486).
 *
 * The geometry is the original's — wedge-shaped bands framing the content,
 * because that shape is what says these are frames AROUND something rather
 * than four unrelated numbers, and it is the shape Zach's eye had learned.
 * Two attempts to improve on it were both wrong: one repainted it in
 * saturated colour, the other removed the wedges along with the paint.
 *
 * What is different here is the third position Zach actually described:
 * "the orange definitely stood out too much and I like you switched it to
 * grey, but you made everything else really boring". So the texture is
 * back — stripes, cross-hatch, a wash, a dotted grid — carried by
 * `text.primary` and low-alpha hues rather than by saturation, and defined
 * once in `region-fills.ts` so the legend swatches are painted with the
 * same declarations as the regions they name.
 *
 * Three proportion changes come from the same round of feedback:
 *
 * - The BORDER band is 26px rather than 20 and carries the densest
 *   texture — it was "the thinnest region and the one carrying a chip",
 *   reading as a gap between two better-resolved neighbours.
 * - `Contents` is 48% of the padding box rather than 33%, so it reads as
 *   the thing everything else surrounds instead of a label in a gap.
 * - The BORDER chip sits TOP-LEFT, on the same opaque chip MARGIN and
 *   PADDING use. It spent one round at the bottom right, overlapping its
 *   neighbours, because that was the only way it read while the palette
 *   was still unsettled; with the materials resolved all three chips take
 *   the same corner of their own band, so they step inward along the left
 *   edge as the regions nest. See `.label.border` below for why the
 *   ground and the placement are one change rather than two.
 *
 * Every colour is a palette token or a channel form of one. Nothing is a
 * literal, so the console's class-based colour-scheme variables re-resolve
 * the whole diagram when the theme flips — which is what fixes "we are
 * missing a dark mode version of colors, this is too bright on dark mode"
 * without a second mechanism, and what keeps this file at zero entries in
 * the hardcoded-colour ratchet.
 */

const GAP = 2
/** Thickness of each margin band, as a % of the diagram. */
const MARGIN_BAND = 17
/** Thickness of each padding band, as a % of the padding box. */
const PAD_BAND = 26
/** Thickness of the border band, in px. */
const RING = 26
const HEIGHT = 244

/**
 * The narrowest diagram that can carry the PADDING chip (AGL-2486, Zach
 * 2026-08-23).
 *
 * A chip sits at the top-left of its region and a side's value is centred
 * in its wedge. Measured across panel widths, exactly ONE pair ever meets:
 * the PADDING chip and the `paddingTop` value. The cause is arithmetic
 * rather than styling — the padding band is about 40% of the diagram,
 * because the margin bands take 17% a side and the border ring a further
 * FIXED `RING` px a side, and it is the fixed part that eats a growing
 * share as the panel narrows. At a 260px panel the band is 83px and the
 * chip alone is 54px of it.
 *
 * **There is no placement that fixes this, and the first attempt proved
 * it.** Reserving a column so the value slid right did clear the chip by
 * the numbers `getBoundingClientRect` reports — and the value came out
 * CLIPPED, because the wedge is a trapezoid: `clipPath` narrows the band
 * from 100% at its top edge to 74% at its bottom, and a rect-based check
 * cannot see a clip path any more than it can see an outline. At the
 * value's own row the usable window at 260px is ~54px wide in total. A
 * 54px chip and a 25px value do not both go in it, at any offset.
 *
 * So the chip yields, below the width at which its band can hold both.
 * Nothing is lost by it: the legend directly under the diagram names all
 * four regions and paints each swatch with that region's own material, so
 * the padding region is still named and still identified by its wash —
 * whereas a covered value is data the author simply cannot read.
 *
 * The threshold is measured, with headroom rather than to the millimetre:
 * the value clears naturally at a 307px diagram, by 1.3px, which is a
 * coincidence and not a clearance. At 320px it clears by ~5.5px, and by
 * ~1.5px even for a value half again as wide as the ladder's own. The
 * stock 375px panel gives a 342px diagram, so the chip is well clear of
 * the boundary at every ordinary width.
 */
export const PADDING_CHIP_MIN_WIDTH = 320

/** The query container the threshold is measured against. */
const CONTAINER_NAME = 'aglynBoxDiagram'

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

/** The four mitred wedges of one band, given its thickness in percent. */
const wedges = (band: number) => ({
  top: polygon({
    topLX: '0%', topLY: '0%', topRX: '100%', topRY: '0%',
    btmRX: `${100 - band}%`, btmRY: '100%', btmLX: `${band}%`, btmLY: '100%',
  }),
  bottom: polygon({
    topLX: `${band}%`, topLY: '0%', topRX: `${100 - band}%`, topRY: '0%',
    btmRX: '100%', btmRY: '100%', btmLX: '0%', btmLY: '100%',
  }),
  left: polygon({
    topLX: '0%', topLY: '0%', topRX: '100%', topRY: `${band}%`,
    btmRX: '100%', btmRY: `${100 - band}%`, btmLX: '0%', btmLY: '100%',
  }),
  right: polygon({
    topLX: '0%', topLY: `${band}%`, topRX: '100%', topRY: '0%',
    btmRX: '100%', btmRY: '100%', btmLX: '0%', btmLY: `${100 - band}%`,
  }),
})

const StyledWrapper = styled('div')(({ theme }) => {
  // In CSS vars mode theme.palette.* returns the static LIGHT values, so
  // every reference here goes through (theme.vars || theme): that is what
  // makes the diagram re-resolve when the dark class toggles on <html>.
  const tv = (theme as any).vars || theme
  const fills = regionFills(tv as any)
  const ink = tv.palette.text.primaryChannel
  const marginWedge = wedges(MARGIN_BAND)
  const padWedge = wedges(PAD_BAND)

  return {
    width: '100%',
    height: HEIGHT,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    textAlign: 'center',
    overflow: 'hidden',
    boxSizing: 'border-box',
    // The figure answers to its OWN width, not the window's. The panel is
    // resizable, so a viewport media query would be measuring the wrong
    // thing entirely — a 260px panel and a 375px panel sit in the same
    // window. `inline-size` only contains the inline axis, and the height
    // here is a fixed `HEIGHT`, so nothing about the layout moves.
    containerType: 'inline-size',
    containerName: CONTAINER_NAME,
    borderRadius: theme.shape.borderRadius,
    borderWidth: 1,
    borderStyle: fills.margin.borderStyle,
    borderColor: fills.margin.borderColor,
    // The ground the margin wedges sit on — it shows through the 2px gaps
    // between them as the diagonal corner seams.
    background: fills.margin.seam,
    color: tv.palette.text.primary,
    padding: 1,

    '.marginButton': {
      overflow: 'hidden',
      textAlign: 'center',
      cursor: 'pointer',
      backfaceVisibility: 'hidden',
      color: 'inherit',
      // The material is on the WEDGE, not on the region behind it: a
      // transparent button clips to nothing and the band reads as a plain
      // rectangle, which is exactly the geometry that had to come back.
      background: fills.margin.background,
      transition: theme.transitions.create(['filter'], { duration: 120 }),
      '&:hover': { filter: 'brightness(1.04)' },

      '&.marginTop': {
        width: `calc(100% - ${GAP * 2}px)`,
        marginLeft: GAP,
        marginRight: GAP,
        height: `calc(${MARGIN_BAND}% - ${GAP}px)`,
        clipPath: marginWedge.top,
      },
      '&.marginBottom': {
        width: `calc(100% - ${GAP}px)`,
        marginLeft: GAP,
        height: `${MARGIN_BAND}%`,
        clipPath: marginWedge.bottom,
      },
      '&.marginLeft': {
        left: 1,
        top: 0,
        position: 'absolute',
        height: `calc(100% - ${GAP}px)`,
        width: `${MARGIN_BAND}%`,
        clipPath: marginWedge.left,
      },
      '&.marginRight': {
        right: 1,
        height: `calc(100% - ${GAP * 2}px)`,
        width: `${MARGIN_BAND}%`,
        position: 'absolute',
        clipPath: marginWedge.right,
      },
    },

    // The border band. Thicker and densely hatched, because it is the
    // thinnest region and was reading as an afterthought between two
    // better-resolved bands.
    '.borderRing': {
      width: `calc(${100 - MARGIN_BAND * 2}% - ${GAP * 2}px)`,
      height: `${100 - MARGIN_BAND * 2}%`,
      margin: `${GAP}px auto`,
      padding: RING,
      position: 'relative',
      boxSizing: 'border-box',
      borderRadius: 2,
      borderWidth: 1,
      borderStyle: fills.border.borderStyle,
      borderColor: fills.border.borderColor,
      background: fills.border.background,
    },

    '.paddingContainer': {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      textAlign: 'center',
      overflow: 'hidden',
      borderRadius: 2,
      borderWidth: 1,
      borderStyle: fills.padding.borderStyle,
      borderColor: fills.padding.borderColor,
      background: fills.padding.seam,
      boxSizing: 'border-box',
    },

    '.paddingButton': {
      overflow: 'hidden',
      backfaceVisibility: 'hidden',
      cursor: 'pointer',
      color: 'inherit',
      background: fills.padding.background,
      transition: theme.transitions.create(['filter'], { duration: 120 }),
      '&:hover': { filter: 'brightness(1.04)' },

      '&.paddingTop': {
        width: `calc(100% - ${GAP * 2}px)`,
        height: `${PAD_BAND}%`,
        marginLeft: GAP,
        clipPath: padWedge.top,
      },
      '&.paddingBottom': {
        width: `calc(100% - ${GAP * 2}px)`,
        height: `${PAD_BAND}%`,
        marginLeft: GAP,
        marginRight: GAP,
        clipPath: padWedge.bottom,
      },
      '&.paddingLeft': {
        position: 'absolute',
        top: 0,
        left: 1,
        height: `calc(100% - ${GAP * 2}px)`,
        width: `${PAD_BAND}%`,
        marginTop: GAP,
        marginBottom: GAP,
        clipPath: padWedge.left,
      },
      '&.paddingRight': {
        position: 'absolute',
        top: 0,
        right: 1,
        height: `calc(100% - ${GAP * 2}px)`,
        width: `${PAD_BAND}%`,
        marginTop: GAP,
        marginBottom: GAP,
        clipPath: padWedge.right,
      },
    },

    // 48% of the padding box rather than 33%: this is the thing the other
    // three regions exist to surround, and it was reading as a label
    // squeezed into a gap.
    '.contents': {
      width: `calc(${100 - PAD_BAND * 2}% - ${GAP * 2}px)`,
      height: `calc(${100 - PAD_BAND * 2}% - ${GAP * 2}px)`,
      margin: `${GAP}px auto`,
      position: 'relative',
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 2,
      borderWidth: 1,
      borderStyle: fills.contents.borderStyle,
      borderColor: fills.contents.borderColor,
      background: fills.contents.background,
      color: tv.palette.text.secondary,
      fontSize: theme.typography.pxToRem(11),
      letterSpacing: '0.02em',
    },

    /**
     * Selection is a fill, not an outline: two darker outlines inside a
     * figure built from dashed outlines read as one more outline rather
     * than as "this is the side you are editing".
     *
     * The fill itself is defined in `region-fills` alongside the four
     * region materials, so the answer to "what colour is a region, in
     * which state" lives in one file. It is a TINT of primary rather
     * than solid primary — solid was the brightest thing in a figure
     * made of low-alpha tints, so it dominated instead of indicating.
     */
    '.isSelected': {
      background: fills.selected.background,
      color: fills.selected.color,
      fontWeight: 700,
      '&:hover': { filter: 'brightness(0.96)' },
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
      opacity: 0.6,
    },

    '.sideValue': {
      fontSize: theme.typography.pxToRem(11),
      fontWeight: 600,
      lineHeight: 1.2,
    },
    '.sideEmpty': {
      fontSize: theme.typography.pxToRem(10),
      fontWeight: 400,
      lineHeight: 1.2,
      color: tv.palette.text.secondary,
    },

    '.label': {
      width: 'auto',
      position: 'absolute',
      textAlign: 'left',
      pointerEvents: 'none',
      left: 2,
      top: 2,
      zIndex: 2,
      paddingLeft: theme.spacing(0.5),
      paddingRight: theme.spacing(0.5),
      borderRadius: 2,
      borderWidth: 1,
      borderStyle: 'solid',
      fontSize: theme.typography.pxToRem(9),
      lineHeight: 1.5,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      fontWeight: 700,
      color: tv.palette.text.secondary,
      backgroundColor: tv.palette.background.paper,
      borderColor: `rgba(${ink} / 0.28)`,

      '&.margin': { borderColor: fills.margin.borderColor },
      '&.padding': { borderColor: fills.padding.borderColor },

      /**
       * BORDER, on the same opaque chip as MARGIN and PADDING, in the
       * same TOP-LEFT corner of its own band (Zach, 2026-08-23; top-left
       * supersedes a top-right pass earlier the same day).
       *
       * Two asks that turn out to be one change. The chip painted
       * `fills.border.background` — the band's own stripes — which is how
       * it stayed identifiably the border's while it lay across two
       * neighbouring regions at the bottom right. But `background` is a
       * SHORTHAND, so it also reset the base chip's opaque
       * `background.paper` ground: BORDER was the only one of the three
       * labels reading off a 45° hatch, and since the border band is the
       * figure's only patterned region, the label most in need of a
       * ground was the one without one.
       *
       * Removing that single declaration restores the base treatment
       * untouched — not a variant of the chip, the same chip. The dashed
       * edge in the band's own info hue is what still says "border", and
       * it is enough now that the chip no longer has to survive lying
       * across two other materials.
       *
       * The ground is also what frees the placement: with one it no
       * longer has to overlap to be read, so it takes its own band's
       * top-left corner and the three chips step inward together as the
       * regions nest — which is the pattern MARGIN and PADDING already
       * set. Nothing about the position is declared here: the base rule's
       * `left: 2, top: 2` is the placement, and each chip is positioned
       * against its OWN region (`.borderRing` here, `.paddingContainer`
       * for PADDING, the wrapper for MARGIN), so the inward step is the
       * geometry rather than three hand-tuned offsets. It CLEARS the 26px
       * band — 9px type at 1.5 plus two 1px edges is ~16px tall — checked
       * at a 260px panel, not only at a comfortable width.
       */
      '&.border': {
        pointerEvents: 'auto',
        cursor: 'help',
        borderStyle: 'dashed',
        borderColor: fills.border.borderColor,
        color: tv.palette.text.primary,
      },
    },

    /**
     * Below `PADDING_CHIP_MIN_WIDTH` the padding band cannot hold its chip
     * AND its value, so the chip goes and the value stays — see the
     * constant for why there is no placement that keeps both.
     *
     * Only this chip. MARGIN's band is the full width of the diagram and
     * BORDER's carries no value at all, so neither can ever reach one;
     * hiding them here would remove information for no reason. The rule is
     * "a chip is drawn where its own band has room for it", which is why
     * it reads as one chip short rather than as an arbitrary breakpoint.
     */
    [`@container ${CONTAINER_NAME} (max-width: ${
      PADDING_CHIP_MIN_WIDTH - 1
    }px)`]: {
      '.label.padding': { display: 'none' },
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
