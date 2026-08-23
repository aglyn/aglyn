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
import type { SxProps } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import { forwardRef } from 'react'
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
  /**
   * Authored node styles, handed over by the renderer rather than typed
   * into an attribute — recomposed below so the Styles panel's values are
   * merged rather than replaced (AGL-1284).
   */
  sx?: SxProps
}

/**
 * Sanitization policy (AGL-320): an allowlist — no scripts, iframes,
 * objects, or event-handler attributes. Applied at EVERY render (server,
 * client, and besigner canvas), so stored markup can never execute even if a
 * write bypassed the console. Embed mode never touches the DOM — the raw
 * snippet only exists inside `sandbox="allow-scripts"` (no
 * allow-same-origin), so it cannot reach cookies, storage, or the parent
 * page.
 *
 * The engine is `Aglyn.sanitizeAuthorHtml` (AGL-1901), which replaced a
 * per-instance DOMPurify. DOMPurify needs a real DOM, so this component
 * could only sanitize in an effect, and every Custom HTML block was
 * therefore absent from the server response — the SSR/SEO half AGL-1268 left
 * open. The new sanitizer is a pure function of the string, so the same call
 * runs on the server and in the browser and both produce the same bytes.
 *
 * What carried over unchanged:
 *
 * - the forbidden set (`script`, `iframe`, `object`, `embed`, `form`,
 *   `base`), `srcdoc`/`formaction`, and `ALLOW_DATA_ATTR: false`;
 * - AGL-1725's `style`-attribute rule. DOMPurify performs NO CSS filtering,
 *   which is why that hook existed at all; `sanitizeAuthorHtml` applies
 *   `sanitizeAuthorCss` to every `style` attribute itself, so the rule is
 *   part of the sanitizer rather than a hook a future caller could forget to
 *   register.
 * - the `<style>` element being dropped from the `html` attribute, so the
 *   `css` attribute below stays the ONLY route to a style block. That was
 *   DOMPurify's behaviour and `custom-html-author-css.spec.tsx` pins it;
 *   a first pass at AGL-1901 mistook it for a gap and let the tag through,
 *   which that spec caught.
 */
export function sanitizeCustomHtml(html: string): string {
  return Aglyn.sanitizeAuthorHtml(html)
}

const CustomHtml = forwardRef<HTMLDivElement, CustomHtmlProps>(
  (props, ref) => {
    const { html, css, embedMode, embedHeight, ...rest } = props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const { hostId } = Aglyn.useSite()

    // Same shape as typography's rich text, and fixed the same way
    // (AGL-1901): sanitized DURING render rather than in an effect. The
    // effect existed because DOMPurify needs a DOM — the server rendered
    // nothing, so the first client render had to render nothing too or
    // hydration would mismatch (AGL-1268). `sanitizeCustomHtml` is now a
    // pure function of the string, so both sides compute the same markup and
    // the block is in the server response where a crawler can read it.
    const sanitized = !html || embedMode ? '' : sanitizeCustomHtml(html)

    if (!html?.trim()) {
      return (
        <Box
          ref={ref}
          {...rest}
          // MERGE, never replace (AGL-1284): the placeholder's own look goes
          // first so an author who styles the empty state can override it.
          sx={[
            {
              p: 3,
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 1,
              color: 'text.secondary',
              fontSize: 13,
              fontFamily: 'system-ui, sans-serif',
            },
            ...nodeSx,
          ]}
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
        {/* AGL-1725: the `css` attribute never reached DOMPurify — that
            policy covers `html` only — so this <style> block was the one
            surface on a published site where an author's raw CSS shipped to
            every visitor unexamined. `sanitizeAuthorCss` refuses schemes
            that cannot be defended (http:, and anything not https/data/blob)
            and deliberately leaves the HOST alone; see the module header on
            why AGL-1701's input restriction does not transfer to a site
            owner styling their own site. */}
        {css ? <style>{Aglyn.sanitizeAuthorCss(css)}</style> : null}
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
  description:
    'Your own markup, sanitised on render, or isolated in a sandboxed iframe.',
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
      // AGL-1725 — the "warn" half of warn-and-disclose. An author can only
      // weigh this egress if they are told it exists, and the attributes
      // panel is where they are typing the url().
      description:
        'Injected as a style tag — keep selectors specific. A url() ' +
        'pointing off your site makes every visitor’s browser contact that ' +
        'host, which sees their IP address and which page they are on. ' +
        'Insecure http:// URLs are not loaded.',
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
