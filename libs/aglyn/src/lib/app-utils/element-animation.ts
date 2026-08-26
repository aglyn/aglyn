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
 * Element animation vocabulary (AGL-2486) — the names the renderer, the
 * besigner attributes panel and the tenant's stylesheet all agree on.
 *
 * ## Why there is no animation runtime here
 *
 * Published pages ship no animation library, and that is the design, not a
 * phase one. Motion's smallest useful React surface (`LazyMotion` +
 * `domAnimation` + `m`) is ~17kB gzipped and the full `motion` import ~34kB —
 * against the 87,646 B gzipped that came OFF the published page the same week
 * this landed. What a site builder's authors actually reach for is entrance
 * and hover emphasis: fade, slide, zoom, played on load, on scroll-in or on
 * hover. Every one of those is `@keyframes` plus `transition`, which the
 * compositor runs off the main thread — including during hydration, which is
 * exactly when an entrance animation plays and exactly when a JS runtime is
 * least able to keep up. Spring physics, FLIP/layout animation and
 * gesture-driven interpolation are what a runtime would buy, and none of them
 * are authorable from a preset dropdown by the audience this is for.
 *
 * The single exception is the scroll trigger, which needs an
 * `IntersectionObserver`. That is ~700 bytes of inline script shipped in the
 * SSR HTML by `apps/tenant`, only on pages that actually carry a
 * scroll-triggered node — no module, no chunk, no extra request, and it
 * gzips with the document. See `@aglyn/tenant-runtime`'s
 * `element-animation-assets.ts` for the stylesheet and that script.
 *
 * This module is reachable from the client bundle (the renderer's `Leaf`
 * imports it), so it holds constants and two small pure functions and
 * nothing else. The stylesheet text deliberately lives in the server-only
 * module so a page that animates nothing pays literally zero bytes for it.
 */

/** Preset id prop. Reserved node prop, stripped before the DOM spread. */
export const NODE_ANIMATION_PROP = 'aglynAnimation'
/** Trigger prop: when the preset plays. */
export const NODE_ANIMATION_TRIGGER_PROP = 'aglynAnimationTrigger'
/** Duration prop, in milliseconds. */
export const NODE_ANIMATION_DURATION_PROP = 'aglynAnimationDuration'
/** Delay prop, in milliseconds. */
export const NODE_ANIMATION_DELAY_PROP = 'aglynAnimationDelay'
/** Repeat prop: re-play every time the element scrolls back into view. */
export const NODE_ANIMATION_REPEAT_PROP = 'aglynAnimationRepeat'
/** Easing prop: the shape of the motion curve. */
export const NODE_ANIMATION_EASE_PROP = 'aglynAnimationEase'
/** Stagger prop: animate the children one after another, not the element. */
export const NODE_ANIMATION_STAGGER_PROP = 'aglynAnimationStagger'
/** Stagger step prop: how much later each child starts, in milliseconds. */
export const NODE_ANIMATION_STAGGER_STEP_PROP = 'aglynAnimationStaggerStep'

/** Every reserved animation prop, for the renderer's strip step. */
export const NODE_ANIMATION_PROPS = [
  NODE_ANIMATION_PROP,
  NODE_ANIMATION_TRIGGER_PROP,
  NODE_ANIMATION_DURATION_PROP,
  NODE_ANIMATION_DELAY_PROP,
  NODE_ANIMATION_REPEAT_PROP,
  NODE_ANIMATION_EASE_PROP,
  NODE_ANIMATION_STAGGER_PROP,
  NODE_ANIMATION_STAGGER_STEP_PROP,
] as const

/**
 * The "no animation" value is a real string, never `''` (AGL-1451): an empty
 * value cannot persist through the attributes form, so an author who picked a
 * preset could never switch back off it.
 */
export const ANIMATION_NONE = 'none'

/** Preset ids. Persisted in screen documents — never rename one. */
export const ANIMATION_PRESETS = [
  ANIMATION_NONE,
  'fade',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'zoom-in',
  'zoom-out',
] as const

export type AnimationPreset = (typeof ANIMATION_PRESETS)[number]

/** Trigger ids. Persisted — never rename one. */
export const ANIMATION_TRIGGERS = ['load', 'scroll', 'hover'] as const

export type AnimationTrigger = (typeof ANIMATION_TRIGGERS)[number]

/**
 * Easing ids — the SHAPE of the motion, the third dial beside duration and
 * delay. Persisted; never rename one.
 *
 * Only the ids live here. The `cubic-bezier()` curves themselves are in the
 * server-only stylesheet module, for the same reason the keyframes are: this
 * file is reachable from the client bundle and six bezier literals is ~200
 * bytes that every visitor to a still page would otherwise carry. The id
 * becomes a class, the class sets a custom property, and the curve is read
 * from the sheet that only an animating page ships.
 */
export const ANIMATION_EASINGS = [
  'smooth',
  'steady',
  'gentle-start',
  'gentle-end',
  'gentle-both',
  'overshoot',
] as const

export type AnimationEase = (typeof ANIMATION_EASINGS)[number]

/** Default when an author picks a preset but leaves the dials alone. */
export const ANIMATION_DEFAULT_TRIGGER: AnimationTrigger = 'scroll'
export const ANIMATION_DEFAULT_DURATION_MS = 600
export const ANIMATION_DEFAULT_DELAY_MS = 0
/**
 * The curve every animation used before easing was authorable. Keeping it as
 * the default means every screen authored before this shipped renders byte
 * for byte the same.
 */
export const ANIMATION_DEFAULT_EASE: AnimationEase = 'smooth'
/** Default gap between staggered children. */
export const ANIMATION_DEFAULT_STAGGER_STEP_MS = 90

/** Upper bounds. A 30s entrance is an author mistake, not an intent. */
export const ANIMATION_MAX_DURATION_MS = 3000
export const ANIMATION_MAX_DELAY_MS = 3000
/**
 * A stagger step is capped far lower than a delay, because it MULTIPLIES:
 * the last of twelve cards waits eleven steps. At the 500ms cap that is
 * already 5.5s, which is why {@link ANIMATION_STAGGER_MAX_CHILDREN} stops the
 * ladder climbing rather than letting a long list run off the end.
 */
export const ANIMATION_MAX_STAGGER_STEP_MS = 500
/**
 * How many children get their own rung of the stagger ladder. Beyond this
 * every remaining child shares the last rung, so a 200-row collection cannot
 * leave its tail invisible for a minute — the tail arrives together, which is
 * the least surprising failure and the one an author can actually see.
 *
 * Also the size of the generated rule block, which is why it is a number and
 * not "all of them": each rung is one selector.
 */
export const ANIMATION_STAGGER_MAX_CHILDREN = 24

/** Base class every animated element carries. */
export const ANIMATION_CLASS = 'aglyn-anim'
/**
 * Base class of a STAGGER HOST — an element whose children animate one after
 * another instead of the element itself animating.
 *
 * It is a different base class rather than a modifier on {@link
 * ANIMATION_CLASS} because the two are mutually exclusive by construction: an
 * element carrying both would play its own entrance AND run its children's,
 * which is two overlapping fades on the same pixels. The preset and easing
 * modifiers are shared, and reach the children through custom-property
 * inheritance — the host sets `--aglyn-anim-name`, every child reads it, and
 * the stylesheet needs no per-preset child rule.
 */
export const ANIMATION_GROUP_CLASS = 'aglyn-anim-group'
/** Per-preset modifier, e.g. `aglyn-anim--slide-up`. */
export const ANIMATION_PRESET_CLASS_PREFIX = 'aglyn-anim--'
/** Per-easing modifier, e.g. `aglyn-anim-ease--overshoot`. */
export const ANIMATION_EASE_CLASS_PREFIX = 'aglyn-anim-ease--'
/** Added by the scroll runtime once an element has entered the viewport. */
export const ANIMATION_IN_CLASS = 'aglyn-anim--in'
/**
 * Set on `<html>` by the inline runtime. Every rule that HIDES a
 * scroll-triggered element before it plays is scoped under this class, so a
 * visitor with no JS — and every crawler — sees the un-animated, VISIBLE
 * state. Nothing is ever hidden by the server.
 */
export const ANIMATION_READY_CLASS = 'aglyn-anim-js'

/** Trigger attribute the stylesheet and the runtime both select on. */
export const ANIMATION_TRIGGER_ATTR = 'data-aglyn-anim-trigger'
/** Repeat attribute the runtime reads; `'1'` means re-play. */
export const ANIMATION_REPEAT_ATTR = 'data-aglyn-anim-repeat'

/** Custom properties carrying the author's dials. */
export const ANIMATION_DURATION_VAR = '--aglyn-anim-duration'
export const ANIMATION_DELAY_VAR = '--aglyn-anim-delay'
/** Set on a stagger host; every child reads it through inheritance. */
export const ANIMATION_STAGGER_STEP_VAR = '--aglyn-anim-step'
/**
 * Set on each child BY the stylesheet's nth-child ladder, not by the
 * renderer — the renderer never sees a child's index, and asking it to would
 * mean the host re-rendering whenever a sibling was inserted.
 */
export const ANIMATION_STAGGER_OFFSET_VAR = '--aglyn-anim-stagger'

/**
 * Clamp a millisecond dial. `strictNullChecks` is OFF repo-wide and `0` is a
 * legitimate delay, so this tests for a finite number rather than
 * truthiness — `if (!delay)` would silently discard a deliberate `0` and,
 * worse, treat it as "not set" and substitute the default.
 */
function clampMs(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, 0), max)
}

export interface ResolvedElementAnimation {
  preset: AnimationPreset
  trigger: AnimationTrigger
  ease: AnimationEase
  durationMs: number
  delayMs: number
  repeat: boolean
  /** True when the CHILDREN animate in sequence rather than this element. */
  stagger: boolean
  staggerStepMs: number
  /** Classes to append to the element. */
  className: string
  /** DOM attributes the stylesheet and runtime select on. */
  attributes: Record<string, string>
  /** Custom properties, merged into the element's inline style. */
  style: Record<string, string>
}

/**
 * Reads the reserved animation props off a node's resolved props and returns
 * the class/attribute/style triple the renderer applies — or `undefined` when
 * the node does not animate, which is the overwhelmingly common case and
 * costs one property read.
 *
 * Unknown preset and trigger values resolve to "no animation" rather than
 * being passed through: these strings reach a `data-` attribute and a class
 * name, and a screen document authored against a future preset must degrade
 * to a static element, never to a broken selector.
 */
export function resolveElementAnimation(
  props: Record<string, any> | undefined,
): ResolvedElementAnimation | undefined {
  const preset = props?.[NODE_ANIMATION_PROP]
  if (typeof preset !== 'string' || preset === ANIMATION_NONE) return undefined
  if (!(ANIMATION_PRESETS as readonly string[]).includes(preset)) return undefined

  const rawTrigger = props?.[NODE_ANIMATION_TRIGGER_PROP]
  const trigger = (
    typeof rawTrigger === 'string' &&
    (ANIMATION_TRIGGERS as readonly string[]).includes(rawTrigger)
      ? rawTrigger
      : ANIMATION_DEFAULT_TRIGGER
  ) as AnimationTrigger

  const durationMs = clampMs(
    props?.[NODE_ANIMATION_DURATION_PROP],
    ANIMATION_DEFAULT_DURATION_MS,
    ANIMATION_MAX_DURATION_MS,
  )
  const delayMs = clampMs(
    props?.[NODE_ANIMATION_DELAY_PROP],
    ANIMATION_DEFAULT_DELAY_MS,
    ANIMATION_MAX_DELAY_MS,
  )
  const rawEase = props?.[NODE_ANIMATION_EASE_PROP]
  const ease = (
    typeof rawEase === 'string' &&
    (ANIMATION_EASINGS as readonly string[]).includes(rawEase)
      ? rawEase
      : ANIMATION_DEFAULT_EASE
  ) as AnimationEase

  // Repeat only means anything for the scroll trigger — `load` fires once by
  // definition and `hover` is a transition, not a keyframe run.
  const repeat = trigger === 'scroll' && Boolean(props?.[NODE_ANIMATION_REPEAT_PROP])

  // Stagger is refused for `hover` on purpose. A hover effect is a transition
  // that must reverse the instant the pointer leaves; a staggered one would
  // leave half a row mid-flight, and the ladder below only ever feeds
  // `animation-delay`, which a transition does not read.
  const stagger =
    trigger !== 'hover' && Boolean(props?.[NODE_ANIMATION_STAGGER_PROP])
  const staggerStepMs = stagger
    ? clampMs(
        props?.[NODE_ANIMATION_STAGGER_STEP_PROP],
        ANIMATION_DEFAULT_STAGGER_STEP_MS,
        ANIMATION_MAX_STAGGER_STEP_MS,
      )
    : 0

  const attributes: Record<string, string> = {
    [ANIMATION_TRIGGER_ATTR]: trigger,
  }
  if (repeat) attributes[ANIMATION_REPEAT_ATTR] = '1'

  const style: Record<string, string> = {
    [ANIMATION_DURATION_VAR]: `${durationMs}ms`,
    [ANIMATION_DELAY_VAR]: `${delayMs}ms`,
  }
  // Written only for a stagger host, so a plain animated element's inline
  // style is byte for byte what it was before this shipped.
  if (stagger) style[ANIMATION_STAGGER_STEP_VAR] = `${staggerStepMs}ms`

  return {
    preset: preset as AnimationPreset,
    trigger,
    ease,
    durationMs,
    delayMs,
    repeat,
    stagger,
    staggerStepMs,
    className: `${stagger ? ANIMATION_GROUP_CLASS : ANIMATION_CLASS} ${
      ANIMATION_PRESET_CLASS_PREFIX
    }${preset} ${ANIMATION_EASE_CLASS_PREFIX}${ease}`,
    attributes,
    style,
  }
}

/**
 * True when a node's props ask for a real animation. Cheap enough to run over
 * every node in a screen's flat node map, which is how the tenant decides
 * whether to ship the stylesheet at all.
 */
export function nodePropsAnimate(props: Record<string, any> | undefined): boolean {
  const preset = props?.[NODE_ANIMATION_PROP]
  return (
    typeof preset === 'string' &&
    preset !== ANIMATION_NONE &&
    (ANIMATION_PRESETS as readonly string[]).includes(preset)
  )
}
