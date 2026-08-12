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
import { mdiGestureTapButton } from '@aglyn/shared-data-mdi'
import { getMdiIconPath } from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import Button, { type ButtonProps } from '@mui/material/Button'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { dropClearedProps } from '../utils/drop-cleared-props'
import {
  FIELD_COLOR,
  FIELD_DISABLED,
  FIELD_FULL_WIDTH,
  FIELD_SIZE,
  FIELD_TEXT_CONTENT,
} from '../constants/field-presets'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; keep the legacy ids.
export const ID: Aglyn.ComponentId = 'muiButton'

export interface LinkableButtonProps extends ButtonProps {
  /** Target screen id; resolved from the routing map (AGL-139). */
  screenId?: string
  /** External URL, used only when no `screenId` is set. */
  href?: string
  /** mdi icon id rendered before the label (AGL-146). */
  startIconId?: string
  /** mdi icon id rendered after the label (AGL-146). */
  endIconId?: string
  /** Resolved SVG path for `startIconId`, stored at author time (AGL-1212). */
  startIconPath?: string
  /** Resolved SVG path for `endIconId`, stored at author time (AGL-1212). */
  endIconPath?: string
  /**
   * What the LINK MODE announces as (AGL-1426). Persisted in screen
   * documents; never rename, and `undefined` must keep meaning `'button'` —
   * every button authored before this existed is one.
   *
   * - `'button'` (or unset) — `<a role="button">` with the button's look.
   * - `'linkButton'` — a plain `<a>` with NO role, keeping the button's
   *   `variant`/`size`/`fullWidth`. Appearance without semantics.
   *
   * There is no `'link'` value here: a plain text link is `muiScreenLink`'s
   * job, and this component's whole purpose is the button styling.
   */
  renderAs?: 'button' | 'linkButton'
}

/**
 * What a button-styled LINK renders as while navigation is suppressed
 * (besigner canvas, preview). `role: undefined` is the load-bearing half:
 * MUI's `ButtonBase` stamps `role="button"` onto any non-`<button>` root,
 * and merges the caller's props AFTER its own, so an explicit `undefined`
 * is what removes it. Mirrors `screen-link.tsx` (AGL-1347).
 */
const STYLED_LINK_PLACEHOLDER = { component: 'span', role: undefined } as const

/**
 * mdi id → icon element; unknown/empty ids render nothing.
 *
 * Prefers the persisted path (AGL-1212) so render surfaces never need the
 * ~2.9 MB catalog, and falls back to the catalog for buttons authored before
 * paths were stored. `getMdiIconPath` rather than `getMdiIconFromId`: the
 * latter substitutes `DEFAULT_ICON`, which has a real path, so a miss used to
 * render a "help" glyph instead of nothing.
 */
function iconFromId(iconId?: string, iconPath?: string) {
  const path = iconPath || getMdiIconPath(iconId)
  return path ? <MdiIcon path={path} fontSize="small" /> : undefined
}

/**
 * Button with optional link mode (AGL-139): a screen id or external URL
 * renders through AppLink exactly like the Screen Link component —
 * degrading to a plain button in the besigner/preview and when the id
 * doesn't resolve.
 *
 * Resolution (id-vs-URL precedence, protocol hardening) is `useLinkTarget`
 * so a `Link`-typed component prop bound into EITHER field resolves the
 * same way here as in Screen Link, Link Box and Image (AGL-1335).
 *
 * `renderAs="linkButton"` splits appearance from semantics in that link mode
 * (AGL-1426), the same split `screen-link.tsx` got in AGL-1347. The 12 chips
 * in "Dig in, or just say hello" on `aglyn.com/` are Buttons, not Screen
 * Links: docs URLs, `mailto:` and social profiles, every one of them purely
 * navigating, and every one announcing as a button — which tells a
 * screen-reader user to expect an action and costs them the link list and
 * the open-in-new-tab affordance. This mode keeps the `variant`/`size`/
 * `fullWidth` pixels and drops the role, exactly as MUI's own
 * `Button component={Link}` does.
 *
 * It only touches the link branch. A Button with no link target is a genuine
 * `<button>` whose role is correct, so the value is inert there.
 */
const LinkableButton = forwardRef<any, LinkableButtonProps>((props, ref) => {
  const {
    screenId,
    href: externalHref,
    startIconId,
    endIconId,
    startIconPath,
    endIconPath,
    renderAs,
    ...spread
  } = props
  // A CLEARED attribute persists as null, and null is not "use the default"
  // in React — `color={null}` reaches MUI, which capitalizes it and throws
  // error #7 during SSR, 500ing the page (AGL-1226).
  const rest = dropClearedProps(spread)
  const iconProps = {
    startIcon: iconFromId(startIconId, startIconPath),
    endIcon: iconFromId(endIconId, endIconPath),
  }
  const { href, suppressNavigation } = Aglyn.useLinkTarget(
    screenId,
    externalHref,
  )
  // Semantics and appearance are independent choices now (AGL-1426): a
  // styled link takes the button's styling props and none of its role.
  const asStyledLink = renderAs === 'linkButton'

  if (!href || suppressNavigation) {
    // The canvas must not lie about which element the page will ship, so a
    // suppressed styled link mirrors the live shape. Gated on `href` unlike
    // `screen-link.tsx`: there, no target still means a link, but here it
    // means a genuine button, which must keep being a real `<button>`.
    return (
      <Button
        ref={ref}
        {...(asStyledLink && href ? STYLED_LINK_PLACEHOLDER : {})}
        {...iconProps}
        {...rest}
      />
    )
  }
  return (
    <AppLink
      ref={ref}
      componentVariant="button"
      href={href}
      // The whole defect in one attribute. `ButtonBase` adds `role="button"`
      // to every non-`<button>` root, so the button LOOK used to drag the
      // button ROLE onto a navigating anchor. It spreads the caller's props
      // after its own, so passing `undefined` here is what clears it — and
      // only for the mode that asked to be a link. `'button'` is what
      // `ButtonBase` stamps anyway, so nothing already authored moves.
      role={asStyledLink ? undefined : 'button'}
      {...iconProps}
      {...rest}
    />
  )
})
LinkableButton.displayName = 'LinkableButton'

export const schema: Aglyn.ComponentSchema<LinkableButtonProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Button',
  category: Aglyn.ComponentCategory.INPUT,
  icon: {
    path: mdiGestureTapButton.path,
    sx: { color: '#2196f3' },
  },
  flags: {
    textEditable: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    FIELD_TEXT_CONTENT,
    FIELD_COLOR,
    FIELD_DISABLED,
    FIELD_FULL_WIDTH,
    FIELD_SIZE,
    {
      name: 'variant',
      description: 'The variant to use.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Variant',
      // "Default" deleted (AGL-1453): it could not persist, and `text` — the
      // value it resolved to, MUI's own default — is already on the list.
      options: [
        { value: 'text', label: 'Text' },
        { value: 'outlined', label: 'Outlined' },
        { value: 'contained', label: 'Contained' },
      ],
    },
    {
      name: 'screenId',
      description:
        'Optional: navigate to this screen when clicked — the address ' +
        'follows the published path like a Screen Link (AGL-139).',
      component: Aglyn.FieldComponentType.SCREEN_SELECT,
      label: 'Link to screen',
    },
    {
      name: 'href',
      description: 'External URL used only when no screen is selected.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'External URL',
    },
    {
      name: 'renderAs',
      description:
        'What this announces as once it links somewhere. Button is for ' +
        'calls to action; pick "Link (button styling)" for a chip that only ' +
        'navigates, so it keeps this look but announces as the link it is. ' +
        'Ignored when there is no screen or URL to point at.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Render as',
      // `'button'` is a REAL SENTINEL, not a deletion (AGL-1453). Unlike the
      // "Default" options on this component, `''` here spelled an author's
      // actual choice, and one they could not make: the attributes form
      // strips `''` before save (AGL-1191), so a button switched to Link
      // (button styling) had no route in this dropdown back to Button — the
      // pick reverted and the stored `linkButton` stayed.
      //
      // Safe because `renderAs` never reaches MUI: it is destructured out
      // above and read only as `renderAs === 'linkButton'`. So `'button'` and
      // an absent value take the identical branch, which is also what keeps
      // every button authored before this existed rendering unchanged.
      options: [
        { value: 'button', label: 'Button' },
        { value: 'linkButton', label: 'Link (button styling)' },
      ],
    },
    {
      name: 'startIconId',
      description: 'Icon shown before the label.',
      component: Aglyn.FieldComponentType.ICON_PICKER,
      label: 'Start icon',
    },
    {
      name: 'endIconId',
      description: 'Icon shown after the label.',
      component: Aglyn.FieldComponentType.ICON_PICKER,
      label: 'End icon',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Outlined Button',
    icon: {
      path: mdiGestureTapButton.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.INPUT,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {
        variant: 'outlined',
        children: 'Click Me',
      },
    },
  },
]

export default LinkableButton
