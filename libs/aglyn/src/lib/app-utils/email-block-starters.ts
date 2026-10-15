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

/*
 * The two email bands a Header or Footer email block starts from (AGL-3287),
 * as plain data: the email plugin registers them as element presets (so an
 * author can drop one into an email), the Components page starts a reusable
 * block from the same trees, and the native apps start theirs from the values
 * generated from here. One tree each, wherever it is started from.
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

/** The email plugin's bundle id: the `pluginId` of every element in its bands. */
export const EMAIL_BLOCK_STARTER_PLUGIN_ID = 'email'

/** One element of a nested starter tree, as an element preset's `data` holds it. */
export interface EmailBlockStarterNode {
  $id: null
  componentId: string
  pluginId: string
  props: Record<string, unknown>
  nodes?: EmailBlockStarterNode[]
}

/**
 * The Footer's small print, a muted gray that still reads at 5:1 on white.
 * A literal on purpose: it is written into the sent mail's own HTML, where no
 * theme token resolves.
 */
export const EMAIL_FOOTER_TEXT_COLOR = '#6b6b6b'
const FOOTER_TEXT_COLOR = EMAIL_FOOTER_TEXT_COLOR

export const EMAIL_BLOCK_STARTER_TREES: Readonly<
  Record<'header' | 'footer', EmailBlockStarterNode>
> = {
  header: {
    $id: null,
    componentId: 'emailSection',
    pluginId: EMAIL_BLOCK_STARTER_PLUGIN_ID,
    // Marks the band as the email's header, so the sender's own header is
    // not drawn above it (AGL-3372).
    props: { align: 'center', padding: 24, emailRole: 'header' },
    nodes: [
      {
        $id: null,
        componentId: 'emailImage',
        pluginId: EMAIL_BLOCK_STARTER_PLUGIN_ID,
        props: { alt: 'Your company logo', width: 160, align: 'center' },
      },
      {
        $id: null,
        componentId: 'emailText',
        pluginId: EMAIL_BLOCK_STARTER_PLUGIN_ID,
        props: {
          children: 'Your company',
          variant: 'subheading',
          align: 'center',
        },
      },
    ],
  },
  footer: {
    $id: null,
    componentId: 'emailSection',
    pluginId: EMAIL_BLOCK_STARTER_PLUGIN_ID,
    // Marks the band as the email's footer, so the sender's own footer is
    // not drawn under it (AGL-3372).
    props: { align: 'center', padding: 24, emailRole: 'footer' },
    nodes: [
      {
        $id: null,
        componentId: 'emailDivider',
        pluginId: EMAIL_BLOCK_STARTER_PLUGIN_ID,
        props: {},
      },
      {
        $id: null,
        componentId: 'emailText',
        pluginId: EMAIL_BLOCK_STARTER_PLUGIN_ID,
        props: {
          children: 'Your company · 123 Main St, City',
          variant: 'caption',
          align: 'center',
          color: FOOTER_TEXT_COLOR,
        },
      },
      {
        $id: null,
        componentId: 'emailText',
        pluginId: EMAIL_BLOCK_STARTER_PLUGIN_ID,
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

/**
 * {@link EMAIL_BLOCK_STARTER_TREES} as JSON text: the form the native apps
 * read them in (`Contracts.emailBlockStarterTreesJson`), parsed when a block
 * is started.
 */
export const EMAIL_BLOCK_STARTER_TREES_JSON: string = JSON.stringify(
  EMAIL_BLOCK_STARTER_TREES,
)
