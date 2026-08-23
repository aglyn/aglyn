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
 * **The legend has to be readable.** Zach: "you also can't really understand
 * the key below it." Four abstract swatches beside a textured diagram is a
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
    text: { primaryChannel: string }
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
}

export function regionFills(tv: RegionFillTheme): RegionFills {
  const ink = tv.palette.text.primaryChannel
  const info = tv.palette.info.mainChannel

  return {
    /**
     * Grey, striped, quiet — the outermost band and the largest area, so
     * it carries the least. The orange it replaces is the change Zach
     * singled out as right: "the orange definitely stood out too much and
     * I like you switched it to grey."
     */
    margin: {
      background: [
        `repeating-linear-gradient(45deg,`,
        ` rgba(${ink} / 0.055) 0 4px,`,
        ` rgba(${ink} / 0.015) 4px 9px)`,
        `, ${tv.palette.background.paper}`,
      ].join(''),
      seam: `rgba(${ink} / 0.13)`,
      borderColor: `rgba(${ink} / 0.28)`,
      borderStyle: 'dashed',
    },

    /**
     * The band that needed the most work — "needs visually polishing the
     * border part especially". It is the thinnest region, so it gets the
     * densest, highest-contrast texture: a tight cross-hatch that reads as
     * a distinct material at 26px rather than as a gap between two better
     * resolved neighbours. Info-hued so it is nobody else's colour.
     */
    border: {
      background: [
        `repeating-linear-gradient(135deg,`,
        ` rgba(${info} / 0.30) 0 2px,`,
        ` rgba(${info} / 0.08) 2px 6px)`,
        `, ${tv.palette.background.default}`,
      ].join(''),
      seam: `rgba(${info} / 0.22)`,
      borderColor: `rgba(${info} / 0.55)`,
      borderStyle: 'dashed',
    },

    /**
     * The original's faint diagonal wash between the two brand hues, kept
     * because it was never the thing that was too loud — at this alpha it
     * is a tint on the ground rather than a gradient in its own right.
     */
    padding: {
      background: [
        `linear-gradient(65deg,`,
        ` rgba(${tv.palette.secondary.mainChannel} / 0.16),`,
        ` rgba(${tv.palette.primary.mainChannel} / 0.16))`,
        `, ${tv.palette.background.paper}`,
      ].join(''),
      seam: `rgba(${tv.palette.primary.mainChannel} / 0.22)`,
      borderColor: `rgba(${tv.palette.primary.mainChannel} / 0.42)`,
      borderStyle: 'dashed',
    },

    /**
     * "Plain white inside it looks boring" — so the innermost box gets a
     * fine dotted grid, the visual shorthand for an empty canvas. It is
     * the quietest texture of the four because this is the region the
     * others exist to surround, and it has to read as empty space that
     * something will fill.
     */
    contents: {
      background: [
        `radial-gradient(rgba(${ink} / 0.16) 0.5px, transparent 0.5px)`,
        ` 0 0 / 5px 5px`,
        `, ${tv.palette.background.default}`,
      ].join(''),
      seam: `rgba(${ink} / 0.13)`,
      borderColor: `rgba(${ink} / 0.42)`,
      borderStyle: 'solid',
    },
  }
}
