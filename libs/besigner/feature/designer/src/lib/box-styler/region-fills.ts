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

/**
 * The four region materials of the box diagram, defined ONCE (AGL-2486).
 *
 * Two reasons this is not inline in the component.
 *
 * puzzle. A swatch that is painted with the *same* declaration as the region
 * it names needs no decoding — so the diagram and the legend both read their
 * fills from here, and the two cannot drift.
 *
 * **Dark mode has to come from the theme.** Every value below is a palette
 * TOKEN or a channel form of one, never a literal, so the console's
 * `colorSchemeSelector: 'class'` CSS variables re-resolve them when the
 * scheme flips. That is also what keeps this file at zero entries in the
 * hardcoded-colour ratchet, whose baseline may not rise.
 *
 * The texture is deliberate and so is its weight. Zach on the first pass:
 * "what happened to the styles ... with the orange and the stripes etc. The
 * orange definitely stood out too much and I like you switched it to grey,
 * but you made everything else really boring." So the stripes come back —
 * carried by `text.primary` at a low alpha rather than by a hue, which is
 * what makes them read as material instead of as decoration, and what makes
 * them survive both schemes: `text.primary` is near-black on light and
 * near-white on dark, so the tint always contrasts gently with its ground.
 */

/** The subset of a theme these fills read (a CSS-vars theme's `vars`). */
export interface RegionFillTheme {
  palette: {
    text: { primary: string; primaryChannel: string }
    info: { mainChannel: string }
    primary: { mainChannel: string }
    secondary: { mainChannel: string }
    background: { paper: string; default: string }
  }
}

export interface RegionFill {
  /** `background` shorthand — a texture layer over a ground. */
  background: string
  /**
   * The ground BEHIND the wedges of this band.
   *
   * The band is drawn as four mitred wedges with a 2px gap between them,
   * and that gap is what makes the diagonal seams at the corners visible —
   * which is the whole reason the shape reads as a frame around something
   * rather than as a plain rectangle. The wedges carry `background`; this
   * shows through between them. The original used `common.black` here,
   * which is what made the seams read as harsh slashes; a low-alpha ink
   * tint gives the same geometry as fine lines instead.
   *
   * **Opaque, like every other value here.** A translucent seam is what
   * put the border band's texture underneath the padding controls: the
   * padding box's ground let the ring's material show straight through
   * it. A region paints its own material and nothing else's, so every
   * ground ends in a `background.*` token and each tint is layered ON it
   * rather than left to composite against whatever happens to be behind.
   */
  seam: string
  /** The edge drawn around the region. */
  borderColor: string
  borderStyle: 'dashed' | 'solid'
}

export interface RegionFills {
  margin: RegionFill
  border: RegionFill
  padding: RegionFill
  contents: RegionFill
  /**
   * The side whose editor is open.
   *
   * It lives here rather than in the component because "what colour is a
   * region, in which state" should have one answer in one file — and
   * because this is the value that was wrong: a fully saturated
   * `primary.main` inside a figure built deliberately from low-alpha
   * tints, so the selected wedge was the brightest thing on screen.
   */
  selected: RegionFill & { color: string }
}

/** An opaque stack: a flat tint layered ON a background token. */
const tint = (channel: string, alpha: number, ground: string) =>
  [
    `linear-gradient(0deg,`,
    ` rgba(${channel} / ${alpha}),`,
    ` rgba(${channel} / ${alpha}))`,
    `, ${ground}`,
  ].join('')

export function regionFills(tv: RegionFillTheme): RegionFills {
  const ink = tv.palette.text.primaryChannel
  const info = tv.palette.info.mainChannel
  const primary = tv.palette.primary.mainChannel
  const paper = tv.palette.background.paper
  const ground = tv.palette.background.default

  return {
    /**
     * The calmest material in the figure, because it is the largest area
     * in it — whatever the margin wears sets the overall noise level.
     *
     * It used to carry the stripes. That put the two loudest materials on
     * the two outermost regions and the diagram read as busy rather than
     * author looks at last.
     */
    margin: {
      background: tint(ink, 0.05, paper),
      seam: tint(ink, 0.15, paper),
      borderColor: `rgba(${ink} / 0.28)`,
      borderStyle: 'dashed',
    },

    /**
     * The stripes, and the only striped region — "only the border area".
     *
     * This is where they were always headed: it is the thinnest band, the
     * one that needed the most help reading as its own material, and the
     * one whose name an author is least likely to already understand.
     * Being the only patterned region is what makes it identifiable at a
     * glance rather than one texture among several.
     */
    border: {
      background: [
        `repeating-linear-gradient(45deg,`,
        ` rgba(${info} / 0.34) 0 4px,`,
        ` rgba(${info} / 0.10) 4px 9px)`,
        `, ${ground}`,
      ].join(''),
      seam: tint(info, 0.26, ground),
      borderColor: `rgba(${info} / 0.55)`,
      borderStyle: 'dashed',
    },

    /**
     * The original's faint diagonal wash between the two brand hues. It
     * was never the thing that was too loud, and it stays a tint on an
     * opaque ground rather than a gradient in its own right.
     */
    padding: {
      background: [
        `linear-gradient(65deg,`,
        ` rgba(${tv.palette.secondary.mainChannel} / 0.16),`,
        ` rgba(${primary} / 0.16))`,
        `, ${paper}`,
      ].join(''),
      seam: tint(primary, 0.24, paper),
      borderColor: `rgba(${primary} / 0.42)`,
      borderStyle: 'dashed',
    },

    /**
     * "Plain white inside it looks boring" — a fine dotted grid, the
     * visual shorthand for an empty canvas, and the quietest texture of
     * the four because this is the region the others exist to surround.
     */
    contents: {
      background: [
        `radial-gradient(rgba(${ink} / 0.16) 0.5px, transparent 0.5px)`,
        ` 0 0 / 5px 5px`,
        `, ${ground}`,
      ].join(''),
      seam: tint(ink, 0.15, ground),
      borderColor: `rgba(${ink} / 0.42)`,
      borderStyle: 'solid',
    },

    /**
     * Selection: the same hue, given alpha — "use the same color but
     * maybe make it have less opacity and add an alpha to the color".
     *
     * It was solid `primary.main`, the one fully saturated thing in a
     * figure built out of low-alpha tints, so it dominated instead of
     * indicating. At 0.42 over the region's own ground it is still the
     * strongest colour present — nothing else uses primary above 0.24 —
     * without being the brightest thing on screen.
     *
     * The text goes to `text.primary` rather than `primary.contrastText`.
     * A contrast-text token is computed for a SOLID primary; over a
     * translucent tint the actual backdrop is the region behind it, which
     * is near-white on light and near-black on dark. `text.primary` is
     * the token that flips with exactly that, so the label stays legible
     * in both schemes instead of being right in one.
     */
    selected: {
      background: tint(primary, 0.42, paper),
      seam: tint(primary, 0.42, paper),
      borderColor: `rgba(${primary} / 0.75)`,
      borderStyle: 'solid',
      color: tv.palette.text.primary,
    },
  }
}
