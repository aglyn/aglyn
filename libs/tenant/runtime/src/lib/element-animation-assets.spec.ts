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
  ANIMATION_EASINGS,
  ANIMATION_STAGGER_MAX_CHILDREN,
} from '@aglyn/aglyn/server'
import {
  ELEMENT_ANIMATION_SCRIPT_TEXT,
  ELEMENT_ANIMATION_STYLE_TEXT,
  pageAnimationAssets,
} from './element-animation-assets'

/** The sheet as a list of `selector{declarations}` rules, keyframes aside. */
function rulesOf(css: string): Array<{ selector: string; body: string }> {
  return css
    .split('}')
    .map((chunk) => {
      const at = chunk.indexOf('{')
      if (at < 0) return null
      return { selector: chunk.slice(0, at), body: chunk.slice(at + 1) }
    })
    .filter(Boolean) as Array<{ selector: string; body: string }>
}

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

  describe('easing', () => {
    it('gives every easing id a curve, so no id is a dead class', () => {
      // The ids live in `@aglyn/aglyn` and the curves live here, on purpose —
      // this is the seam where the two can drift, and an id with no rule is
      // an element whose timing function silently falls back.
      for (const ease of ANIMATION_EASINGS) {
        expect(ELEMENT_ANIMATION_STYLE_TEXT).toContain(
          `.aglyn-anim-ease--${ease}{--aglyn-anim-ease:`,
        )
      }
    })

    it('reads the curve through a fallback, so an un-eased element still moves', () => {
      // Every screen authored before easing shipped carries no easing class.
      // Those elements must land on the original curve rather than on the
      // initial `ease`, which would visibly re-time published pages.
      const timing = rulesOf(ELEMENT_ANIMATION_STYLE_TEXT).find((rule) =>
        rule.body.includes('animation-timing-function'),
      )
      expect(timing?.body).toContain(
        'animation-timing-function:var(--aglyn-anim-ease,cubic-bezier(.16,1,.3,1))',
      )
    })

    it('never puts a raw curve on an element, only on a class', () => {
      // The renderer writes a class, never `--aglyn-anim-ease`. If a curve
      // could be set per element it would be author free text reaching CSS.
      for (const rule of rulesOf(ELEMENT_ANIMATION_STYLE_TEXT)) {
        if (!rule.body.includes('--aglyn-anim-ease:')) continue
        expect(rule.selector).toMatch(/^\.aglyn-anim-ease--[a-z-]+$/)
      }
    })
  })

  describe('stagger', () => {
    it('never gives the host itself a keyframe to run', () => {
      // A host that animated as well as staggering its children would play
      // two overlapping fades over the same pixels.
      for (const rule of rulesOf(ELEMENT_ANIMATION_STYLE_TEXT)) {
        if (!rule.body.includes('animation-name')) continue
        for (const selector of rule.selector.split(',')) {
          if (!selector.includes('aglyn-anim-group')) continue
          expect(selector.trimEnd().endsWith('>*')).toBe(true)
        }
      }
    })

    it('hides a host\'s CHILDREN, and only under the JS-added class', () => {
      const hiding = rulesOf(ELEMENT_ANIMATION_STYLE_TEXT).filter((rule) =>
        rule.body.includes('opacity:0'),
      )
      expect(hiding.length).toBeGreaterThan(0)
      const groupSelectors = hiding
        .flatMap((rule) => rule.selector.split(','))
        .filter((selector) => selector.includes('aglyn-anim-group'))
      expect(groupSelectors.length).toBe(1)
      expect(groupSelectors[0]).toContain('html.aglyn-anim-js ')
      expect(groupSelectors[0].trimEnd().endsWith('>*')).toBe(true)
    })

    it('keys the preset rule on the preset class ALONE', () => {
      // A host carries `aglyn-anim-group`, not `aglyn-anim`. If the preset
      // rule still required the base class the host would set no keyframe
      // name, and a whole staggered row would sit at opacity 0 for good —
      // silently, because every other rule still matches.
      for (const rule of rulesOf(ELEMENT_ANIMATION_STYLE_TEXT)) {
        if (!rule.body.includes('--aglyn-anim-name:')) continue
        expect(rule.selector).toMatch(/^\.aglyn-anim--[a-z-]+$/)
      }
    })

    it('applies the shared timing to a host\'s children as well', () => {
      // Without this the children inherit a keyframe name and run it at the
      // browser's default 0s duration, i.e. they appear instantly and the
      // author's duration, delay and easing all do nothing.
      const timing = rulesOf(ELEMENT_ANIMATION_STYLE_TEXT).find((rule) =>
        rule.body.includes('animation-fill-mode'),
      )
      expect(timing?.selector.split(',')).toContain('.aglyn-anim-group>*')
    })

    it('adds the rung to the author\'s delay rather than replacing it', () => {
      // An author who set both a delay and a stagger means "start the row
      // late, THEN space it out". Replacing would drop their delay silently.
      const timing = rulesOf(ELEMENT_ANIMATION_STYLE_TEXT).find((rule) =>
        rule.body.includes('animation-delay'),
      )
      expect(timing?.body).toContain(
        'animation-delay:calc(var(--aglyn-anim-delay,0ms) + var(--aglyn-anim-stagger,0ms))',
      )
    })

    it('resets the offset for animated descendants BEFORE climbing the ladder', () => {
      // Custom properties inherit. Without this reset an animated element
      // deep inside a staggered card would inherit that card's rung and start
      // late for no reason an author could see. It has to come FIRST: a
      // nested host's own rung rule has identical specificity, so source
      // order is the only thing that lets the inner host win for its children.
      const css = ELEMENT_ANIMATION_STYLE_TEXT
      const reset = css.indexOf('.aglyn-anim-group>* .aglyn-anim{')
      const firstRung = css.indexOf('.aglyn-anim-group>*:nth-child(')
      expect(reset).toBeGreaterThan(-1)
      expect(firstRung).toBeGreaterThan(-1)
      expect(reset).toBeLessThan(firstRung)
    })

    it('gives the first child no rung rule at all', () => {
      // `var(--aglyn-anim-stagger,0ms)` already falls back to zero, so a
      // `calc(STEP * 0)` rule would be a rule that changes nothing.
      expect(ELEMENT_ANIMATION_STYLE_TEXT).not.toContain(
        '.aglyn-anim-group>*:nth-child(1)',
      )
    })

    it('caps the ladder so a long list never strands its tail', () => {
      const css = ELEMENT_ANIMATION_STYLE_TEXT
      const last = ANIMATION_STAGGER_MAX_CHILDREN
      // Everything from the cap onward shares the final rung...
      expect(css).toContain(
        `.aglyn-anim-group>*:nth-child(n+${last}){--aglyn-anim-stagger:calc(var(--aglyn-anim-step,90ms) * ${last - 1})}`,
      )
      // ...and no rung is emitted past it, which is what stops a 200-row
      // collection waiting minutes for its last card.
      expect(css).not.toContain(
        `.aglyn-anim-group>*:nth-child(${last + 1})`,
      )
      const rungs = rulesOf(css).filter((rule) =>
        /^\.aglyn-anim-group>\*:nth-child/.test(rule.selector),
      )
      expect(rungs.length).toBe(last - 1)
    })

    it('multiplies the step, so each child is one gap behind the last', () => {
      expect(ELEMENT_ANIMATION_STYLE_TEXT).toContain(
        '.aglyn-anim-group>*:nth-child(2){--aglyn-anim-stagger:calc(var(--aglyn-anim-step,90ms) * 1)}',
      )
      expect(ELEMENT_ANIMATION_STYLE_TEXT).toContain(
        '.aglyn-anim-group>*:nth-child(5){--aglyn-anim-stagger:calc(var(--aglyn-anim-step,90ms) * 4)}',
      )
    })

    it('ships the scroll runtime for a staggered row', () => {
      // The children carry no animation props of their own, so the host is
      // the only node the detector can see.
      const assets = pageAnimationAssets(
        nodesWith({ aglynAnimation: 'fade', aglynAnimationStagger: true }),
      )
      expect(assets?.scriptText).toBeTruthy()
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
