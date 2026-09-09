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

import {
  NODE_ANIMATION_DELAY_PROP,
  NODE_ANIMATION_DURATION_PROP,
  NODE_ANIMATION_EASE_PROP,
  NODE_ANIMATION_PROP,
  NODE_ANIMATION_REPEAT_PROP,
  NODE_ANIMATION_STAGGER_PROP,
  NODE_ANIMATION_STAGGER_STEP_PROP,
  NODE_ANIMATION_TRIGGER_PROP,
} from './element-animation'

/**
 * The persisted keys, id prefixes and prop names of a reusable-component
 * instance.
 *
 * A separate module from the graft that reads them because these are the part
 * every OTHER surface needs: the renderer reads the two visibility directives,
 * the element-id helpers read the graft prefix, and the canvas reads the
 * instance component id. `compose-reusable-components.ts` beside it is the
 * composition itself — the graft, the prune, detach, and the reference walk —
 * which only an authoring surface and the server-side compose ever run, and
 * which a bundler cannot drop around a named import of one constant.
 *
 * Every value here is persisted in screen or component documents. Never
 * rename one.
 */

/**
 * Persisted component id of a reusable-component instance node. Persisted in
 * screen documents — never rename (cf. `layoutSlot`, legacy `muiXxx` ids).
 */
export const REUSABLE_INSTANCE_COMPONENT_ID = 'reusableInstance'

/**
 * Prop key on an instance node holding its per-instance prop values, keyed
 * by declared prop name (AGL-1247).
 *
 * Nested under one key rather than spread across the instance's own props
 * so a prop named `refId` or `name` cannot shadow the reference itself, and
 * so the string-prop walkers (`resolveNodesBindings`, the sanitizers) skip
 * the whole object — values reach a page only through the graft below.
 */
export const REUSABLE_INSTANCE_PROP_VALUES_KEY = 'propValues'

/**
 * `styleOverrides` key addressing the component ROOT (AGL-1306). Persisted
 * in screen documents — never rename. Component-internal node ids key the
 * per-leaf overrides beside it (AGL-1332); the definition root is addressed
 * by this constant rather than its id so the same override survives a
 * republish that reroots the definition.
 */
export const STYLE_OVERRIDES_ROOT_KEY = 'root'

/**
 * Node-level fields that ride from the instance onto the definition's root
 * when the two collapse into one element (AGL-2521).
 *
 * These sit beside `sx` on the node, not in `props`, so no renderer spreads
 * them at an element and carrying them costs nothing in the DOM. They are
 * document state the author set on THIS placement: dropping them would make a
 * composed map that is saved back lose every per-instance override.
 */
export const INSTANCE_CARRIED_NODE_FIELDS: readonly string[] = [
  'styleOverrides',
  'attrOverrides',
]

/**
 * Token namespace a definition uses to reference its own declared props:
 * `{{prop.headline}}`. Mirrors `{{entry.*}}` and `{{host.*}}` so authors
 * meet one token syntax, not a second one invented for components.
 */
export const COMPONENT_PROP_TOKEN_PREFIX = 'prop.'

/**
 * Declared prop names must be plain identifiers (AGL-1247).
 *
 * Load-bearing rather than cosmetic, which is why it lives beside the
 * storage contract instead of in whichever form happens to edit it: the
 * Attributes panel names its field for the nested path
 * `propValues.<name>`, and final-form splits that on dots — so a prop
 * called `hero.title` would address a level that does not exist and its
 * value would silently never reach the node. The editor that declares
 * props and the panel that fills them in must agree on this, so they read
 * the same constant.
 */
export const COMPONENT_PROP_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Prefix namespacing a grafted definition's node ids per instance, so the
 * same definition can appear many times in one tree without id collisions.
 */
export const COMPONENT_NODE_ID_PREFIX = 'cmp__'

/**
 * Node prop a definition sets to drop part of itself when a value is
 * TRUTHY (AGL-1314) — the "hide the mockup" toggle: the hero's media
 * column carries `hideIf: '{{prop.hideMedia}}'`, and a page that wants no
 * illustration ticks one checkbox.
 *
 * Persisted in component documents — never rename.
 */
export const NODE_HIDE_IF_PROP = 'hideIf'

/**
 * The other polarity (AGL-1314): drop the node when the value is FALSY.
 *
 * This is what keeps an unfinished CTA from shipping as a dead control. A
 * button whose link is unset renders as a labelled thing you can tab to
 * that goes nowhere — seven of them nearly shipped in the footer
 * (AGL-1348). Binding `hideUnless: '{{prop.secondaryCtaLink}}'` on the
 * button means "no destination, no button": the node is gone before any
 * renderer sees it, so there is no anchor, no `<button>`, and no keyboard
 * stop.
 *
 * Note what it is bound to: the AUTHORED prop value, never whether a
 * screen id RESOLVES. Resolution happens later (`useLinkTarget`) against
 * the screens map, and the map behind an ISR render is not the map behind
 * the hydration that follows it — pruning on resolution would be the
 * element-switch hazard AGL-1357 lints for, one level up the pipeline.
 * Prop values ride in the page document, so server and client prune
 * identically.
 *
 * Persisted in component documents — never rename.
 */
export const NODE_HIDE_UNLESS_PROP = 'hideUnless'

/**
 * Instance props that move onto the definition's root when the two collapse
 * into one element (AGL-2521).
 *
 * The universal directives, and only those: they are authored against "this
 * placement", which after the collapse IS the root. Everything else an
 * instance carries — `refId`, `name`, {@link REUSABLE_INSTANCE_PROP_VALUES_KEY},
 * the override slices — is bookkeeping the graft has already consumed, and
 * spreading it onto a real element is how `propvalues="[object Object]"`
 * reached a published page once before (AGL-2486).
 *
 * Listed rather than derived by exclusion: a new instance-only prop must not
 * start leaking onto every component's root because nobody remembered to add
 * it to a deny-list.
 */
export const INSTANCE_CARRIED_PROPS: readonly string[] = [
  NODE_HIDE_IF_PROP,
  NODE_HIDE_UNLESS_PROP,
  NODE_ANIMATION_PROP,
  NODE_ANIMATION_TRIGGER_PROP,
  NODE_ANIMATION_DURATION_PROP,
  NODE_ANIMATION_DELAY_PROP,
  NODE_ANIMATION_REPEAT_PROP,
  NODE_ANIMATION_EASE_PROP,
  NODE_ANIMATION_STAGGER_PROP,
  NODE_ANIMATION_STAGGER_STEP_PROP,
]
