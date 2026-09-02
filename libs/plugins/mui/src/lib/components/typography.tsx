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
import {
  mdiAlphabetical,
  mdiFormatHeader1,
  mdiFormatHeader2,
  mdiFormatHeader3,
  mdiFormatHeader4,
  mdiFormatHeader5,
  mdiFormatHeader6,
  mdiFormatText,
} from '@aglyn/shared-data-mdi'
import Typography, { type TypographyProps } from '@mui/material/Typography'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { FIELD_TEXT_CONTENT } from '../constants/field-presets'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; keep the legacy ids.
export const ID: Aglyn.ComponentId = 'muiTypography'
// The brand's own rungs sit alongside MUI's. They were added to the theme
// (AGL-1308 for the body scale, for the display rung) but never to
// this list, so the only way to reach one was to hand-write its pixels into
// the Styles panel — which is the very thing the tokens exist to stop.
// Display first: the list reads largest to smallest.
const typographyVariants = [
  {
    value: 'displayXl',
    label: 'Display XL',
    icon: { path: mdiFormatHeader1.path },
  },
  { value: 'h1', label: 'Heading 1', icon: { path: mdiFormatHeader1.path } },
  { value: 'h2', label: 'Heading 2', icon: { path: mdiFormatHeader2.path } },
  { value: 'h3', label: 'Heading 3', icon: { path: mdiFormatHeader3.path } },
  { value: 'h4', label: 'Heading 4', icon: { path: mdiFormatHeader4.path } },
  { value: 'h5', label: 'Heading 5', icon: { path: mdiFormatHeader5.path } },
  { value: 'h6', label: 'Heading 6', icon: { path: mdiFormatHeader6.path } },
  {
    value: 'subtitle1',
    label: 'Subtitle 1',
    icon: { path: mdiFormatText.path },
  },
  {
    value: 'subtitle2',
    label: 'Subtitle 2',
    icon: { path: mdiFormatText.path },
  },
  { value: 'body1', label: 'Body 1', icon: { path: mdiFormatText.path } },
  { value: 'body2', label: 'Body 2', icon: { path: mdiFormatText.path } },
  { value: 'lede', label: 'Lede', icon: { path: mdiFormatText.path } },
  { value: 'overline', label: 'Overline', icon: { path: mdiFormatText.path } },
  { value: 'caption', label: 'Caption', icon: { path: mdiFormatText.path } },
  {
    value: 'bodyCompact',
    label: 'Body compact',
    icon: { path: mdiFormatText.path },
  },
  { value: 'micro', label: 'Micro', icon: { path: mdiFormatText.path } },
]

export const schema: Aglyn.ComponentSchema = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Typography',
  description: "A block of text in one of the theme's type styles.",
  category: Aglyn.ComponentCategory.TEXT,
  icon: {
    path: mdiAlphabetical.path,
    sx: { color: '#057822' },
  },
  flags: {
    textEditable: Aglyn.FEATURE_FLAG.ENABLED,
    richTextEditable: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    FIELD_TEXT_CONTENT,
    // FIELD_COLOR,
    {
      name: 'variant',
      description: 'The variant to use.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Variant',
      // "Default" deleted (AGL-1453): unpersistable, and a second name for
      // `body1`, MUI's own default, already in `typographyVariants`.
      options: [...typographyVariants],
    },
    {
      name: 'component',
      description: 'The html element to use.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Component',
      // "Default" deleted rather than given a sentinel (AGL-1453), and this
      // is the prop that shows why a sentinel is not always available: MUI
      // derives the element from `variantMapping[variant]`, so "Default"
      // resolves to a DIFFERENT tag per variant — `h2` for a Heading 2, `p`
      // for Body 1. No single value on this list expresses that, and picking
      // one would pin the tag and change the document outline. Unset is the
      // only thing that means "let the variant decide", and the field's ✕ is
      // how an author says it.
      options: [
        { value: 'h1', label: 'Heading 1' },
        { value: 'h2', label: 'Heading 2' },
        { value: 'h3', label: 'Heading 3' },
        { value: 'h4', label: 'Heading 4' },
        { value: 'h5', label: 'Heading 5' },
        { value: 'h6', label: 'Heading 6' },
        { value: 'p', label: 'Paragraph' },
        { value: 'div', label: 'Div' },
        { value: 'span', label: 'Span' },
      ],
    },
    {
      name: 'align',
      description: 'The text alignment',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Alignment',
      // "Default" deleted (AGL-1453): unpersistable, and a second name for
      // `inherit`, MUI Typography's own default, already on the list.
      options: [
        { value: 'inherit', label: 'Inherit' },
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
        { value: 'justify', label: 'Justified' },
      ],
    },
    {
      name: 'noWrap',
      description: 'If true, the text will not wrap/fold.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Disable wrapping?',
    },
    {
      name: 'gutterBottom',
      description: 'If true, the text will have a space beneath.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Gutter bottom?',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  ...typographyVariants.map((item): Aglyn.PresetSchema => ({
    $id: generatePresetId(ID, item.value),
    type: Aglyn.NodeType.PRESET,
    displayName: item.label,
    pluginId: BUNDLE_ID,
    description: `Element with ${item.label} styles`,
    category: Aglyn.ComponentCategory.TEXT,
    icon: {
      sx: { color: '#057822' },
      ...item.icon,
    },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {
        variant: item.value,
        children: item.label,
      },
    },
  })),
]

/**
 * Typography that renders rich text (AGL-54): when the node carries an
 * `html` prop it renders as innerHTML; otherwise plain `children`.
 *
 * The `html` prop is re-sanitized on EVERY render (AGL-497). The inline
 * editor sanitizes at commit, but screen node props are written directly via
 * the Firebase client SDK, so a host editor can plant arbitrary `html`
 * (bypassing the editor) that would execute on the public site AND in the
 * besigner canvas on app.aglyn.com.
 *
 * The sanitizer is `Aglyn.sanitizeAuthorHtml` (AGL-1901), which needs no DOM
 * and so runs on the server too — the DOMPurify call this replaced could
 * not, which is why the content used to be deferred to an effect and left
 * every rich-text body out of the server response. The allowlist it enforces
 * is a subset of the old DOMPurify config's, pinned pair by pair in
 * `rich-text-hydration.spec.tsx`.
 */
function sanitizeTypographyHtml(html: string): string {
  return Aglyn.sanitizeAuthorHtml(html)
}

/**
 * MUI's own `defaultVariantMapping`, plus its `span` fallback — the element
 * Typography will actually render for a given variant. Copied rather than
 * imported because MUI does not export it; `author-html-round-trip.spec.tsx`
 * asserts this table still matches what MUI actually renders, so a MUI upgrade that
 * changed the mapping fails there rather than silently reopening the
 * reparenting hazard below.
 */
/**
 * The element each variant renders as, and the ONE place that decides
 *.
 *
 * MUI's own `variantMapping` sends `subtitle1` and `subtitle2` to `<h6>`.
 * That is a typographic choice made in a component library, and on a page
 * builder it is a document-outline decision made by somebody who has never
 * seen the page: a subtitle is a label, not a section, and every one on every
 * Aglyn site was silently inserting an `<h6>` into the heading order. It is
 * what Lighthouse's `heading-order` was reporting — a "Open source &
 * self-hostable" card label rendering ahead of the page's own `<h1>`, from a
 * node whose author had selected Subtitle 1 and nothing else.
 *
 * Subtitles render as `<p>` here. An author who wants a heading still says so
 * with the Component field, which is the control for exactly that question
 * and is unchanged.
 *
 * Passed to MUI as `variantMapping` rather than only consulted by
 * `blockSafeComponent`, so the table cannot describe one thing while the
 * element is another.
 */
const VARIANT_ELEMENT: Record<string, string> = {
  h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6',
  subtitle1: 'p', subtitle2: 'p', body1: 'p', body2: 'p', inherit: 'p',
}

/**
 * The element the rich-text body is put INSIDE, which may have to be a
 * `<div>` rather than the one the variant implies (AGL-1901).
 *
 * The parser closes a `<p>` on any block start tag, and a heading on any
 * other heading. So a body with an `<h2>` in it, served inside the `<p>` MUI
 * renders for `body1`, arrives at the browser as
 * `<p class="MuiTypography-root"></p><h2>…</h2>` — the container emptied and
 * the body promoted to a sibling. React then hydrates against a DOM that is
 * not the one it described and reports a mismatch: the live React #418 shape
 * on tenant (AGL-1926), which this change must not add to.
 *
 * This never mattered before because the server `<p>` was EMPTY and the body
 * arrived through an `innerHTML` assignment, which parses in the CONTEXT of
 * the `<p>` and so does not reparent. Serving the body is what makes the
 * container's element type load-bearing.
 *
 * `authorHtmlBreaksContainer` holds the rule, next to the table of tags it
 * depends on. Returns `'div'` to override, or `undefined` to leave MUI's
 * choice alone; the decision is a pure function of props, so the server and
 * the client make it identically.
 */
function blockSafeComponent(
  sanitized: string,
  rest: TypographyProps,
): 'div' | undefined {
  const element =
    (rest.component as string | undefined) ??
    // MUI's own default variant is `body1`, which maps to `p` — the case that
    // matters, since a Typography with no variant set is the shape nearly
    // every rich-text node has. (`paragraph` is gone in MUI v7, so the
    // variant mapping is the only other input.)
    VARIANT_ELEMENT[(rest.variant as string) ?? 'body1'] ??
    'span'
  return Aglyn.authorHtmlBreaksContainer(sanitized, element) ? 'div' : undefined
}

const AglynTypography = forwardRef<
  HTMLElement,
  TypographyProps & { html?: string }
>(function AglynTypography(props, ref) {
  const { html, children, ...spread } = props
  // A cleared `align` persists as null and MUI capitalizes it — an SSR throw
  // that 500s the page (AGL-1226, same shape as the button colour).
  const rest = dropClearedProps(spread)
  const hasHtml = typeof html === 'string' && Boolean(html)
  // Sanitized DURING render, on the server and in the browser alike
  // (AGL-1901). The effect this replaced existed because DOMPurify needs a
  // DOM: the server rendered nothing, so the first client render had to
  // render nothing too or hydration would mismatch (AGL-1268) — the two
  // sides agreed only by both being empty, and the body never reached a
  // crawler. `sanitizeAuthorHtml` is a pure function of the string with no
  // DOM dependency, so both sides now compute the same bytes from the same
  // prop and agree on the CONTENT instead of on the absence of it.
  const sanitized = hasHtml ? sanitizeTypographyHtml(html as string) : null
  if (sanitized !== null) {
    // A `<p>` cannot hold the block content a rich-text body may contain —
    // see `blockSafeComponent`. `undefined` leaves MUI's own choice alone.
    const component = blockSafeComponent(sanitized, rest as TypographyProps)
    return (
      <Typography
        ref={ref}
        variantMapping={VARIANT_ELEMENT}
        {...rest}
        {...(component ? { component } : {})}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    )
  }
  return (
    <Typography ref={ref} variantMapping={VARIANT_ELEMENT} {...rest}>
      {children}
    </Typography>
  )
})

export default AglynTypography
