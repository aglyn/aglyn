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
  mdiBullhorn,
  mdiCurrencyUsd,
  mdiEmailOutline,
  mdiFacebook,
  mdiFormatQuoteClose,
  mdiGestureTapButton,
  mdiGithub,
  mdiHelpCircle,
  mdiImage as mdiImageIcon,
  mdiImageText,
  mdiInstagram,
  mdiLinkedin,
  mdiPageLayoutFooter,
  mdiPageLayoutHeader,
  mdiPlayCircle,
  mdiRocketLaunchOutline,
  mdiTwitter,
  mdiViewGridOutline,
  mdiYoutube,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const VIDEO_EMBED_ID: Aglyn.ComponentId = 'videoEmbed'
export const SOCIAL_LINKS_ID: Aglyn.ComponentId = 'socialLinks'

/* ── Video embed ─────────────────────────────────────────────────────────── */

export interface VideoEmbedProps {
  /** YouTube or Vimeo video URL. */
  url?: string
  /** CSS height (default 315px, 16:9-ish with full width). */
  height?: string
}

/**
 * Builds the embed src from a PARSED video id — the raw user URL is never
 * placed in the iframe, so only youtube-nocookie/vimeo player origins can
 * ever load (block-library security posture).
 */
export function parseVideoEmbedSrc(url: string): string | null {
  try {
    const parsed = new URL(url.trim())
    const host = parsed.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = parsed.pathname.slice(1)
      return /^[\w-]{6,20}$/.test(id)
        ? `https://www.youtube-nocookie.com/embed/${id}`
        : null
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id =
        parsed.searchParams.get('v') ??
        (parsed.pathname.startsWith('/embed/')
          ? parsed.pathname.split('/')[2]
          : parsed.pathname.startsWith('/shorts/')
            ? parsed.pathname.split('/')[2]
            : '')
      return id && /^[\w-]{6,20}$/.test(id)
        ? `https://www.youtube-nocookie.com/embed/${id}`
        : null
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const id = parsed.pathname.split('/').find((part) => /^\d{6,}$/.test(part))
      return id ? `https://player.vimeo.com/video/${id}` : null
    }
  } catch {
    /* invalid URL */
  }
  return null
}

const VideoEmbed = forwardRef<HTMLDivElement, VideoEmbedProps>(
  (props, ref) => {
    const { url, height, ...rest } = props
    const src = url ? parseVideoEmbedSrc(url) : null
    if (!src) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={{
            width: '100%',
            height: height || 315,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px dashed',
            borderColor: 'divider',
            color: 'text.secondary',
            fontSize: 12,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {'Video — paste a YouTube or Vimeo URL'}
        </Box>
      )
    }
    return (
      <Box
        ref={ref}
        component="iframe"
        src={src}
        title="Embedded video"
        loading="lazy"
        allow="accelerometer; encrypted-media; picture-in-picture"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        {...rest}
        sx={{
          display: 'block',
          width: '100%',
          height: height || 315,
          border: 0,
        }}
      />
    )
  },
)
VideoEmbed.displayName = 'AglynVideoEmbed'

export const videoEmbedSchema: Aglyn.ComponentSchema<VideoEmbedProps> = {
  $id: VIDEO_EMBED_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Video',
  category: Aglyn.ComponentCategory.MEDIA,
  icon: { path: mdiPlayCircle.path, sx: { color: '#d32f2f' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'url',
      description: 'YouTube or Vimeo video URL.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Video URL',
    },
    {
      name: 'height',
      description: 'CSS height, e.g. 315px or 50vh.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Height',
    },
  ],
}

/* ── Social links ────────────────────────────────────────────────────────── */

export interface SocialLinksProps {
  twitter?: string
  instagram?: string
  facebook?: string
  linkedin?: string
  youtube?: string
  github?: string
}

const SOCIAL_NETWORKS: Array<{
  key: keyof SocialLinksProps
  label: string
  path: string
}> = [
  { key: 'twitter', label: 'Twitter / X', path: mdiTwitter.path },
  { key: 'instagram', label: 'Instagram', path: mdiInstagram.path },
  { key: 'facebook', label: 'Facebook', path: mdiFacebook.path },
  { key: 'linkedin', label: 'LinkedIn', path: mdiLinkedin.path },
  { key: 'youtube', label: 'YouTube', path: mdiYoutube.path },
  { key: 'github', label: 'GitHub', path: mdiGithub.path },
]

const SAFE_SOCIAL_HREF = /^https:\/\//i

const SocialLinks = forwardRef<HTMLDivElement, SocialLinksProps>(
  (props, ref) => {
    const entries = SOCIAL_NETWORKS.map(({ key, label, path }) => ({
      key,
      label,
      path,
      href: props[key]?.trim(),
    })).filter(
      (entry) => entry.href && SAFE_SOCIAL_HREF.test(entry.href),
    )
    return (
      <Stack ref={ref} direction="row" spacing={0.5} {...props}>
        {entries.length === 0 ? (
          <Box
            sx={{
              color: 'text.secondary',
              fontSize: 12,
              fontFamily: 'system-ui, sans-serif',
              p: 1,
            }}
          >
            {'Social links — add profile URLs in Attributes'}
          </Box>
        ) : (
          entries.map((entry) => (
            <IconButton
              key={entry.key}
              component="a"
              href={entry.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={entry.label}
              size="small"
            >
              <MdiIcon path={entry.path} />
            </IconButton>
          ))
        )}
      </Stack>
    )
  },
)
SocialLinks.displayName = 'AglynSocialLinks'

export const socialLinksSchema: Aglyn.ComponentSchema<SocialLinksProps> = {
  $id: SOCIAL_LINKS_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Social Links',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: { path: mdiTwitter.path, sx: { color: '#1976d2' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: SOCIAL_NETWORKS.map(({ key, label }) => ({
    name: key,
    description: `${label} profile URL (https).`,
    component: Aglyn.FieldComponentType.TEXT_FIELD,
    label,
  })),
}

/* ── Section presets (composed from existing components) ────────────────── */

const text = (variant: string, children: string, extra?: object) => ({
  $id: null,
  componentId: 'muiTypography',
  pluginId: BUNDLE_ID,
  props: { variant, children, ...extra },
})

const testimonialCard = (quote: string, name: string) => ({
  $id: null,
  componentId: 'muiStack',
  pluginId: BUNDLE_ID,
  props: { spacing: 1, sx: { flex: 1, p: 3 } },
  nodes: [
    text('body1', `“${quote}”`),
    text('subtitle2', `— ${name}`),
  ],
})

const pricingColumn = (
  tier: string,
  price: string,
  features: string[],
  highlighted?: boolean,
) => ({
  $id: null,
  componentId: 'muiStack',
  pluginId: BUNDLE_ID,
  props: {
    spacing: 1,
    sx: {
      flex: 1,
      p: 3,
      alignItems: 'center',
      ...(highlighted && {
        border: '2px solid',
        borderColor: 'secondary.main',
        borderRadius: 2,
      }),
    },
  },
  nodes: [
    text('h5', tier),
    text('h3', price),
    ...features.map((feature) => text('body2', feature)),
    {
      $id: null,
      componentId: 'muiButton',
      pluginId: BUNDLE_ID,
      props: {
        variant: highlighted ? 'contained' : 'outlined',
        children: 'Choose plan',
      },
    },
  ],
})

const faqItem = (question: string, answer: string) => [
  text('subtitle1', question),
  text('body2', answer, { gutterBottom: true }),
]

/** Screen link with the visible-on-any-surface nav defaults (AGL-539). */
const navLink = (label: string) => ({
  $id: null,
  componentId: 'muiScreenLink',
  pluginId: BUNDLE_ID,
  props: { children: label, color: 'inherit' },
})

const featureColumn = (title: string, body: string) => ({
  $id: null,
  componentId: 'muiStack',
  pluginId: BUNDLE_ID,
  props: { spacing: 1, sx: { flex: 1, minWidth: 220, p: 2 } },
  nodes: [text('h5', title), text('body1', body)],
})

const formField = (
  fieldName: string,
  label: string,
  extra?: object,
) => ({
  $id: null,
  componentId: 'formField',
  pluginId: BUNDLE_ID,
  props: { fieldName, label, required: true, ...extra },
})

export const blockPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(VIDEO_EMBED_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Video',
    pluginId: BUNDLE_ID,
    description: 'Embedded YouTube or Vimeo video',
    category: Aglyn.ComponentCategory.MEDIA,
    icon: { path: mdiPlayCircle.path, sx: { color: '#d32f2f' } },
    data: {
      $id: null,
      componentId: VIDEO_EMBED_ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
  {
    $id: generatePresetId(SOCIAL_LINKS_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Social Links',
    pluginId: BUNDLE_ID,
    description: 'Icon links to social profiles',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiTwitter.path, sx: { color: '#1976d2' } },
    data: {
      $id: null,
      componentId: SOCIAL_LINKS_ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
  {
    $id: generatePresetId('muiStack', 'gallery'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Image Gallery',
    pluginId: BUNDLE_ID,
    description: 'Three-across image row',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiImageIcon.path, sx: { color: '#7b1fa2' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: BUNDLE_ID,
      props: { direction: 'row', spacing: 2, sx: { py: 4 } },
      nodes: [1, 2, 3].map((index) => ({
        $id: null,
        componentId: 'image',
        pluginId: BUNDLE_ID,
        props: { alt: `Gallery image ${index}`, height: '240px' },
      })),
    },
  },
  {
    $id: generatePresetId('muiStack', 'testimonials'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Testimonials',
    pluginId: BUNDLE_ID,
    description: 'Three customer quotes',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiFormatQuoteClose.path, sx: { color: '#0288d1' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: BUNDLE_ID,
      props: { direction: 'row', spacing: 2, sx: { py: 4 } },
      nodes: [
        testimonialCard(
          'Exactly what our team needed to ship the site fast.',
          'Customer One',
        ),
        testimonialCard(
          'The editor is a joy — we update pages in minutes.',
          'Customer Two',
        ),
        testimonialCard(
          'Best decision we made for our online presence.',
          'Customer Three',
        ),
      ],
    },
  },
  {
    $id: generatePresetId('muiStack', 'pricing'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Pricing Table',
    pluginId: BUNDLE_ID,
    description: 'Three plan columns with features and CTAs',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiCurrencyUsd.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: BUNDLE_ID,
      props: { direction: 'row', spacing: 2, sx: { py: 4 } },
      nodes: [
        pricingColumn('Basic', '$9', ['One project', 'Email support']),
        pricingColumn(
          'Pro',
          '$29',
          ['Five projects', 'Priority support', 'Analytics'],
          true,
        ),
        pricingColumn('Team', '$79', [
          'Unlimited projects',
          'Dedicated support',
          'SSO',
        ]),
      ],
    },
  },
  {
    $id: generatePresetId('muiStack', 'faq'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'FAQ',
    pluginId: BUNDLE_ID,
    description: 'Question and answer list',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiHelpCircle.path, sx: { color: '#f57c00' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: BUNDLE_ID,
      props: { spacing: 1, sx: { py: 4, maxWidth: 720 } },
      nodes: [
        text('h4', 'Frequently asked questions', { gutterBottom: true }),
        ...faqItem(
          'How do I get started?',
          'Answer the question in a sentence or two so visitors keep reading.',
        ),
        ...faqItem(
          'Can I change plans later?',
          'Yes — describe how flexible your offering is.',
        ),
        ...faqItem(
          'Do you offer support?',
          'Tell visitors how and when they can reach you.',
        ),
      ],
    },
  },
  {
    $id: generatePresetId('muiStack', 'announcement'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Announcement Bar',
    pluginId: BUNDLE_ID,
    description: 'Accent strip with a message and link',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiBullhorn.path, sx: { color: '#c2185b' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: BUNDLE_ID,
      props: {
        direction: 'row',
        spacing: 2,
        sx: {
          py: 1,
          px: 2,
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'secondary.main',
          color: 'secondary.contrastText',
        },
      },
      nodes: [
        text('body2', 'Big news — announce a launch, sale, or update here.'),
        {
          $id: null,
          componentId: 'muiScreenLink',
          pluginId: BUNDLE_ID,
          props: { children: 'Learn more', size: 'small', color: 'inherit' },
        },
      ],
    },
  },
  // ── Composed page sections (AGL-539) ──────────────────────────────────
  // The pieces every real site needs, insertable without raw-JSON
  // authoring. Node shapes mirror apps/console starter templates; only
  // persisted component ids are referenced.
  {
    $id: generatePresetId('muiAppBar', 'navbar'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Nav Bar',
    pluginId: BUNDLE_ID,
    description: 'Header bar with brand text and screen links',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiPageLayoutHeader.path, sx: { color: '#1976d2' } },
    data: {
      $id: null,
      componentId: 'muiAppBar',
      pluginId: BUNDLE_ID,
      // Static so the bar sits in the page flow; switch the Position
      // attribute to Sticky/Fixed for a pinned header.
      props: { position: 'static' },
      nodes: [
        {
          $id: null,
          componentId: 'muiToolbar',
          pluginId: BUNDLE_ID,
          props: {},
          nodes: [
            text('h6', 'Your Brand', { sx: { flexGrow: 1 } }),
            {
              $id: null,
              componentId: 'muiStack',
              pluginId: BUNDLE_ID,
              props: { direction: 'row', spacing: 1 },
              nodes: [navLink('Home'), navLink('About'), navLink('Contact')],
            },
          ],
        },
      ],
    },
  },
  {
    $id: generatePresetId('muiStack', 'hero'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Hero',
    pluginId: BUNDLE_ID,
    description: 'Centered headline, tagline, and call-to-action button',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiRocketLaunchOutline.path, sx: { color: '#f57c00' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: BUNDLE_ID,
      props: { spacing: 2, sx: { py: 10, px: 4, alignItems: 'center' } },
      nodes: [
        text('h2', 'A headline that sells your idea', { align: 'center' }),
        text('h6', 'One clear sentence about the value you deliver.', {
          align: 'center',
        }),
        {
          $id: null,
          componentId: 'muiButton',
          pluginId: BUNDLE_ID,
          props: {
            variant: 'contained',
            size: 'large',
            children: 'Get started',
          },
        },
      ],
    },
  },
  {
    $id: generatePresetId('muiStack', 'features'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Feature Grid',
    pluginId: BUNDLE_ID,
    description: 'Three selling points in a wrapping row',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiViewGridOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: BUNDLE_ID,
      props: {
        direction: 'row',
        spacing: 2,
        sx: { px: 4, py: 6, flexWrap: 'wrap' },
      },
      nodes: [
        featureColumn('Fast', 'Explain the first reason customers pick you.'),
        featureColumn(
          'Simple',
          'Explain the second reason customers pick you.',
        ),
        featureColumn(
          'Reliable',
          'Explain the third reason customers pick you.',
        ),
      ],
    },
  },
  {
    $id: generatePresetId('muiStack', 'imagetext'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Image + Text',
    pluginId: BUNDLE_ID,
    description: 'Image beside a heading, copy, and link',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiImageText.path, sx: { color: '#7b1fa2' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: BUNDLE_ID,
      props: {
        direction: 'row',
        spacing: 4,
        sx: { px: 4, py: 6, alignItems: 'center', flexWrap: 'wrap' },
      },
      nodes: [
        {
          $id: null,
          componentId: 'muiStack',
          pluginId: BUNDLE_ID,
          props: { sx: { flex: 1, minWidth: 280 } },
          nodes: [
            {
              $id: null,
              componentId: 'image',
              pluginId: BUNDLE_ID,
              props: { alt: 'Feature image', height: '320px' },
            },
          ],
        },
        {
          $id: null,
          componentId: 'muiStack',
          pluginId: BUNDLE_ID,
          props: { spacing: 2, sx: { flex: 1, minWidth: 280 } },
          nodes: [
            text('h4', 'Show, then tell'),
            text(
              'body1',
              'Pair a strong visual with a short paragraph that explains ' +
                'what visitors are looking at and why it matters.',
            ),
            {
              $id: null,
              componentId: 'muiButton',
              pluginId: BUNDLE_ID,
              props: { variant: 'outlined', children: 'Learn more' },
            },
          ],
        },
      ],
    },
  },
  {
    $id: generatePresetId('muiStack', 'cta'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Call to Action',
    pluginId: BUNDLE_ID,
    description: 'Accent band with a heading and button',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiGestureTapButton.path, sx: { color: '#c2185b' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: BUNDLE_ID,
      props: {
        spacing: 2,
        sx: {
          py: 8,
          px: 4,
          alignItems: 'center',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
        },
      },
      nodes: [
        text('h4', 'Ready to get started?', { align: 'center' }),
        text('body1', 'Tell visitors the one thing to do next.', {
          align: 'center',
        }),
        {
          $id: null,
          componentId: 'muiButton',
          pluginId: BUNDLE_ID,
          props: {
            variant: 'contained',
            color: 'secondary',
            size: 'large',
            children: 'Get started',
          },
        },
      ],
    },
  },
  {
    $id: generatePresetId('form', 'contact-section'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Contact Section',
    pluginId: BUNDLE_ID,
    description: 'Heading with a name/email/message form',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiEmailOutline.path, sx: { color: '#0288d1' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: BUNDLE_ID,
      props: { spacing: 2, sx: { px: 4, py: 6, maxWidth: 560 } },
      nodes: [
        text('h4', 'Get in touch'),
        {
          $id: null,
          componentId: 'form',
          pluginId: BUNDLE_ID,
          props: {
            formName: 'Contact',
            submitLabel: 'Send message',
            successMessage: 'Thanks — we will get back to you soon.',
          },
          nodes: [
            formField('name', 'Name'),
            formField('email', 'Email', { fieldType: 'email' }),
            formField('message', 'Message', { fieldType: 'textarea' }),
          ],
        },
      ],
    },
  },
  {
    $id: generatePresetId('section', 'footer'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Footer',
    pluginId: BUNDLE_ID,
    description: 'Semantic footer with brand, links, social, and copyright',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiPageLayoutFooter.path, sx: { color: '#455a64' } },
    data: {
      $id: null,
      componentId: 'section',
      pluginId: BUNDLE_ID,
      props: {
        element: 'footer',
        ariaLabel: 'Site footer',
        sx: { px: 4, py: 6, borderTop: 1, borderColor: 'divider' },
      },
      nodes: [
        {
          $id: null,
          componentId: 'muiStack',
          pluginId: BUNDLE_ID,
          props: { spacing: 2 },
          nodes: [
            {
              $id: null,
              componentId: 'muiStack',
              pluginId: BUNDLE_ID,
              props: {
                direction: 'row',
                spacing: 2,
                sx: {
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                },
              },
              nodes: [
                text('h6', 'Your Brand'),
                {
                  $id: null,
                  componentId: 'muiStack',
                  pluginId: BUNDLE_ID,
                  props: { direction: 'row', spacing: 1 },
                  nodes: [
                    navLink('Home'),
                    navLink('About'),
                    navLink('Contact'),
                  ],
                },
              ],
            },
            {
              $id: null,
              componentId: SOCIAL_LINKS_ID,
              pluginId: BUNDLE_ID,
              props: {},
            },
            text(
              'caption',
              '© Your Company. All rights reserved.',
              { color: 'text.secondary' },
            ),
          ],
        },
      ],
    },
  },
]

export { SocialLinks, VideoEmbed }
export default VideoEmbed
