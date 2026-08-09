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

import { htmlToRows } from '../components/markdown-html-paste'
import { rowsToMarkdown } from '../components/markdown-visual-editor.component'

describe('htmlToRows: code blocks and tables (AGL-981)', () => {
  it('keeps a pre block verbatim and reads its language', () => {
    const rows = htmlToRows(
      '<p>Install</p><pre><code class="language-bash">npm i thing\nnpm run dev</code></pre>',
    )
    expect(rows.map((row) => row.kind)).toEqual(['paragraph', 'code'])
    expect(rows[1]).toMatchObject({
      kind: 'code',
      lang: 'bash',
      // Line breaks survive — the whole point of pasting a snippet.
      text: 'npm i thing\nnpm run dev',
    })
  })

  it('maps a table to a squared-off table row, alignment included', () => {
    const rows = htmlToRows(
      '<table><thead><tr><th>Prop</th><th align="right">Default</th></tr>' +
        '</thead><tbody><tr><td><strong>size</strong></td><td>8</td></tr>' +
        '<tr><td>lonely</td></tr></tbody></table>',
    )
    expect(rows).toHaveLength(1)
    const table = rows[0] as any
    expect(table.kind).toBe('table')
    expect(table.align).toEqual(['left', 'right'])
    expect(table.header[0]).toEqual([{ type: 'text', text: 'Prop' }])
    expect(table.rows[0][0]).toEqual([{ type: 'bold', text: 'size' }])
    // Every row carries header.length cells.
    expect(table.rows.map((row: unknown[]) => row.length)).toEqual([2, 2])
    expect(table.rows[1][1]).toEqual([])
  })

  it('serializes a pasted README back to markdown-lite', () => {
    const markdown = rowsToMarkdown(
      htmlToRows(
        '<h2>Config</h2><table><tr><th>Prop</th><th>Default</th></tr>' +
          '<tr><td>size</td><td>8</td></tr></table>' +
          '<pre><code class="language-ts">register({ size: 8 })</code></pre>',
      ),
    )
    expect(markdown).toBe(
      '## Config\n\n| Prop | Default |\n| --- | --- |\n| size | 8 |\n\n' +
        '```ts\nregister({ size: 8 })\n```',
    )
  })

  it('flattens a nested table into its containing cell', () => {
    const rows = htmlToRows(
      '<table><tr><th>A</th></tr><tr><td>' +
        '<table><tr><td>inner</td></tr></table>' +
        '</td></tr></table>',
    )
    const outer = rows[0] as any
    // ONE table: the inner one is not a row of the outer, and the dialect
    // cannot nest, so its text lands in the cell that held it.
    expect(rows.map((row) => row.kind)).toEqual(['table'])
    expect(outer.rows).toHaveLength(1)
    expect(outer.rows[0][0]).toEqual([{ type: 'text', text: 'inner' }])
  })
})

describe('htmlToRows: blockquotes (AGL-1315)', () => {
  it('maps a flat blockquote to a quote row', () => {
    const rows = htmlToRows('<blockquote>To be or <em>not</em>.</blockquote>')
    expect(rows.map((row) => row.kind)).toEqual(['quote'])
    expect(rowsToMarkdown(rows)).toBe('> To be or *not*.')
  })

  it('maps each paragraph of a blockquote to its own quote row', () => {
    const rows = htmlToRows(
      '<blockquote><p>first</p><p>second</p></blockquote>',
    )
    expect(rows.map((row) => row.kind)).toEqual(['quote', 'quote'])
    expect(rowsToMarkdown(rows)).toBe('> first\n\n> second')
  })
})
