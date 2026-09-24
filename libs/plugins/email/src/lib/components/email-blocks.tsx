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
  mdiCardTextOutline,
  mdiEmailOutline,
  mdiFormatText,
  mdiImageOutline,
  mdiMinus,
  mdiPackageVariantClosed,
  mdiPageLayoutFooter,
  mdiPageLayoutHeader,
  mdiArrowExpandVertical,
  mdiGestureTapButton,
  mdiCodeTags,
} from '@aglyn/shared-data-mdi'
import { sanitizeAuthorHtml } from '@aglyn/aglyn/app-utils/author-html'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import Box from '@mui/material/Box'
import type { SxProps, Theme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

/**
 * Email-safe blocks (AGL-346): the besigner canvas renders these web
 * previews; the render pipeline (email-render.ts in app-utils) converts
 * the same nodes to inline-styled table HTML for email clients. Merge
 * tokens like {{contact.firstName}} substitute at send time.
 *
 * Component ids are persisted in screen documents; never rename.
 *
 * Every block pulls `sx` out of its props and composes it AFTER its own
 * defaults with MUI array composition (AGL-587): the renderer's Leaf
 * passes the node-level sx (styles-panel output) through props.sx, and a
 * literal `sx={{...}}` after `{...rest}` used to silently discard it.
 */

interface EmailBlockStyleProps {
  /** Node-level styles merged by the renderer; wins over block defaults. */
  sx?: SxProps<Theme>
}

// ---------------------------------------------------------------- section
export const SECTION_ID: Aglyn.ComponentId = 'emailSection'

export interface EmailSectionProps extends EmailBlockStyleProps {
  backgroundColor?: string
  /** Inner padding in px (default 24). */
  padding?: number
  align?: 'left' | 'center' | 'right'
  children?: JSX.Children
}

export const EmailSection = forwardRef<HTMLDivElement, EmailSectionProps>(
  (props, ref) => {
    const { backgroundColor, padding, align, children, sx, ...rest } = props
    return (
      <Box
        ref={ref}
        {...rest}
        sx={mergeSxProps(
          {
            maxWidth: 600,
            mx: 'auto',
            backgroundColor: backgroundColor || '#ffffff',
            p: `${padding ?? 24}px`,
            textAlign: align ?? 'left',
          },
          sx,
        )}
      >
        {children}
      </Box>
    )
  },
)
EmailSection.displayName = 'EmailSection'

export const emailSectionSchema: Aglyn.ComponentSchema<EmailSectionProps> = {
  $id: SECTION_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Email section',
  description: 'An email-safe band with its own background color and padding.',
  category: Aglyn.ComponentCategory.LAYOUT,
  icon: { path: mdiEmailOutline.path, sx: { color: '#f57c00' } },
  attributes: [
    {
      name: 'backgroundColor',
      label: 'Background color',
      description: 'Solid colors only — gradients are unreliable in email.',
      component: Aglyn.FieldComponentType.COLOR_PICKER,
    },
    {
      name: 'padding',
      label: 'Padding (px)',
      description: 'Inner spacing around the section content.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'align',
      label: 'Content alignment',
      description:
        'How every block inside this section lines up. Each block can still ' +
        'override it with its own alignment.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
    },
  ],
}

// ------------------------------------------------------------------- text
export const TEXT_ID: Aglyn.ComponentId = 'emailText'

export interface EmailTextProps extends EmailBlockStyleProps {
  children?: string
  variant?: 'heading' | 'subheading' | 'body' | 'caption'
  color?: string
  align?: 'left' | 'center' | 'right'
}

const TEXT_PRESETS: Record<
  NonNullable<EmailTextProps['variant']>,
  { fontSize: number; fontWeight: number; lineHeight: number }
> = {
  heading: { fontSize: 28, fontWeight: 700, lineHeight: 1.25 },
  subheading: { fontSize: 20, fontWeight: 600, lineHeight: 1.3 },
  body: { fontSize: 15, fontWeight: 400, lineHeight: 1.55 },
  caption: { fontSize: 12, fontWeight: 400, lineHeight: 1.4 },
}

export const EmailText = forwardRef<HTMLDivElement, EmailTextProps>(
  (props, ref) => {
    const { children, variant, color, align, sx, ...rest } = props
    const preset = TEXT_PRESETS[variant ?? 'body']
    return (
      <Typography
        ref={ref}
        component="div"
        {...rest}
        sx={mergeSxProps(
          {
            fontSize: preset.fontSize,
            fontWeight: preset.fontWeight,
            lineHeight: preset.lineHeight,
            color: color || '#1a1a1a',
            textAlign: align ?? 'left',
            fontFamily: 'Helvetica, Arial, sans-serif',
            mb: 1,
          },
          sx,
        )}
      >
        {children ?? 'Email text'}
      </Typography>
    )
  },
)
EmailText.displayName = 'EmailText'

export const emailTextSchema: Aglyn.ComponentSchema<EmailTextProps> = {
  $id: TEXT_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Email text',
  description: 'A paragraph of email copy in one of the preset styles.',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiFormatText.path, sx: { color: '#f57c00' } },
  flags: { textEditable: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'children',
      label: 'Text',
      description:
        'Supports merge tokens: {{contact.firstName}}, {{contact.email}}, ' +
        '{{org.name}}, {{unsubscribeUrl}}.',
      component: Aglyn.FieldComponentType.TEXTAREA,
    },
    {
      name: 'variant',
      label: 'Style',
      description:
        'Size and weight of this text — Heading and Subheading also give it ' +
        'the spacing above and below that a heading needs.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'heading', label: 'Heading' },
        { value: 'subheading', label: 'Subheading' },
        { value: 'body', label: 'Body' },
        { value: 'caption', label: 'Caption' },
      ],
    },
    {
      name: 'color',
      label: 'Color',
      description:
        'Text color. Keep it dark on a light background: many clients ' +
        'ignore dark mode overrides and show your color as-is.',
      component: Aglyn.FieldComponentType.COLOR_PICKER,
    },
    {
      name: 'align',
      label: 'Alignment',
      description: 'How this block of text lines up within the section.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
    },
  ],
}

// --------------------------------------------------------------- richtext
export const RICHTEXT_ID: Aglyn.ComponentId = 'emailRichtext'

export interface EmailRichtextProps extends EmailBlockStyleProps {
  /** HTML fragment; sanitized with the custom-html policy (AGL-320). */
  html?: string
}

export const EmailRichtext = forwardRef<HTMLDivElement, EmailRichtextProps>(
  (props, ref) => {
    const { html, sx, ...rest } = props
    if (!html?.trim()) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={mergeSxProps(
            {
              p: 2,
              border: '1px dashed',
              borderColor: 'divider',
              color: 'text.secondary',
              fontSize: 13,
            },
            sx,
          )}
        >
          {'Rich text — add HTML in the attributes panel'}
        </Box>
      )
    }
    return (
      <Box
        ref={ref}
        {...rest}
        sx={mergeSxProps(
          { fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 15 },
          sx,
        )}
        // Sanitized on every render — same policy as the custom HTML block.
        // The `typeof window` guard this replaced existed only because that
        // policy was DOMPurify, which needs a DOM; it is now a pure function
        // (AGL-1901), so the body survives a server render instead of being
        // blanked — which for an email is the render that gets SENT.
        dangerouslySetInnerHTML={{ __html: sanitizeAuthorHtml(html) }}
      />
    )
  },
)
EmailRichtext.displayName = 'EmailRichtext'

export const emailRichtextSchema: Aglyn.ComponentSchema<EmailRichtextProps> = {
  $id: RICHTEXT_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Email rich text',
  description: 'An HTML fragment in an email, sanitised on render.',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiCardTextOutline.path, sx: { color: '#f57c00' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'html',
      label: 'HTML',
      description:
        'Formatted content (p, b, i, a, ul/ol, h1-h4). Scripts and forms ' +
        'are stripped; keep styling simple for email clients. Merge ' +
        'tokens work here too.',
      component: Aglyn.FieldComponentType.TEXTAREA,
    },
  ],
}

// ------------------------------------------------------------------ image
export const IMAGE_ID: Aglyn.ComponentId = 'emailImage'

export interface EmailImageProps extends EmailBlockStyleProps {
  src?: string
  alt?: string
  /** Rendered width in px (max 600). */
  width?: number
  href?: string
  align?: 'left' | 'center' | 'right'
}

export const EmailImage = forwardRef<HTMLDivElement, EmailImageProps>(
  (props, ref) => {
    const { src: storedSrc, alt, width, href, align, sx, ...rest } = props
    // A media-picker target, so it can hold a media reference (AGL-1215).
    // This is the CANVAS preview only — the sent HTML is built by
    // `email-render`, which needs an absolute URL and cannot resolve either
    // a reference or the relative CDN path it replaces.
    const src = Aglyn.resolveMediaSrc(storedSrc)
    return (
      <Box
        ref={ref}
        {...rest}
        sx={mergeSxProps({ textAlign: align ?? 'center', my: 1 }, sx)}
      >
        {src ? (
          <Box
            component="img"
            src={src}
            alt={alt ?? ''}
            sx={{ maxWidth: '100%', width: width ? `${width}px` : '100%' }}
          />
        ) : (
          <Box
            sx={{
              height: 120,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px dashed',
              borderColor: 'divider',
              color: 'text.secondary',
              fontSize: 13,
            }}
          >
            {'Image — pick from the media library'}
          </Box>
        )}
      </Box>
    )
  },
)
EmailImage.displayName = 'EmailImage'

export const emailImageSchema: Aglyn.ComponentSchema<EmailImageProps> = {
  $id: IMAGE_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Email image',
  description: 'An email-safe image, capped at 600px wide, optionally linked.',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiImageOutline.path, sx: { color: '#f57c00' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'src',
      label: 'Source URL',
      description: 'Use an absolute URL — email clients cannot resolve relative paths.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'alt',
      label: 'Alt text',
      // AGL-1896: the same "Browse media" default the site Image element
      // gets. It matters MORE here — most clients block images by default,
      // so for most recipients the alt text IS the block.
      description:
        'Shown while images are blocked — most clients block by default. ' +
        'Filled in from the media library when you pick a file that has ' +
        'alt text.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'width',
      label: 'Width (px)',
      description:
        'How wide the image renders. Blank fills the section — which is ' +
        'usually right, since a phone is narrower than any number you pick.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'href',
      label: 'Link URL',
      description:
        'Where the image goes when it is clicked. Blank leaves it as a ' +
        'plain picture.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'align',
      label: 'Alignment',
      description: 'Where the image sits when it is narrower than the section.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
    },
  ],
}

// ----------------------------------------------------------------- button
export const BUTTON_ID: Aglyn.ComponentId = 'emailButton'

export interface EmailButtonProps extends EmailBlockStyleProps {
  children?: string
  href?: string
  backgroundColor?: string
  color?: string
  align?: 'left' | 'center' | 'right'
}

export const EmailButton = forwardRef<HTMLDivElement, EmailButtonProps>(
  (props, ref) => {
    const { children, href, backgroundColor, color, align, sx, ...rest } =
      props
    return (
      <Box
        ref={ref}
        {...rest}
        sx={mergeSxProps({ textAlign: align ?? 'center', my: 1.5 }, sx)}
      >
        <Box
          component="span"
          sx={{
            display: 'inline-block',
            px: 3,
            py: 1.25,
            borderRadius: 1,
            backgroundColor: backgroundColor || '#1a73e8',
            color: color || '#ffffff',
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          {children ?? 'Call to action'}
        </Box>
      </Box>
    )
  },
)
EmailButton.displayName = 'EmailButton'

export const emailButtonSchema: Aglyn.ComponentSchema<EmailButtonProps> = {
  $id: BUTTON_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Email button',
  description: 'A call-to-action button that survives every mail client.',
  category: Aglyn.ComponentCategory.INPUT,
  icon: { path: mdiGestureTapButton.path, sx: { color: '#f57c00' } },
  flags: { textEditable: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'children',
      label: 'Label',
      description:
        'The words on the button. Say what happens next — "See the report" ' +
        'reads as a destination where "Click here" does not.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'href',
      label: 'Link URL',
      description: 'Absolute URL (https://…). Merge tokens allowed.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'backgroundColor',
      label: 'Button color',
      description:
        'The fill behind the label. Check it against the label color — a ' +
        'button nobody can read is a link nobody clicks.',
      component: Aglyn.FieldComponentType.COLOR_PICKER,
    },
    {
      name: 'color',
      label: 'Label color',
      description: 'The color of the words on the button.',
      component: Aglyn.FieldComponentType.COLOR_PICKER,
    },
    {
      name: 'align',
      label: 'Alignment',
      description: 'Where the button sits across the width of the section.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
    },
  ],
}

// ---------------------------------------------------------------- divider
export const DIVIDER_ID: Aglyn.ComponentId = 'emailDivider'

export interface EmailDividerProps extends EmailBlockStyleProps {
  color?: string
}

export const EmailDivider = forwardRef<HTMLHRElement, EmailDividerProps>(
  (props, ref) => {
    const { color, sx, ...rest } = props
    return (
      <Box
        ref={ref}
        component="hr"
        {...rest}
        sx={mergeSxProps(
          {
            border: 0,
            // Split shorthand so a palette token path from the theme-
            // reference color picker (AGL-588) resolves through the sx
            // system instead of dying inside a template string.
            borderTopStyle: 'solid',
            borderTopWidth: 1,
            borderTopColor: color || '#e0e0e0',
            my: 2,
          },
          sx,
        )}
      />
    )
  },
)
EmailDivider.displayName = 'EmailDivider'

export const emailDividerSchema: Aglyn.ComponentSchema<EmailDividerProps> = {
  $id: DIVIDER_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Email divider',
  description: 'A horizontal rule between email sections.',
  category: Aglyn.ComponentCategory.LAYOUT,
  icon: { path: mdiMinus.path, sx: { color: '#f57c00' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'color',
      label: 'Line color',
      description:
        'The color of the rule. A light grey separates sections without ' +
        'drawing the eye to the line itself.',
      component: Aglyn.FieldComponentType.COLOR_PICKER,
    },
  ],
}

// ----------------------------------------------------------------- spacer
export const SPACER_ID: Aglyn.ComponentId = 'emailSpacer'

export interface EmailSpacerProps extends EmailBlockStyleProps {
  /** Height in px (default 24). */
  height?: number
}

export const EmailSpacer = forwardRef<HTMLDivElement, EmailSpacerProps>(
  (props, ref) => {
    const { height, sx, ...rest } = props
    return (
      <Box
        ref={ref}
        {...rest}
        sx={mergeSxProps({ height: height ?? 24 }, sx)}
      />
    )
  },
)
EmailSpacer.displayName = 'EmailSpacer'

export const emailSpacerSchema: Aglyn.ComponentSchema<EmailSpacerProps> = {
  $id: SPACER_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Email spacer',
  description: 'Fixed vertical whitespace between email blocks.',
  category: Aglyn.ComponentCategory.LAYOUT,
  icon: { path: mdiArrowExpandVertical.path, sx: { color: '#f57c00' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'height',
      label: 'Height (px)',
      description:
        'How much empty vertical space this block adds. Email clients drop ' +
        'CSS margins, so a spacer is how you get reliable breathing room.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
  ],
}

// ---------------------------------------------------------------- product
export const PRODUCT_ID: Aglyn.ComponentId = 'emailProduct'

export interface EmailProductProps extends EmailBlockStyleProps {
  /** Product id — resolved server-side at render (rename-safe). */
  productId?: string
  buttonLabel?: string
}

export const EmailProduct = forwardRef<HTMLDivElement, EmailProductProps>(
  (props, ref) => {
    const { productId, buttonLabel, sx, ...rest } = props
    return (
      <Box
        ref={ref}
        {...rest}
        sx={mergeSxProps(
          {
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            p: 2,
            my: 1,
            textAlign: 'center',
            color: 'text.secondary',
            fontSize: 13,
          },
          sx,
        )}
      >
        {productId
          ? `Product card (${productId}) — name, price, image fill in at send`
          : 'Product card — pick a product in the attributes panel'}
        <Box sx={{ mt: 1, fontWeight: 600 }}>
          {buttonLabel ?? 'Shop now'}
        </Box>
      </Box>
    )
  },
)
EmailProduct.displayName = 'EmailProduct'

export const emailProductSchema: Aglyn.ComponentSchema<EmailProductProps> = {
  $id: PRODUCT_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Email product',
  description: 'A product card resolved at send time, so it never goes stale.',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiPackageVariantClosed.path, sx: { color: '#f57c00' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'productId',
      label: 'Product',
      description:
        'Stored by id — the current name, price, and image render at send.',
      component: Aglyn.FieldComponentType.PRODUCT_SELECT,
    },
    {
      name: 'buttonLabel',
      label: 'Button label',
      description:
        'The words on the card’s button. Blank uses the block’s default, ' +
        'and the link always points at this product’s page.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

// ------------------------------------------------------------ custom html
export const HTML_ID: Aglyn.ComponentId = 'emailHtml'

export interface EmailHtmlProps extends EmailBlockStyleProps {
  html?: string
}

export const EmailHtml = forwardRef<HTMLDivElement, EmailHtmlProps>(
  (props, ref) => {
    const { html, sx, ...rest } = props
    return (
      <Box
        ref={ref}
        {...rest}
        sx={mergeSxProps({ fontFamily: 'Helvetica, Arial, sans-serif' }, sx)}
        // No `typeof window` guard any more (AGL-1901): the sanitizer needs
        // no DOM, so a server-rendered email keeps its custom HTML.
        dangerouslySetInnerHTML={{
          __html: html ? sanitizeAuthorHtml(html) : '',
        }}
      />
    )
  },
)
EmailHtml.displayName = 'EmailHtml'

export const emailHtmlSchema: Aglyn.ComponentSchema<EmailHtmlProps> = {
  $id: HTML_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Email custom HTML',
  description: 'Hand-written HTML for an email, used as-is.',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiCodeTags.path, sx: { color: '#f57c00' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'html',
      label: 'HTML',
      description:
        'Raw table markup for advanced layouts. Sanitized with the ' +
        'custom-html policy; the render pipeline passes it through as-is ' +
        'after sanitization.',
      component: Aglyn.FieldComponentType.TEXTAREA,
    },
  ],
}

/**
 * The two bands most emails a site sends begin and end with (AGL-3287).
 *
 * Each drops into any email like the blocks above, and the Components page
 * starts a reusable Header or Footer email block from these same trees, by
 * the ids core names in `REUSABLE_EMAIL_BLOCK_STARTER_PRESET_IDS` — one tree
 * each, wherever it is started from.
 *
 * The words are placeholders to replace. No merge token names the company in
 * both kinds of email — a campaign supplies `{{org.name}}`, and no token is
 * supplied by every one of a site's own emails — while a token an email does
 * not supply is blanked before sending, which would leave the header with no
 * name at all.
 *
 * The footer carries no unsubscribe link: a campaign send appends its own,
 * and a second one would do the same thing twice.
 */
export const EMAIL_HEADER_PRESET: Aglyn.PresetSchema = {
  $id: Aglyn.REUSABLE_EMAIL_BLOCK_STARTER_PRESET_IDS.header,
  type: Aglyn.NodeType.PRESET,
  displayName: 'Header',
  description:
    'Your logo above your company name, for the top of an email. Pick the ' +
    'logo from your media library — until you do, the picture shows nothing ' +
    'in a sent email.',
  pluginId: BUNDLE_ID,
  category: Aglyn.ComponentCategory.BLOCKS,
  tags: ['logo', 'masthead', 'top', 'brand'],
  icon: { path: mdiPageLayoutHeader.path, sx: { color: '#f57c00' } },
  data: {
    $id: null,
    componentId: SECTION_ID,
    pluginId: BUNDLE_ID,
    props: { align: 'center', padding: 24 },
    nodes: [
      {
        $id: null,
        componentId: IMAGE_ID,
        pluginId: BUNDLE_ID,
        props: { alt: 'Your company logo', width: 160, align: 'center' },
      },
      {
        $id: null,
        componentId: TEXT_ID,
        pluginId: BUNDLE_ID,
        props: {
          children: 'Your company',
          variant: 'subheading',
          align: 'center',
        },
      },
    ],
  },
}

/**
 * The Footer's small print, a muted gray that still reads at 5:1 on white.
 * A literal on purpose: it is written into the sent mail's own HTML, where no
 * theme token resolves.
 */
const FOOTER_TEXT_COLOR = '#6b6b6b'

/** See {@link EMAIL_HEADER_PRESET}. */
export const EMAIL_FOOTER_PRESET: Aglyn.PresetSchema = {
  $id: Aglyn.REUSABLE_EMAIL_BLOCK_STARTER_PRESET_IDS.footer,
  type: Aglyn.NodeType.PRESET,
  displayName: 'Footer',
  description:
    'Your company name and address, and why the reader gets your emails, for ' +
    'the bottom of an email. Campaign emails add the unsubscribe link for you.',
  pluginId: BUNDLE_ID,
  category: Aglyn.ComponentCategory.BLOCKS,
  tags: ['address', 'bottom', 'contact', 'legal'],
  icon: { path: mdiPageLayoutFooter.path, sx: { color: '#f57c00' } },
  data: {
    $id: null,
    componentId: SECTION_ID,
    pluginId: BUNDLE_ID,
    props: { align: 'center', padding: 24 },
    nodes: [
      {
        $id: null,
        componentId: DIVIDER_ID,
        pluginId: BUNDLE_ID,
        props: {},
      },
      {
        $id: null,
        componentId: TEXT_ID,
        pluginId: BUNDLE_ID,
        props: {
          children: 'Your company · 123 Main St, City',
          variant: 'caption',
          align: 'center',
          color: FOOTER_TEXT_COLOR,
        },
      },
      {
        $id: null,
        componentId: TEXT_ID,
        pluginId: BUNDLE_ID,
        props: {
          children:
            "You're receiving this because you're a customer of Your company.",
          variant: 'caption',
          align: 'center',
          color: FOOTER_TEXT_COLOR,
        },
      },
    ],
  },
}

export const emailPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(SECTION_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Email section',
    pluginId: BUNDLE_ID,
    category: Aglyn.ComponentCategory.LAYOUT,
    icon: { path: mdiEmailOutline.path, sx: { color: '#f57c00' } },
    data: {
      $id: null,
      componentId: SECTION_ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
  {
    $id: generatePresetId(TEXT_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Email text',
    pluginId: BUNDLE_ID,
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiFormatText.path, sx: { color: '#f57c00' } },
    data: {
      $id: null,
      componentId: TEXT_ID,
      pluginId: BUNDLE_ID,
      props: { children: 'Hello {{contact.firstName}},', variant: 'body' },
    },
  },
  {
    $id: generatePresetId(RICHTEXT_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Email rich text',
    pluginId: BUNDLE_ID,
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiCardTextOutline.path, sx: { color: '#f57c00' } },
    data: {
      $id: null,
      componentId: RICHTEXT_ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
  {
    $id: generatePresetId(IMAGE_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Email image',
    pluginId: BUNDLE_ID,
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiImageOutline.path, sx: { color: '#f57c00' } },
    data: {
      $id: null,
      componentId: IMAGE_ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
  {
    $id: generatePresetId(BUTTON_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Email button',
    pluginId: BUNDLE_ID,
    category: Aglyn.ComponentCategory.INPUT,
    icon: { path: mdiGestureTapButton.path, sx: { color: '#f57c00' } },
    data: {
      $id: null,
      componentId: BUTTON_ID,
      pluginId: BUNDLE_ID,
      props: { children: 'Shop now' },
    },
  },
  {
    $id: generatePresetId(DIVIDER_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Email divider',
    pluginId: BUNDLE_ID,
    category: Aglyn.ComponentCategory.LAYOUT,
    icon: { path: mdiMinus.path, sx: { color: '#f57c00' } },
    data: {
      $id: null,
      componentId: DIVIDER_ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
  {
    $id: generatePresetId(SPACER_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Email spacer',
    pluginId: BUNDLE_ID,
    category: Aglyn.ComponentCategory.LAYOUT,
    icon: { path: mdiArrowExpandVertical.path, sx: { color: '#f57c00' } },
    data: {
      $id: null,
      componentId: SPACER_ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
  {
    $id: generatePresetId(PRODUCT_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Email product',
    pluginId: BUNDLE_ID,
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiPackageVariantClosed.path, sx: { color: '#f57c00' } },
    data: {
      $id: null,
      componentId: PRODUCT_ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
  {
    $id: generatePresetId(HTML_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Email custom HTML',
    pluginId: BUNDLE_ID,
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiCodeTags.path, sx: { color: '#f57c00' } },
    data: {
      $id: null,
      componentId: HTML_ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
  EMAIL_HEADER_PRESET,
  EMAIL_FOOTER_PRESET,
]
