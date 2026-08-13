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
import { mdiLinkVariant } from '@aglyn/shared-data-mdi'
import { AppLink } from '@aglyn/shared-ui-jsx'
import Button, { type ButtonProps } from '@mui/material/Button'
import Link from '@mui/material/Link'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  FIELD_COLOR,
  FIELD_FULL_WIDTH,
  FIELD_SIZE,
  FIELD_TEXT_CONTENT,
} from '../constants/field-presets'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'muiScreenLink'

export interface ScreenLinkProps extends ButtonProps {
  /**
   * Target screen id. The href is resolved from the host routing map at
   * render time (see `ScreenLinkContext`), so slug renames and re-parenting
   * never break the link — which is what makes navigation inside a shared
   * layout viable.
   */
  screenId?: string
  /** External URL escape hatch, used only when no `screenId` is set. */
  href?: string
  /**
   * Which element this ships as (AGL-1195, AGL-1347). Persisted in screen
   * documents; never rename, and `undefined` must keep meaning `'button'` —
   * every link authored before this existed is one.
   *
   * - `'button'` (or unset) — `<a role="button">` with the button's look.
   * - `'link'` — a plain text link; the button-only props are dropped.
   * - `'linkButton'` — a plain `<a>` with NO role, wearing the button's
   *   `variant`/`size`/`fullWidth`. Appearance without semantics: a pill
   *   that navigates announces as the link it is.
   */
  renderAs?: 'button' | 'link' | 'linkButton'
}

/**
 * What a button-styled LINK renders as with nothing to point at (canvas,
 * preview, unresolved screen). `role: undefined` is the load-bearing half:
 * MUI's `ButtonBase` stamps `role="button"` onto any non-`<button>` root,
 * and merges the caller's props AFTER its own, so an explicit `undefined`
 * is what removes it.
 */
const STYLED_LINK_PLACEHOLDER = { component: 'span', role: undefined } as const

/**
 * Link that targets a screen by id, never a hardcoded path. Degrades to a
 * plain button when the id doesn't resolve (unpublished/deleted screen) and
 * when navigation is suppressed (besigner canvas, preview).
 *
 * `renderAs="link"` renders MUI's `Link` instead of `Button` (AGL-1195).
 * Footer and inline navigation are *text*: as buttons they inherit button
 * typography, uppercase transforms and the wrong role for assistive tech.
 * The button-only props are dropped in that mode rather than passed through
 * — `variant` means the typography variant on a `Link`, so forwarding
 * `"contained"` would silently produce an unstyled element.
 *
 * `renderAs="linkButton"` splits the two halves that used to travel together
 * (AGL-1347). A pill row whose chips all navigate — docs URLs, `mailto:`,
 * social profiles — is a legitimate design, but every chip announced as a
 * button, which tells a screen-reader user to expect an action and costs
 * them the link-list and open-in-new-tab affordances. This mode keeps the
 * button's `variant`/`size`/`fullWidth` and drops the role, exactly as MUI's
 * own `Button component={Link}` does. It is a THIRD value rather than
 * `variant` becoming live in `"link"` mode, because a node switched to Text
 * link keeps whatever `variant` it was authored with (the shipped preset is
 * `variant: 'outlined'`) — honouring those would repaint the site's nav and
 * footer as outlined pills.
 */
const ScreenLink = forwardRef<any, ScreenLinkProps>((props, ref) => {
  const { screenId, href: externalHref, renderAs, ...spread } = props
  // A CLEARED attribute persists as null, and null is not "use the default"
  // in React — `color={null}` reaches MUI, which capitalizes it and throws
  // error #7 during SSR, 500ing the page (AGL-1226). This is the site's
  // most-used element (70–77 nodes per page), so the guard runs BEFORE
  // `variant`/`size`/`fullWidth` are split out: they are forwarded as named
  // attributes, and guarding only the spread would leave those three exposed.
  const { variant, size, fullWidth, ...rest } = dropClearedProps(spread)
  // Id-vs-URL precedence and the `javascript:`/`data:` guard live in
  // `useLinkTarget` (AGL-1335) — one copy for every linking element, and
  // the only place that knows a `screen:`-prefixed value is a reference.
  const { href, suppressNavigation } = Aglyn.useLinkTarget(
    screenId,
    externalHref,
  )
  const asLink = renderAs === 'link'
  // Semantics and appearance are independent choices now (AGL-1347): a
  // styled link takes the button's styling props and none of its role.
  const asStyledLink = renderAs === 'linkButton'

  if (!href || suppressNavigation) {
    // The canvas must not lie about which element the page will ship, so
    // the unresolved/suppressed case mirrors the same three shapes.
    if (asLink) {
      return <Link ref={ref} component="span" underline="hover" {...rest} />
    }
    return (
      <Button
        ref={ref}
        {...(asStyledLink ? STYLED_LINK_PLACEHOLDER : {})}
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        {...rest}
      />
    )
  }
  return asLink ? (
    <AppLink ref={ref} underline="hover" href={href} {...rest} />
  ) : (
    <AppLink
      ref={ref}
      componentVariant="button"
      href={href}
      // The whole defect in one attribute. `ButtonBase` adds `role="button"`
      // to every non-`<button>` root, so the button LOOK used to drag the
      // button ROLE onto a navigating anchor. It spreads the caller's props
      // after its own, so passing `undefined` here is what clears it — and
      // only for the mode that asked to be a link.
      role={asStyledLink ? undefined : 'button'}
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      {...rest}
    />
  )
})
ScreenLink.displayName = 'ScreenLink'

/**
 * Shows an attribute in the two modes that wear button styling — Button and
 * Link (button styling). `notMatch` inverts `is`, so an unset `renderAs` —
 * every link authored before AGL-1195 — still counts as a button and keeps
 * its controls, and only Text link hides them.
 */
const BUTTON_STYLED = { when: 'renderAs', is: 'link', notMatch: true }

export const schema: Aglyn.ComponentSchema<ScreenLinkProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Screen Link',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: {
    path: mdiLinkVariant.path,
    sx: { color: '#2196f3' },
  },
  flags: {
    textEditable: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    FIELD_TEXT_CONTENT,
    {
      name: 'screenId',
      description:
        'Screen this link navigates to. The address is generated from the ' +
        'published path at render time, so it keeps working when the ' +
        "screen's slug or parent changes.",
      component: Aglyn.FieldComponentType.SCREEN_SELECT,
      label: 'Screen',
    },
    {
      name: 'href',
      description: 'External URL used only when no screen is selected above.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'External URL',
    },
    {
      name: 'renderAs',
      description:
        'What this announces as. Button is for calls to action; both link ' +
        'options announce as a link, which is what navigation should be — ' +
        'pick "Link (button styling)" to keep the button look on something ' +
        'that navigates.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Render as',
      // `'button'` is a REAL SENTINEL, not a deletion (AGL-1453): `''` here
      // spelled an author's actual choice, and the one they could not make.
      // The attributes form strips `''` before save (AGL-1191), so a link
      // switched to Text link had NO route in this dropdown back to Button —
      // and 213 of the 326 Screen Links in the corpus are in that mode.
      //
      // Safe because `renderAs` never reaches MUI: it is destructured out
      // above and read only as `=== 'link'` / `=== 'linkButton'`, so
      // `'button'` and an absent value take the identical branch. That is
      // also what keeps every link authored before AGL-1195 rendering
      // unchanged.
      options: [
        { value: 'button', label: 'Button' },
        { value: 'link', label: 'Text link' },
        { value: 'linkButton', label: 'Link (button styling)' },
      ],
    },
    // `color` survives both shapes — MUI's Link takes it too.
    FIELD_COLOR,
    // The rest are appearance: the renderer drops them in Text link mode, so
    // leaving them on screen there would offer three controls that silently
    // do nothing — but they are live in Link (button styling), which is the
    // point of that mode. Spread rather than mutate — these presets are
    // shared.
    { ...FIELD_SIZE, condition: BUTTON_STYLED },
    { ...FIELD_FULL_WIDTH, condition: BUTTON_STYLED },
    {
      name: 'variant',
      description: 'The variant to use.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Variant',
      // "Default" deleted (AGL-1453): unpersistable, and a second name for
      // `text`, MUI Button's own default, already on the list.
      options: [
        { value: 'text', label: 'Text' },
        { value: 'outlined', label: 'Outlined' },
        { value: 'contained', label: 'Contained' },
      ],
      condition: BUTTON_STYLED,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Screen Link',
    icon: {
      path: mdiLinkVariant.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.NAVIGATION,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {
        children: 'Screen Link',
        // Same visible-on-any-surface defaults as the button preset; the
        // default text color disappears against a same-hue appbar.
        variant: 'outlined',
        color: 'inherit',
      },
    },
  },
]

export default ScreenLink
