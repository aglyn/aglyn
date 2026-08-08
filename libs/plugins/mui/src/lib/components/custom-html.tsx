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
import { mdiCodeTags } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import DOMPurify from 'dompurify'
import { forwardRef, useEffect, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'custom-html'

export interface CustomHtmlProps {
  /** Author-provided markup, sanitized before every render. */
  html?: string
  /** Scoped styles injected as a <style> tag (selectors are the
   * author's responsibility; keep them specific). */
  css?: string
  /**
   * Embed mode (AGL-320): renders the RAW snippet inside a sandboxed
   * iframe (scripts allowed, same-origin denied) for third-party
   * widgets. Business-plan gated by the contentGating entitlement's
   * sibling `commerce` checks server-side; the besigner surfaces the
   * gate in the attribute description.
   */
  embedMode?: boolean
  /** Iframe height (px) in embed mode. */
  embedHeight?: number
}

/**
 * Sanitization policy (AGL-320): DOMPurify allowlist — no scripts,
 * iframes, objects, or event-handler attributes; style attributes pass
 * through DOMPurify's CSS filtering. Applied at EVERY render (client +
 * besigner canvas), so stored markup can never execute even if a write
 * bypassed the console. Embed mode never touches the DOM — the raw
 * snippet only exists inside `sandbox="allow-scripts"` (no
 * allow-same-origin), so it cannot reach cookies, storage, or the
 * parent page.
 */
export function sanitizeCustomHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
    ALLOW_DATA_ATTR: false,
  })
}

const CustomHtml = forwardRef<HTMLDivElement, CustomHtmlProps>(
  (props, ref) => {
    const { html, css, embedMode, embedHeight, ...rest } = props
    const { hostId } = Aglyn.useSite()

    // Same shape as typography's rich text (AGL-1268): DOMPurify needs a
    // DOM, and sanitizing during hydration made the first client render
    // diverge from the server's empty HTML — a mismatch by construction.
    // Sanitize in an effect instead: server render and first client render
    // agree (empty), the content paints one frame later. The empty-SSR SEO
    // cost is unchanged and tracked on AGL-1268.
    const [sanitized, setSanitized] = useState('')
    useEffect(() => {
      setSanitized(!html || embedMode ? '' : sanitizeCustomHtml(html))
    }, [html, embedMode])

    if (!html?.trim()) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={{
            p: 3,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 1,
            color: 'text.secondary',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {'</> Custom HTML — add markup in the attributes panel'}
        </Box>
      )
    }

    if (embedMode) {
      return (
        <Box ref={ref} {...rest}>
          {!hostId ? (
            <Typography variant="caption" color="text.secondary">
              {'Embed (sandboxed iframe) — runs on the live site'}
            </Typography>
          ) : null}
          <iframe
            title="Embedded content"
            sandbox="allow-scripts allow-popups"
            srcDoc={html}
            style={{
              width: '100%',
              height: `${Math.max(40, embedHeight ?? 320)}px`,
              border: 0,
            }}
          />
        </Box>
      )
    }

    return (
      <Box ref={ref} {...rest}>
        {css ? <style>{css}</style> : null}
        {/* Sanitized above on every render — see sanitizeCustomHtml. */}
        <div dangerouslySetInnerHTML={{ __html: sanitized }} />
      </Box>
    )
  },
)
CustomHtml.displayName = 'AglynCustomHtml'

export const schema: Aglyn.ComponentSchema<CustomHtmlProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Custom HTML',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiCodeTags.path, sx: { color: '#7b1fa2' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'html',
      label: 'HTML',
      description:
        'Sanitized on every render: scripts, iframes, and on* handlers ' +
        'are stripped. Use Embed mode for third-party widgets.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'css',
      label: 'CSS',
      description: 'Injected as a style tag — keep selectors specific.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'embedMode',
      label: 'Embed mode (sandboxed)',
      description:
        'Runs the raw snippet in a sandboxed iframe (scripts allowed, no ' +
        'access to your site or visitor data). For third-party widgets.',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
    {
      name: 'embedHeight',
      label: 'Embed height (px)',
      description: 'Iframe height in embed mode (default 320).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Custom HTML',
    pluginId: BUNDLE_ID,
    description: 'Sanitized markup block, with a sandboxed embed mode',
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiCodeTags.path, sx: { color: '#7b1fa2' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { html: '<p>Hello from custom HTML</p>' },
    },
  },
]

export default CustomHtml
