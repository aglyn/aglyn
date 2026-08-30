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
'use client'

import { decodeStoredNodes } from '@aglyn/aglyn'
import { EMAIL_NODE_ROOT_ID, renderEmailHtml } from '@aglyn/shared-util-email'
import { sanitizeAuthorHtml } from '@aglyn/aglyn/app-utils/author-html'
import { Box, Stack, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'

export interface EmailDesignPreviewProps {
  hostId: string
  /** The version document's raw `nodes` field, in any of its stored forms. */
  nodes: unknown
  /** The version document has not arrived yet, as against not existing. */
  loading?: boolean
  subject?: string
  preheader?: string
  /** What to say when there is nothing to draw. */
  emptyMessage: string
  /**
   * An extra line under the frame — for a surface where the rendering has a
   * caveat of its own, such as a message sent before the template changed.
   */
  note?: string
}

/**
 * THE EMAIL AS AN INBOX RECEIVES IT, DRAWN SAFELY.
 *
 * ## The same renderer the send path calls
 *
 * `renderEmailHtml` is the function `campaign-send.ts` calls, given the same
 * `rootId` and the same stored node map — so what is drawn here is the
 * document that gets mailed, rather than a second rendering that agrees with
 * it until it does not. The besigner is NOT that: it draws canvas nodes as
 * React in a browser, which is a different pipeline with different output.
 *
 * Two inputs differ from a real send and both are said on screen. Merge
 * tokens are left standing — no merge map is passed, and the renderer leaves
 * unknown tokens visible for exactly this reason, so `{{contact.firstName}}`
 * shows where personalization lands instead of a blank. Product blocks
 * resolve against the catalog at send time and are not resolved here, because
 * doing so would put a catalog read on every preview for a picture that can
 * change between now and the send anyway.
 *
 * ## Sandboxed, because the HTML is tenant-authored
 *
 * The design is written by a site's own editors — or by a marketplace
 * publisher, on an installed template — and may contain a custom-HTML block.
 * It is rendered into an iframe with an EMPTY `sandbox` attribute, the
 * maximally restrictive form: no scripts, no forms, no popups, no top-level
 * navigation and, critically, no same-origin. The frame gets an opaque
 * origin, so nothing inside it can reach the console's cookies, storage or
 * DOM. `srcDoc` rather than a URL keeps the markup from ever being served
 * from the console's own origin, where the sandbox attribute would be the
 * only thing between tenant HTML and a live session.
 */
export function EmailDesignPreview(props: EmailDesignPreviewProps) {
  const { hostId, nodes: rawNodes, loading, subject, preheader, emptyMessage, note } =
    props

  /*
   * The origin the preview's images are fetched from.
   *
   * A picked image is stored as a `media:` reference that resolves to the
   * site-RELATIVE CDN path, and the console mounts that route too — but a
   * sandboxed `srcDoc` frame has an opaque origin, so a relative `src` inside
   * it has nothing dependable to resolve against. Read after mount rather
   * than during render because a server render has no `window`, and a value
   * that differs between the two renders is a hydration mismatch on a string
   * the size of a whole email.
   */
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])

  const nodes = useMemo(
    () => decodeStoredNodes<Record<string, any>>(rawNodes) ?? {},
    [rawNodes],
  )
  const productBlocks = useMemo(
    () =>
      Object.values(nodes).filter(
        (node: any) => node?.componentId === 'emailProduct',
      ).length,
    [nodes],
  )
  const rendered = useMemo(() => {
    if (!Object.keys(nodes).length) return null
    return renderEmailHtml({
      /*
       * The same policy the send path applies, so what is previewed here is
       * what an inbox receives. The sandboxed frame below is a second wall,
       * not this one's replacement — a preview that showed markup the mailed
       * copy strips would be a preview of a different email.
       */
      sanitize: sanitizeAuthorHtml,
      nodes,
      // Besigner maps are rooted at '_@_'. Rendering one as the default
      // 'root' finds no root and emits an empty 600px shell.
      rootId: EMAIL_NODE_ROOT_ID,
      subject,
      preheader,
      mediaOrigin: origin,
      mediaHostId: hostId,
    })
  }, [nodes, subject, preheader, origin, hostId])

  if (!rendered) {
    return (
      <Typography variant="body2" color="text.secondary">
        {loading ? 'Loading this email…' : emptyMessage}
      </Typography>
    )
  }

  return (
    <Stack spacing={1}>
      <Typography variant="body2">
        {subject
          ? `Subject: ${subject}`
          : 'This template carries no subject line of its own — each ' +
            'email supplies one.'}
      </Typography>
      <Box
        component="iframe"
        title="Email preview"
        /*
         * EMPTY sandbox — every restriction on, nothing allowed back. The
         * markup below is authored outside this console and may contain a
         * custom-HTML block, so it is rendered with no scripts, no forms, no
         * navigation and an opaque origin: it cannot reach the console's
         * session, storage or DOM even though it is drawn inside the console.
         */
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={rendered.html}
        sx={{
          width: '100%',
          // Fixed, with the frame's own scrollbar. A sandbox with no scripts
          // is a frame that cannot measure or report its content height, and
          // an iframe cannot size to its content on its own.
          height: 640,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'common.white',
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {'Rendered by the same code that builds the mail. Merge tokens are ' +
          'left standing — a real send fills them from each recipient.'}
      </Typography>
      {productBlocks ? (
        <Typography variant="caption" color="text.secondary">
          {`${productBlocks} product ${
            productBlocks === 1 ? 'block is' : 'blocks are'
          } not drawn here — each resolves against the catalog when an email ` +
            'sends, so what it shows depends on the product at that moment.'}
        </Typography>
      ) : null}
      {note ? (
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      ) : null}
    </Stack>
  )
}
EmailDesignPreview.displayName = 'EmailDesignPreview'

export default EmailDesignPreview
