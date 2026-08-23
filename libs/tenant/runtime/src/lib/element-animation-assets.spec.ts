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
 * AGL-2486. The three promises this feature makes that are easy to ship
 * broken: a page that animates nothing pays nothing, a visitor who asked for
 * reduced motion gets none, and a visitor with no JS still sees the content.
 *
 * Each is asserted against the STRUCTURE of the emitted CSS rather than a
 * snapshot, so a rule that quietly moves outside the reduced-motion block —
 * the exact regression this feature invites — fails here.
 */

import {
  ELEMENT_ANIMATION_SCRIPT_TEXT,
  ELEMENT_ANIMATION_STYLE_TEXT,
  pageAnimationAssets,
} from './element-animation-assets'

/** A screen's flat node map, the shape the tenant route holds. */
const nodesWith = (props: Record<string, any>) => ({
  root: { componentId: 'section', props: {}, nodes: ['a'] },
  a: { componentId: 'typography', props, nodes: [] },
})

/**
 * Splits the stylesheet into the part inside the reduced-motion media block
 * and the part outside it. Naive brace counting is enough: the sheet is
 * generated, one media block deep.
 */
function outsideReducedMotionBlock(css: string): string {
  const open = css.indexOf('{', css.indexOf('@media'))
  let depth = 1
  let i = open + 1
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') depth--
  }
  return css.slice(0, css.indexOf('@media')) + css.slice(i)
}

describe('element animation assets (AGL-2486)', () => {
  describe('a page that animates nothing pays nothing', () => {
    it('returns null for a page with no animated node', () => {
      expect(pageAnimationAssets(nodesWith({ children: 'Hello' }))).toBeNull()
    })

    it('returns null for an empty or absent node map', () => {
      expect(pageAnimationAssets({})).toBeNull()
      expect(pageAnimationAssets(null)).toBeNull()
      expect(pageAnimationAssets(undefined)).toBeNull()
    })

    it('returns null when the author explicitly chose "none"', () => {
      // The sentinel is a real value (AGL-1451), so it is genuinely stored on
      // the node and must not be mistaken for an animation.
      expect(pageAnimationAssets(nodesWith({ aglynAnimation: 'none' }))).toBeNull()
    })

    it('returns null for a preset this build does not know', () => {
      // A screen authored against a future preset degrades to a static
      // element rather than emitting a class no rule matches.
      expect(
        pageAnimationAssets(nodesWith({ aglynAnimation: 'barrel-roll' })),
      ).toBeNull()
    })
  })

  describe('the scroll runtime ships only when a scroll trigger exists', () => {
    it('ships CSS but NO script for a load-triggered page', () => {
      const assets = pageAnimationAssets(
        nodesWith({ aglynAnimation: 'fade', aglynAnimationTrigger: 'load' }),
      )
      expect(assets?.styleText).toBeTruthy()
      expect(assets?.scriptText).toBeNull()
    })

    it('ships CSS but NO script for a hover-triggered page', () => {
      const assets = pageAnimationAssets(
        nodesWith({ aglynAnimation: 'zoom-in', aglynAnimationTrigger: 'hover' }),
      )
      expect(assets?.scriptText).toBeNull()
    })

    it('ships the script for an explicit scroll trigger', () => {
      const assets = pageAnimationAssets(
        nodesWith({ aglynAnimation: 'fade', aglynAnimationTrigger: 'scroll' }),
      )
      expect(assets?.scriptText).toBe(ELEMENT_ANIMATION_SCRIPT_TEXT)
    })

    it('ships the script when the trigger is UNSET, because scroll is the default', () => {
      // The renderer defaults an absent trigger to `scroll`. If this detector
      // did not agree, the element would be hidden by a rule with nothing to
      // reveal it — the worst failure this feature has.
      const assets = pageAnimationAssets(nodesWith({ aglynAnimation: 'slide-up' }))
      expect(assets?.scriptText).toBe(ELEMENT_ANIMATION_SCRIPT_TEXT)
    })
  })

  describe('prefers-reduced-motion', () => {
    it('puts EVERY rule inside the no-preference block', () => {
      const outside = outsideReducedMotionBlock(ELEMENT_ANIMATION_STYLE_TEXT)
      // Nothing but the media query itself may live at the top level: no
      // keyframes, no selectors, no declarations.
      expect(outside.replace(/\s/g, '')).toBe('')
    })

    it('gates the block on no-preference, not on a reduce override', () => {
      // `@media (prefers-reduced-motion: reduce)` disabling animation is the
      // common WRONG shape: it leaves the default state animated for anyone
      // whose preference is merely unknown, and it cannot un-hide an element
      // the scroll rule already hid.
      expect(ELEMENT_ANIMATION_STYLE_TEXT).toContain(
        '@media (prefers-reduced-motion:no-preference){',
      )
      expect(ELEMENT_ANIMATION_STYLE_TEXT).not.toContain(
        'prefers-reduced-motion:reduce',
      )
    })

    it('hides scroll elements INSIDE the block, so reduced motion reveals them', () => {
      // The hide rule is the one that must not survive a reduce preference.
      // If it were emitted outside, a reduced-motion visitor would get a page
      // of invisible elements that nothing ever reveals.
      const hide = ELEMENT_ANIMATION_STYLE_TEXT.match(
        /html\.aglyn-anim-js[^}]*\{opacity:0\}/,
      )
      expect(hide).not.toBeNull()
      expect(outsideReducedMotionBlock(ELEMENT_ANIMATION_STYLE_TEXT)).not.toContain(
        'opacity:0',
      )
    })

    it('does not branch on matchMedia in the runtime', () => {
      // A JS early-return on `reduce` would freeze the decision at load: a
      // visitor toggling the OS setting afterwards would be left with elements
      // hidden by a rule that had just started applying again. The gate is CSS
      // precisely so it stays live.
      expect(ELEMENT_ANIMATION_SCRIPT_TEXT).not.toContain('matchMedia')
    })
  })

  describe('no-JS and crawler experience', () => {
    it('scopes the ONLY hiding rule under a class JS adds', () => {
      // No script (or no IntersectionObserver) => no `aglyn-anim-js` on <html>
      // => the rule cannot match => every element renders visible.
      const hidingRules = ELEMENT_ANIMATION_STYLE_TEXT.split('}')
        .filter((rule) => /opacity:0/.test(rule))
        .filter((rule) => !rule.includes('@keyframes') && !rule.includes('from{'))
      expect(hidingRules.length).toBeGreaterThan(0)
      for (const rule of hidingRules) expect(rule).toContain('html.aglyn-anim-js')
    })

    it('never hides content from the DOM or the accessibility tree', () => {
      // `opacity` keeps the text rendered and readable; `display:none` or
      // `visibility:hidden` would take it out of the accessibility tree, and
      // `content-visibility` would strip it from the rendered output.
      expect(ELEMENT_ANIMATION_STYLE_TEXT).not.toContain('display:none')
      expect(ELEMENT_ANIMATION_STYLE_TEXT).not.toContain('visibility:hidden')
      expect(ELEMENT_ANIMATION_STYLE_TEXT).not.toContain('content-visibility')
    })

    it('adds the ready class only after confirming observer support', () => {
      const classIndex = ELEMENT_ANIMATION_SCRIPT_TEXT.indexOf('aglyn-anim-js')
      const guardIndex = ELEMENT_ANIMATION_SCRIPT_TEXT.indexOf(
        'w.IntersectionObserver',
      )
      // A browser with no IntersectionObserver must fall out BEFORE the class
      // is added, or it gets a permanently blank page.
      expect(guardIndex).toBeGreaterThanOrEqual(0)
      expect(guardIndex).toBeLessThan(classIndex)
    })
  })

  describe('cumulative layout shift', () => {
    it('animates only opacity and transform', () => {
      // The tenant scores 0-0.001 CLS. Animating any layout property — width,
      // height, margin, padding, top/left, or `all` — would regress that.
      const keyframes = ELEMENT_ANIMATION_STYLE_TEXT.match(/@keyframes[^@]+?\}\}/g)
      expect(keyframes?.length).toBeGreaterThan(0)
      for (const frame of keyframes ?? []) {
        const declared = frame.match(/([a-z-]+):/g) ?? []
        for (const property of declared) {
          expect(['opacity:', 'transform:']).toContain(property)
        }
      }
    })

    it('transitions named properties, never `all`', () => {
      // `transition: all` would sweep up layout properties an author set in
      // the Styles panel and animate those too.
      expect(ELEMENT_ANIMATION_STYLE_TEXT).not.toMatch(/transition:\s*all/)
      expect(ELEMENT_ANIMATION_STYLE_TEXT).toContain('transition:transform')
    })
  })

  describe('the inline runtime', () => {
    it('cannot break out of its own script tag', () => {
      expect(ELEMENT_ANIMATION_SCRIPT_TEXT).not.toContain('</script')
    })

    it('uses one shared observer, not one per element', () => {
      expect(
        (ELEMENT_ANIMATION_SCRIPT_TEXT.match(/new w\.IntersectionObserver/g) ?? [])
          .length,
      ).toBe(1)
    })

    it('rescans on mutation so late nodes are never left hidden', () => {
      // A deferred lazy tab panel opened after load inserts elements the first
      // scan never saw. Without the rescan they stay at opacity 0 forever.
      expect(ELEMENT_ANIMATION_SCRIPT_TEXT).toContain('MutationObserver')
    })

    it('stays small enough to justify being inline', () => {
      expect(ELEMENT_ANIMATION_SCRIPT_TEXT.length).toBeLessThan(1200)
    })
  })
})
