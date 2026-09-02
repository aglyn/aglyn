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

import * as Aglyn from '@aglyn/aglyn'
import { mdiPackageVariant } from '@aglyn/shared-data-mdi'
import Box, { type BoxProps } from '@mui/material/Box'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'

// Persisted in screen documents; never rename (see AGL-34 ADR).
export const ID: Aglyn.ComponentId = Aglyn.REUSABLE_INSTANCE_COMPONENT_ID

/**
 * Elements an instance may render as (AGL-2514).
 *
 * The wrapper is the outermost element of every placed component, so it is
 * where a site's chrome becomes a landmark: a Site nav instance set to
 * `header` and a Site footer instance set to `footer` give the page the two
 * regions `main` is defined against. Before this it was a hardcoded `div`,
 * and no attribute anywhere on the instance could change that — a definition
 * whose own root is an App Bar or a Section could emit a landmark inside the
 * wrapper, but a definition rooted in anything else could not emit one at
 * all.
 *
 * ⛔ `main` IS NOT ONE OF THEM. A published page carries exactly one, placed
 * by `stampDocumentLandmark` on the Document layer or the Layout Slot; an
 * instance may be placed any number of times per page, so an author-selected
 * `main` here could only ever produce a second one. Same exclusion, and the
 * same reason, as `SECTION_ELEMENTS`.
 *
 * An allow-list rather than free text: the value is persisted and rendered
 * verbatim, so a typed one would put `script` into every visitor's page.
 */
export const REUSABLE_INSTANCE_ELEMENTS = [
  'div',
  'header',
  'footer',
  'nav',
  'aside',
  'section',
  'article',
] as const
export type ReusableInstanceElement =
  (typeof REUSABLE_INSTANCE_ELEMENTS)[number]

export interface ReusableInstanceProps extends Omit<BoxProps, 'component'> {
  /**
   * The DOM element the instance renders as; defaults to `div`. Unknown
   * values degrade to `div` rather than reaching the DOM as an invented tag.
   *
   * Named `component` like Box's, Typography's and the Layout Slot's, not
   * `element` like Section's: the attribute means the same thing everywhere
   * it appears. Narrower than the `ElementType` Box accepts — a canvas
   * attribute is a persisted STRING, and an allow-list is what keeps
   * `script` out of it — so `BoxProps`' own `component` is omitted rather
   * than widened.
   */
  component?: ReusableInstanceElement | string
  /** Definition id in `hosts/{hostId}/components`; grafted at render time. */
  refId?: string
  /**
   * The definition's display name, carried on the instance purely so the
   * editor placeholder can say which component this stands for (AGL-1193).
   * Never rendered on production surfaces, where the graft fills the box.
   */
  name?: string
  /**
   * This instance's declared-prop overrides (AGL-1247). Addressed to the
   * GRAFT, which reads it off the stored node to substitute `{{prop.*}}`
   * inside its private copy of the definition — the wrapper element itself
   * has no use for it, and it is stripped below rather than spread.
   */
  propValues?: Record<string, unknown>
}

/**
 * Wrapper element for a reusable-component instance. On production surfaces
 * the compose step (`composeReusableComponentNodes`) grafts the definition
 * subtree inside, so this renders as a plain container. In the editor the
 * instance has no children (definitions aren't grafted into the editable
 * canvas), so the CSS `:empty` placeholder marks it visibly instead — named,
 * since a layout whose chrome has been promoted is otherwise nothing but
 * indistinguishable dashed boxes.
 */
const ReusableInstance = forwardRef<any, ReusableInstanceProps>(
  (props, ref) => {
    const {
      refId: _refId,
      name,
      // Instance-scoped directives, not element attributes. `refId` and
      // `name` were always stripped; `propValues` was not, so the author's
      // overrides spread onto the Box and reached the DOM — React logs
      // "does not recognize the `propValues` prop" on the canvas, and a
      // published page serialised the same copy a second time as
      // `propvalues="[object Object]"` on the wrapper (AGL-2486).
      //
      // Stripped HERE rather than in the graft because the canvas renders
      // an instance the graft has not touched (definitions are not grafted
      // into the editable canvas), so a strip upstream would fix the
      // published page and leave the editor warning on every render.
      [Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY]: _propValues,
      children,
      sx,
      component,
      ...rest
    } = props
    // Unknown values degrade to `div` rather than reaching the DOM as an
    // invented tag — the resolver pattern `Section` uses.
    const element = (
      REUSABLE_INSTANCE_ELEMENTS as readonly string[]
    ).includes(String(component ?? ''))
      ? (component as ReusableInstanceElement)
      : 'div'
    return (
      <Box
        ref={ref}
        component={element}
        // `content: attr()` rather than a child, so the box stays `:empty`
        // and the placeholder cannot be mistaken for grafted content.
        data-aglyn-component={name || 'Reusable component'}
        sx={[
          {
            '&:empty': {
              minHeight: 56,
              m: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: 'divider',
              borderRadius: 1,
            },
            '&:empty::after': {
              content: 'attr(data-aglyn-component)',
              color: 'text.secondary',
              fontSize: 12,
              letterSpacing: 1,
              textTransform: 'uppercase',
            },
          },
          ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        ]}
        {...rest}
      >
        {children}
      </Box>
    )
  },
)
ReusableInstance.displayName = 'ReusableInstance'

export const schema: Aglyn.ComponentSchema<ReusableInstanceProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Reusable Component',
  description:
    'Where a reusable component is placed. Edit the component once and every instance follows.',
  category: Aglyn.ComponentCategory.SURFACE,
  icon: {
    path: mdiPackageVariant.path,
    sx: { color: '#9c27b0' },
  },
  flags: {
    // Instances are opaque: their content lives in the definition, so
    // nothing may be dropped inside from the canvas.
    dropping: Aglyn.FEATURE_FLAG.DISABLED,
  },
  attributes: [
    {
      name: 'component',
      label: 'Component',
      description:
        'The DOM element this placement renders as. Use header for a site ' +
        'nav and footer for a site footer, so the page keeps the landmarks ' +
        'assistive tech navigates by. "main" is not offered — the page’s ' +
        'content region carries that one.',
      component: Aglyn.FieldComponentType.SELECT,
      options: REUSABLE_INSTANCE_ELEMENTS.map((value) => ({
        value,
        label: value,
      })),
    },
  ],
}

/**
 * No static presets: instances are inserted from per-host definitions, which
 * the console registers dynamically (category "Your components").
 */
export const presets: Aglyn.PresetSchema[] = []

export default ReusableInstance
