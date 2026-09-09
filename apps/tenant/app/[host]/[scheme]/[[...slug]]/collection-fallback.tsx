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

import { formatCollectionEntryDate } from '@aglyn/aglyn/app-utils/collection-entry-date'
import {
  HEADING_ANCHOR_SCROLL_MARGIN,
  type MarkdownInline,
  markdownHeadingSlugs,
  parseMarkdownLite,
} from '@aglyn/aglyn/app-utils/markdown-lite'
import { renderedMediaAlt } from '@aglyn/aglyn/app-utils/media-alt'
import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import type { Props } from './types'

/**
 * The collection list and entry body a site falls back to (AGL-81), rendered
 * when AGL-551 could compose neither a template screen nor the themed
 * built-in.
 *
 * A module of its own so `catch-all-client` can reach it through
 * `next/dynamic` — the note at that import says what the split buys. Nothing
 * else on the route reads markdown-lite, so the parser travels with this
 * renderer rather than with the page.
 */
export interface CollectionFallbackProps {
  content: NonNullable<Props['content']>
  /** The host the media references resolve against. */
  hostId?: string
}

export function CollectionFallback({
  content,
  hostId,
}: CollectionFallbackProps) {
  const { collection, entries, entry } = content
  // Through the ONE shared formatter (AGL-1926), never a local
  // `toLocaleDateString()`. This component is a client component that Next
  // ALSO renders on the server, so a bare call ran twice against two
  // different runtimes: `en-US` + UTC on Vercel, the visitor's own locale
  // and zone in their browser. An entry published at 02:30 UTC was dated
  // the 10th in the ISR HTML and the 9th by every visitor west of
  // Greenwich, and a visitor outside the US got a differently SHAPED date
  // whatever the instant — React reports both as a text mismatch (#418) and
  // then reconciles against a DOM it no longer describes, which is the
  // `removeChild`/`insertBefore` pair filed alongside it.
  //
  // `formatCollectionEntryDate` pins the locale and the zone, so this is a
  // pure function of the timestamp and the two renders agree by
  // construction rather than by the server and the visitor happening to
  // share a locale. It is also the same function the canvas path stamps
  // into `{{entry.date}}`, so the legacy surface and the composed one can
  // no longer print one entry two ways.
  const formatDate = (value?: { seconds: number } | null) =>
    formatCollectionEntryDate(value)
  // The cover through the ONE shared resolver (AGL-1407). A `media:`
  // reference becomes the CDN path for THIS site; a raw storage URL, an
  // AGL-175 relative CDN path and an author's own hotlinked URL all pass
  // through untouched, per the precedence documented in `media-ref.ts`.
  //
  // A site-RELATIVE result is correct on this surface, unlike `og:image`
  // (AGL-1337) or a manifest icon: a browser rendering the page has a base
  // URL to resolve it against. And a reference that does not parse resolves
  // to undefined, so the `<img>` is dropped rather than emitted with a
  // literal `src="media:…"`.
  const entryCover = resolveMediaSrc((entry as any)?.coverImage, {
    hostId,
  })
  // Parsed once, so the heading anchors below are derived from the same
  // block list they are stamped onto (AGL-1162). Plain consts, not
  // `useMemo`: this branch sits after several early returns, so a hook here
  // would be conditional.
  const entryBodyBlocks = parseMarkdownLite(entry?.body ?? '')
  const entryBodySlugs = markdownHeadingSlugs(entryBodyBlocks)
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px' }}>
      {entry ? (
        <article>
          <h1>{entry.title}</h1>
          <p style={{ opacity: 0.7 }}>{formatDate(entry.publishedAt)}</p>
          {entryCover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entryCover}
              // The author's own description when they wrote one, and
              // `alt=""` otherwise (AGL-2418). `coverImageAlt` has been
              // stored since AGL-2417 but only ever reached `og:image:alt`
              // — the sentence went to everyone who saw the link shared
              // and to nobody who opened the post. No fallback to the
              // title: this sits directly beneath `<h1>{entry.title}</h1>`,
              // so borrowing it would announce the same words twice.
              alt={renderedMediaAlt((entry as any)?.coverImageAlt)}
              style={{ maxWidth: '100%', borderRadius: 8 }}
            />
          ) : null}
          {entryBodyBlocks.map((block, index) => {
            const inline = (inlines: MarkdownInline[]) =>
              inlines.map((item, i) =>
                item.type === 'bold' ? (
                  <strong key={i}>{item.text}</strong>
                ) : item.type === 'italic' ? (
                  <em key={i}>{item.text}</em>
                ) : item.type === 'link' ? (
                  <a key={i} href={item.href}>
                    {item.text}
                  </a>
                ) : (
                  <span key={i}>{item.text}</span>
                ),
              )
            if (block.type === 'heading') {
              // The same anchor ids the besigner-rendered entry body
              // stamps (AGL-1162). This fallback renders the SAME post, so
              // a `#slug` link that works on one and not the other would
              // break exactly when a site falls back.
              const id = entryBodySlugs[index]
              const style = {
                scrollMarginTop: `${HEADING_ANCHOR_SCROLL_MARGIN}px`,
              }
              return block.level === 2 ? (
                <h2 key={index} id={id} style={style}>
                  {inline(block.inlines)}
                </h2>
              ) : (
                <h3 key={index} id={id} style={style}>
                  {inline(block.inlines)}
                </h3>
              )
            }
            if (block.type === 'image') {
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={index}
                  // Resolved on the same terms as the cover above
                  // (AGL-1686): body images are the same assets, and this
                  // fallback renderer has the same `host.$id` in hand.
                  src={resolveMediaSrc(block.src, {
                    hostId,
                  })}
                  alt={block.alt}
                  style={{ maxWidth: '100%', borderRadius: 8 }}
                />
              )
            }
            if (block.type === 'list') {
              return (
                <ul key={index} style={{ lineHeight: 1.7 }}>
                  {block.items.map((item, i) => (
                    <li key={i}>{inline(item)}</li>
                  ))}
                </ul>
              )
            }
            // A numbered list (AGL-1320) — a real `<ol>`, so the markers are
            // the browser's and the author's `start` survives.
            if (block.type === 'orderedList') {
              return (
                <ol key={index} start={block.start} style={{ lineHeight: 1.7 }}>
                  {block.items.map((item, i) => (
                    <li key={i}>{inline(item)}</li>
                  ))}
                </ol>
              )
            }
            // A blockquote (AGL-1315). Without this it fell to the paragraph
            // case below and rendered as ordinary prose — no type error to
            // catch it, because a quote carries `inlines` like a paragraph.
            if (block.type === 'quote') {
              return (
                <blockquote
                  key={index}
                  style={{
                    margin: '24px 0',
                    paddingLeft: 20,
                    borderLeft: '3px solid rgba(127, 127, 127, 0.4)',
                    fontStyle: 'italic',
                    lineHeight: 1.6,
                  }}
                >
                  {inline(block.inlines)}
                </blockquote>
              )
            }
            // Code blocks and tables (AGL-974) — both scroll instead of
            // wrapping, so a wide one never widens the article itself.
            if (block.type === 'code') {
              return (
                <pre
                  key={index}
                  style={{
                    overflowX: 'auto',
                    padding: 16,
                    borderRadius: 8,
                    background: 'rgba(127, 127, 127, 0.12)',
                  }}
                >
                  <code>{block.text}</code>
                </pre>
              )
            }
            if (block.type === 'table') {
              return (
                <div key={index} style={{ overflowX: 'auto' }}>
                  <table
                    style={{ borderCollapse: 'collapse', width: '100%' }}
                  >
                    <thead>
                      <tr>
                        {block.header.map((cell, i) => (
                          <th
                            key={i}
                            style={{
                              border: '1px solid rgba(127, 127, 127, 0.4)',
                              padding: '8px 12px',
                              textAlign: block.align[i] ?? 'left',
                              background: 'rgba(127, 127, 127, 0.12)',
                            }}
                          >
                            {inline(cell)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, i) => (
                            <td
                              key={i}
                              style={{
                                border: '1px solid rgba(127, 127, 127, 0.4)',
                                padding: '8px 12px',
                                textAlign: block.align[i] ?? 'left',
                              }}
                            >
                              {inline(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
            return (
              <p key={index} style={{ lineHeight: 1.7 }}>
                {inline(block.inlines)}
              </p>
            )
          })}
          <p>
            <a href={`/${collection.slug}`}>{`← ${collection.displayName}`}</a>
          </p>
        </article>
      ) : (
        <>
          <h1>{collection.displayName}</h1>
          {entries.length === 0 ? (
            <p style={{ opacity: 0.7 }}>{'Nothing published yet.'}</p>
          ) : (
            entries.map((item) => (
              <article key={item.$id} style={{ marginBottom: 32 }}>
                <h2 style={{ marginBottom: 4 }}>
                  <a
                    href={`/${collection.slug}/${item.slug}`}
                    style={{ color: 'inherit' }}
                  >
                    {item.title}
                  </a>
                </h2>
                <p style={{ opacity: 0.7, margin: 0 }}>
                  {formatDate(item.publishedAt)}
                </p>
                {item.excerpt ? (
                  <p style={{ lineHeight: 1.7 }}>{item.excerpt}</p>
                ) : null}
              </article>
            ))
          )}
        </>
      )}
    </div>
  )
}

export default CollectionFallback
