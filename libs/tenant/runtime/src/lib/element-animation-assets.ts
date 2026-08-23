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
 * The published page's animation stylesheet and scroll runtime (AGL-2486).
 *
 * ## Why this is a server-only module
 *
 * `apps/tenant`'s route is a SERVER component and imports this by subpath, so
 * neither the CSS nor the script text ever enters the client bundle. That is
 * the whole point: a page that animates nothing must pay nothing, and here it
 * pays literally zero bytes — `pageAnimationAssets` returns `null` and the
 * route renders no `<style>` and no `<script>` at all.
 *
 * ## Why the runtime is inline rather than a chunk
 *
 * The only thing that needs JS is the scroll trigger, and it needs one shared
 * `IntersectionObserver` for the whole document — not one per element. That is
 * a few hundred bytes. As a module it would cost a chunk, a request, a
 * parse and a hydration tick; inline in the SSR HTML it costs bytes that gzip
 * with the document and runs before hydration. `apps/tenant` sets NO
 * `script-src` in either CSP header (deliberate — see `middleware.ts`, and
 * `specs/csp-no-script-src.spec.ts` holds it there), so an inline script needs
 * no nonce.
 *
 * ## prefers-reduced-motion
 *
 * EVERY rule below — the keyframes, the transitions, and critically the rule
 * that hides a scroll-triggered element before it plays — lives inside a
 * single `@media (prefers-reduced-motion: no-preference)` block. A visitor who
 * asked their OS to reduce motion therefore gets a page where nothing is
 * hidden and nothing moves, and the switch is live: because the gate is CSS
 * rather than a JS branch, toggling the OS setting after load resolves
 * correctly in BOTH directions. The runtime deliberately does NOT test
 * `matchMedia` itself — an early return there would leave elements hidden by a
 * rule that had just started applying again.
 *
 * ## No layout shift
 *
 * Every keyframe animates `opacity` and `transform` only. Neither affects
 * layout, so an entrance animation contributes nothing to CLS — the element
 * occupies its final box from the first frame.
 *
 * ## Stagger costs no extra JS and no extra observer entry
 *
 * A staggered row is ONE element as far as this file's runtime is concerned:
 * the host is what the observer watches, and the children play off the class
 * the observer puts on it. The per-child offset is a `:nth-child` ladder in
 * the sheet, so twelve cards arriving one after another cost twelve CSS
 * declarations and zero JS — where a runtime would have cost twelve
 * observer entries, twelve callbacks and twelve style writes on the main
 * thread, during scroll.
 */

import {
  ANIMATION_CLASS,
  ANIMATION_DELAY_VAR,
  ANIMATION_DURATION_VAR,
  ANIMATION_EASE_CLASS_PREFIX,
  ANIMATION_EASINGS,
  ANIMATION_GROUP_CLASS,
  ANIMATION_IN_CLASS,
  ANIMATION_PRESET_CLASS_PREFIX,
  ANIMATION_READY_CLASS,
  ANIMATION_REPEAT_ATTR,
  ANIMATION_STAGGER_MAX_CHILDREN,
  ANIMATION_STAGGER_OFFSET_VAR,
  ANIMATION_STAGGER_STEP_VAR,
  ANIMATION_TRIGGER_ATTR,
  NODE_ANIMATION_TRIGGER_PROP,
  nodePropsAnimate,
  type AnimationEase,
} from '@aglyn/aglyn/server'

/**
 * The easing curves, keyed by the ids `@aglyn/aglyn` publishes.
 *
 * The ids live in the shared module and the CURVES live here, so a page that
 * animates nothing carries neither. Every one of these is a plain
 * `cubic-bezier`; none is a spring, because a spring is not expressible in
 * CSS and buying one would mean buying a JS runtime.
 *
 * `overshoot` is the only curve that leaves the 0–1 range, and it does so on
 * the way IN only (`.34,1.56,.64,1` is the standard "back out"), so an
 * element settles rather than oscillating. Like every other rule here it sits
 * inside the reduced-motion gate.
 *
 * Typed as a total record so adding an id to `ANIMATION_EASINGS` without a
 * curve is a compile error rather than an element with no easing.
 */
const EASE_CURVES: Record<AnimationEase, string> = {
  smooth: 'cubic-bezier(.16,1,.3,1)',
  steady: 'linear',
  'gentle-start': 'cubic-bezier(.4,0,1,1)',
  'gentle-end': 'cubic-bezier(0,0,.2,1)',
  'gentle-both': 'cubic-bezier(.4,0,.2,1)',
  overshoot: 'cubic-bezier(.34,1.56,.64,1)',
}

/**
 * The curve an element gets when it carries no easing class at all — which is
 * every element authored before easing shipped. Deliberately the same string
 * `EASE` used to be, so nothing that already exists moves.
 */
const EASE = EASE_CURVES.smooth

/**
 * Per-preset custom properties. One rule per preset sets the keyframe name
 * used by the load/scroll triggers AND the transform the hover trigger eases
 * to, which is why the preset table is a single list rather than three.
 *
 * Hover is a TRANSITION to an emphasis state, not a keyframe run: "Slide up"
 * on hover lifts the element, "Zoom in" grows it. That is what an author means
 * when they pick a direction for a hover effect.
 */
const PRESETS: Array<{
  id: string
  /** `from` state of the entrance keyframe. */
  from: string
  /** Hover emphasis transform. */
  hover: string
  /** Hover emphasis opacity. */
  hoverOpacity?: string
}> = [
  { id: 'fade', from: 'opacity:0', hover: 'none', hoverOpacity: '.7' },
  {
    id: 'slide-up',
    from: 'opacity:0;transform:translate3d(0,24px,0)',
    hover: 'translate3d(0,-8px,0)',
  },
  {
    id: 'slide-down',
    from: 'opacity:0;transform:translate3d(0,-24px,0)',
    hover: 'translate3d(0,8px,0)',
  },
  {
    id: 'slide-left',
    from: 'opacity:0;transform:translate3d(24px,0,0)',
    hover: 'translate3d(-8px,0,0)',
  },
  {
    id: 'slide-right',
    from: 'opacity:0;transform:translate3d(-24px,0,0)',
    hover: 'translate3d(8px,0,0)',
  },
  {
    id: 'zoom-in',
    from: 'opacity:0;transform:scale3d(.92,.92,1)',
    hover: 'scale3d(1.04,1.04,1)',
  },
  {
    id: 'zoom-out',
    from: 'opacity:0;transform:scale3d(1.08,1.08,1)',
    hover: 'scale3d(.96,.96,1)',
  },
]

const NAME_VAR = '--aglyn-anim-name'
const HOVER_VAR = '--aglyn-anim-hover'
const HOVER_OPACITY_VAR = '--aglyn-anim-hover-opacity'
/**
 * Set by the easing class rules and read by the timing rules. Not exported:
 * the renderer writes a CLASS, never this property, so an author cannot get a
 * raw curve of their own into the page through it.
 */
const EASE_VAR = '--aglyn-anim-ease'

const ANIMATED = `.${ANIMATION_CLASS}`
const GROUP = `.${ANIMATION_GROUP_CLASS}`
/**
 * Everything the timing rules apply to: a plain animated element, and the
 * CHILDREN of a stagger host. The host itself is deliberately absent — it
 * sets the custom properties its children inherit and animates nothing.
 */
const TARGETS = `${ANIMATED},${GROUP}>*`
const DURATION = `var(${ANIMATION_DURATION_VAR},600ms)`
const DELAY = `var(${ANIMATION_DELAY_VAR},0ms)`
const STEP = `var(${ANIMATION_STAGGER_STEP_VAR},90ms)`
const TIMING = `var(${EASE_VAR},${EASE})`
/**
 * The author's own delay plus whatever rung of the stagger ladder this child
 * landed on. A plain animated element never matches a ladder rule, so its
 * offset falls back to `0ms` and the sum is exactly the delay it had before
 * stagger existed.
 */
const TOTAL_DELAY = `calc(${DELAY} + var(${ANIMATION_STAGGER_OFFSET_VAR},0ms))`

/**
 * The stagger ladder: one rule per rung, each pushing a child one more STEP
 * behind the one before it.
 *
 * The index has to come from CSS rather than the renderer. The renderer sees
 * a node, not a position — and a node that knew its index would have to
 * re-render every time a sibling was inserted, which is exactly what an
 * author does while building a row of cards.
 *
 * The first child gets NO rule: `var(--aglyn-anim-stagger,0ms)` already falls
 * back to zero, so emitting `calc(STEP * 0)` would be a rule that changes
 * nothing. The last rung is `:nth-child(n+N)` rather than an Nth rule, so a
 * collection with two hundred rows shares the final rung instead of leaving
 * its tail invisible for half a minute.
 */
const STAGGER_LADDER: string[] = [
  // Reset first, and it must STAY first. A nested stagger host's own ladder
  // rule has identical specificity (one class + one pseudo-class against two
  // classes), so source order is the only thing that lets the inner host win
  // for its own children. What this catches is the other case: an animated
  // element deeper inside a staggered child, which would otherwise INHERIT
  // its ancestor's rung and start late for no reason an author could see.
  `${GROUP}>* ${ANIMATED}{${ANIMATION_STAGGER_OFFSET_VAR}:0ms}`,
  ...Array.from(
    { length: ANIMATION_STAGGER_MAX_CHILDREN - 2 },
    (_unused, index) => {
      const nth = index + 2
      return `${GROUP}>*:nth-child(${nth}){${ANIMATION_STAGGER_OFFSET_VAR}:calc(${STEP} * ${nth - 1})}`
    },
  ),
  `${GROUP}>*:nth-child(n+${ANIMATION_STAGGER_MAX_CHILDREN}){${ANIMATION_STAGGER_OFFSET_VAR}:calc(${STEP} * ${
    ANIMATION_STAGGER_MAX_CHILDREN - 1
  })}`,
]

/**
 * The stylesheet. Built once at module load, not per request.
 *
 * The keyframe name is threaded through a custom property so the trigger rules
 * are two selectors rather than two per preset — the sheet stays flat as
 * presets are added.
 */
export const ELEMENT_ANIMATION_STYLE_TEXT = [
  '@media (prefers-reduced-motion:no-preference){',
  // Keyframes.
  ...PRESETS.map(
    (preset) =>
      `@keyframes aglyn-anim-${preset.id}{from{${preset.from}}to{opacity:1;transform:none}}`,
  ),
  // Per-preset custom properties. Keyed on the preset class ALONE, not on the
  // base class as well: a stagger host carries `aglyn-anim-group` rather than
  // `aglyn-anim`, and its children read these through inheritance, so a rule
  // that required the base class would leave a whole staggered row with no
  // keyframe name.
  ...PRESETS.map(
    (preset) =>
      `.${ANIMATION_PRESET_CLASS_PREFIX}${preset.id}{${NAME_VAR}:aglyn-anim-${preset.id};${HOVER_VAR}:${preset.hover}${
        preset.hoverOpacity ? `;${HOVER_OPACITY_VAR}:${preset.hoverOpacity}` : ''
      }}`,
  ),
  // Per-easing custom property, same shape and the same inheritance.
  ...ANIMATION_EASINGS.map(
    (ease) =>
      `.${ANIMATION_EASE_CLASS_PREFIX}${ease}{${EASE_VAR}:${EASE_CURVES[ease]}}`,
  ),
  // Shared timing for the keyframe triggers.
  `${TARGETS}{animation-duration:${DURATION};animation-delay:${TOTAL_DELAY};animation-timing-function:${TIMING};animation-fill-mode:both}`,
  // The stagger ladder — no-ops for every element that is not inside a host.
  ...STAGGER_LADDER,
  // On load: plays as soon as the element is parsed. No JS involved at all.
  `${ANIMATED}[${ANIMATION_TRIGGER_ATTR}=load],${GROUP}[${ANIMATION_TRIGGER_ATTR}=load]>*{animation-name:var(${NAME_VAR})}`,
  // On scroll: plays when the runtime marks it as entered. For a stagger host
  // the ONE observed element is the host, and its children play off its class
  // — one observer entry for a whole row, not one per card.
  `${ANIMATED}[${ANIMATION_TRIGGER_ATTR}=scroll].${ANIMATION_IN_CLASS},${GROUP}[${ANIMATION_TRIGGER_ATTR}=scroll].${ANIMATION_IN_CLASS}>*{animation-name:var(${NAME_VAR})}`,
  // The ONLY rule that hides anything, and it is scoped under a class the
  // inline runtime adds to <html>. No JS (or no IntersectionObserver) means
  // the class is never added, the rule never matches, and every element is
  // visible in its final state. `opacity` rather than `display`/`visibility`
  // so the content stays in the accessibility tree and in the DOM a crawler
  // reads either way.
  `html.${ANIMATION_READY_CLASS} ${ANIMATED}[${ANIMATION_TRIGGER_ATTR}=scroll]:not(.${ANIMATION_IN_CLASS}),html.${ANIMATION_READY_CLASS} ${GROUP}[${ANIMATION_TRIGGER_ATTR}=scroll]:not(.${ANIMATION_IN_CLASS})>*{opacity:0}`,
  // On hover: a transition, never a keyframe run, so it reverses cleanly when
  // the pointer leaves. Staggering is refused for hover upstream, so this rule
  // reads the author's plain delay rather than the ladder's sum — a
  // transition has no `animation-delay` to add a rung to.
  `${ANIMATED}[${ANIMATION_TRIGGER_ATTR}=hover]{transition:transform ${DURATION} ${TIMING} ${DELAY},opacity ${DURATION} ${TIMING} ${DELAY}}`,
  `${ANIMATED}[${ANIMATION_TRIGGER_ATTR}=hover]:hover{transform:var(${HOVER_VAR},none);opacity:var(${HOVER_OPACITY_VAR},1)}`,
  '}',
].join('')

/** Id of the injected style tag (idempotence marker, mirrors AGL-562). */
export const ELEMENT_ANIMATION_STYLE_ID = 'aglyn-element-animation-style'

/**
 * The scroll runtime, inlined verbatim into a `<script>`.
 *
 * One `IntersectionObserver` for the whole document. Re-scanning is safe and
 * cheap because `observe()` on an already-observed element is a no-op, which
 * is how late-arriving nodes (a deferred lazy tab panel the reader opens, a
 * collection page appending rows) get picked up without a per-element
 * observer. The `MutationObserver` is what makes that correct rather than
 * best-effort: an element inserted after load would otherwise stay at
 * `opacity:0` forever, because the hide rule applies the moment the ready
 * class is on `<html>`.
 *
 * The selector is the trigger ATTRIBUTE alone rather than the base class,
 * because there are now two base classes — an element that animates itself
 * and a stagger host whose children animate. Both carry the attribute, only
 * the renderer ever writes it, and matching on it keeps the runtime unaware
 * that the second shape exists.
 *
 * Written in ES5 with short locals because it ships as source; there is no
 * minifier in this path.
 */
export const ELEMENT_ANIMATION_SCRIPT_TEXT = `(function(){var w=window,d=document;if(!w.IntersectionObserver||!w.MutationObserver)return;d.documentElement.classList.add(${JSON.stringify(
  ANIMATION_READY_CLASS,
)});var S=${JSON.stringify(
  `[${ANIMATION_TRIGGER_ATTR}=scroll]`,
)},I=${JSON.stringify(ANIMATION_IN_CLASS)},R=${JSON.stringify(
  ANIMATION_REPEAT_ATTR,
)};var o=new w.IntersectionObserver(function(es){for(var i=0;i<es.length;i++){var e=es[i],t=e.target,r=t.getAttribute(R)==='1';if(e.isIntersecting){t.classList.add(I);if(!r)o.unobserve(t)}else if(r)t.classList.remove(I)}},{rootMargin:'0px 0px -10% 0px'});var q=0,scan=function(){q=0;var n=d.querySelectorAll(S);for(var i=0;i<n.length;i++)o.observe(n[i])};scan();if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',scan);var m=new w.MutationObserver(function(){if(q)return;q=w.requestAnimationFrame?w.requestAnimationFrame(scan):w.setTimeout(scan,0)});var start=function(){if(d.body)m.observe(d.body,{childList:true,subtree:true})};if(d.body)start();else d.addEventListener('DOMContentLoaded',start)})()`

export interface PageAnimationAssets {
  styleText: string
  /** Present only when the page carries a scroll-triggered element. */
  scriptText: string | null
}

/**
 * Decides what a page must ship, from the flat node map the route already
 * holds. Returns `null` — the common case — when nothing on the page animates,
 * and the route then renders neither tag.
 *
 * The scroll runtime is withheld separately: a page whose only animations play
 * on load or on hover is pure CSS and ships no script either.
 */
export function pageAnimationAssets(
  nodes: Record<string, any> | null | undefined,
): PageAnimationAssets | null {
  if (!nodes) return null
  let animates = false
  let needsScroll = false
  for (const id in nodes) {
    const props = nodes[id]?.props
    if (!nodePropsAnimate(props)) continue
    animates = true
    // `scroll` is the default trigger, so an unset trigger needs the runtime.
    const trigger = props?.[NODE_ANIMATION_TRIGGER_PROP]
    if (trigger === undefined || trigger === null || trigger === 'scroll') {
      needsScroll = true
      break
    }
  }
  if (!animates) return null
  return {
    styleText: ELEMENT_ANIMATION_STYLE_TEXT,
    scriptText: needsScroll ? ELEMENT_ANIMATION_SCRIPT_TEXT : null,
  }
}
