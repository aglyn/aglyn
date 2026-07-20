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

import {
  hasUnmaterializedTokens,
  parseTokenSegments,
  resolveTokenLabel,
  segmentsUnitLength,
  serializeTokenSegments,
  sliceSegmentsByUnits,
  spliceSegmentsAtUnits,
  textSegment,
  tokenSegment,
  type TokenLabelContext,
} from './token-segments'

// The pill segment model (AGL-586): stored strings keep raw id-based
// {{...}} grammar; these helpers split them into text runs + atomic
// tokens for pill rendering, always round-tripping losslessly.
describe('parseTokenSegments (AGL-586)', () => {
  it('returns one text segment when no token is present', () => {
    expect(parseTokenSegments('hello world')).toEqual([
      { type: 'text', value: 'hello world' },
    ])
  })

  it('returns an empty list for an empty string', () => {
    expect(parseTokenSegments('')).toEqual([])
  })

  it('splits text around any token form', () => {
    expect(
      parseTokenSegments('Hi {{var:v1}} and {{fn:f1(2, 3)}} plus {{entry.title}}.'),
    ).toEqual([
      { type: 'text', value: 'Hi ' },
      { type: 'token', value: '{{var:v1}}', token: '{{var:v1}}' },
      { type: 'text', value: ' and ' },
      { type: 'token', value: '{{fn:f1(2, 3)}}', token: '{{fn:f1(2, 3)}}' },
      { type: 'text', value: ' plus ' },
      { type: 'token', value: '{{entry.title}}', token: '{{entry.title}}' },
      { type: 'text', value: '.' },
    ])
  })

  it('handles adjacent tokens with no text between', () => {
    expect(parseTokenSegments('{{entry.title}}{{entry.slug}}')).toEqual([
      { type: 'token', value: '{{entry.title}}', token: '{{entry.title}}' },
      { type: 'token', value: '{{entry.slug}}', token: '{{entry.slug}}' },
    ])
  })

  it('keeps unknown {{...}} content as a token segment', () => {
    expect(parseTokenSegments('{{whatever this is}}')).toEqual([
      {
        type: 'token',
        value: '{{whatever this is}}',
        token: '{{whatever this is}}',
      },
    ])
  })

  it('treats a nested-ish opener without a closer as plain text', () => {
    // `{{a{{b}}` — the inner `{{b}}` is the only complete token.
    expect(parseTokenSegments('x{{a{{b}}y')).toEqual([
      { type: 'text', value: 'x{{a' },
      { type: 'token', value: '{{b}}', token: '{{b}}' },
      { type: 'text', value: 'y' },
    ])
  })

  it('round-trips every input through serializeTokenSegments', () => {
    const cases = [
      '',
      'plain',
      '{{var:abc}}',
      'a {{var:abc}} b {{fn:x(1)}} c',
      '{{entry.title}}{{entry.slug}}',
      'broken {{open and {{entry.url}} more',
      'line1\nline2 {{item.f1}}\n',
    ]
    for (const value of cases) {
      expect(serializeTokenSegments(parseTokenSegments(value))).toBe(value)
    }
  })
})

describe('unit-offset model (AGL-586)', () => {
  // 'ab' + pill + 'cd' → units: a=0..1, b=1..2, pill=2..3, c=3..4, d=4..5
  const segments = [
    textSegment('ab'),
    tokenSegment('{{var:v1}}'),
    textSegment('cd'),
  ]

  it('counts each token as exactly one unit', () => {
    expect(segmentsUnitLength(segments)).toBe(5)
  })

  it('slices text and keeps whole tokens', () => {
    expect(sliceSegmentsByUnits(segments, 1, 4)).toEqual([
      { type: 'text', value: 'b' },
      { type: 'token', value: '{{var:v1}}', token: '{{var:v1}}' },
      { type: 'text', value: 'c' },
    ])
  })

  it('never splits a token: a range beside it excludes it entirely', () => {
    expect(sliceSegmentsByUnits(segments, 0, 2)).toEqual([
      { type: 'text', value: 'ab' },
    ])
    expect(sliceSegmentsByUnits(segments, 3, 5)).toEqual([
      { type: 'text', value: 'cd' },
    ])
  })

  it('splices an insertion at a caret between text characters', () => {
    const { segments: next, caretUnit } = spliceSegmentsAtUnits(
      segments,
      [tokenSegment('{{entry.title}}')],
      1,
      1,
    )
    expect(serializeTokenSegments(next)).toBe('a{{entry.title}}b{{var:v1}}cd')
    expect(caretUnit).toBe(2)
  })

  it('replaces a selected range, dropping a covered pill', () => {
    const { segments: next } = spliceSegmentsAtUnits(
      segments,
      [textSegment('X')],
      1,
      4,
    )
    expect(serializeTokenSegments(next)).toBe('aXd')
  })

  it('appends at the end when no caret was captured', () => {
    const { segments: next, caretUnit } = spliceSegmentsAtUnits(
      segments,
      [tokenSegment('{{entry.url}}')],
      null,
      null,
    )
    expect(serializeTokenSegments(next)).toBe('ab{{var:v1}}cd{{entry.url}}')
    expect(caretUnit).toBe(6)
  })

  it('clamps out-of-range offsets instead of throwing', () => {
    const { segments: next } = spliceSegmentsAtUnits(
      segments,
      [textSegment('!')],
      99,
      120,
    )
    expect(serializeTokenSegments(next)).toBe('ab{{var:v1}}cd!')
  })

  it('merges adjacent text runs after a splice', () => {
    const { segments: next } = spliceSegmentsAtUnits(
      segments,
      [],
      2,
      3,
    )
    expect(next).toEqual([{ type: 'text', value: 'abcd' }])
  })
})

describe('hasUnmaterializedTokens (AGL-586)', () => {
  it('spots complete raw tokens still living in text runs', () => {
    expect(hasUnmaterializedTokens([textSegment('a {{var:x}} b')])).toBe(true)
    expect(
      hasUnmaterializedTokens([textSegment('a '), tokenSegment('{{var:x}}')]),
    ).toBe(false)
    expect(hasUnmaterializedTokens([textSegment('open {{ only')])).toBe(false)
  })
})

describe('resolveTokenLabel (AGL-586)', () => {
  const context: TokenLabelContext = {
    options: [
      { group: 'Variables', label: 'Message', token: '{{var:v1}}' },
      { group: 'Functions', label: 'Sum(P1, P2)', token: '{{fn:f1(P1, P2)}}' },
    ],
    variables: { v2: { name: 'Tagline' } },
    functions: { f2: { name: 'Shout' } },
    datasetFields: [{ id: 'fld1', label: 'Author' }],
  }

  it('resolves a variable id through the host docs', () => {
    expect(resolveTokenLabel('{{var:v2}}', context)).toEqual({
      label: 'Tagline',
      group: 'variable',
      known: true,
    })
  })

  it('falls back to the picker options for variable labels', () => {
    expect(resolveTokenLabel('{{var:v1}}', context)).toEqual({
      label: 'Message',
      group: 'variable',
      known: true,
    })
  })

  it('marks a deleted variable unknown but keeps the shape group', () => {
    expect(resolveTokenLabel('{{var:gone}}', context)).toEqual({
      label: 'gone',
      group: 'variable',
      known: false,
    })
  })

  it('resolves a function id even when the stored args differ', () => {
    expect(resolveTokenLabel('{{fn:f2(40, 2)}}', context)).toEqual({
      label: 'Shout',
      group: 'function',
      known: true,
    })
    // Option prefix match: the picker option holds parameter placeholders.
    expect(resolveTokenLabel('{{fn:f1(7, 8)}}', context)).toEqual({
      label: 'Sum(P1, P2)',
      group: 'function',
      known: true,
    })
  })

  it('resolves entry and collection tokens from the catalogs', () => {
    expect(resolveTokenLabel('{{entry.title}}', {})).toEqual({
      label: 'Title',
      group: 'entry',
      known: true,
    })
    expect(resolveTokenLabel('{{collection.name}}', {})).toEqual({
      label: 'Collection name',
      group: 'collection',
      known: true,
    })
    expect(resolveTokenLabel('{{entry.nope}}', {})).toEqual({
      label: 'entry.nope',
      group: 'entry',
      known: false,
    })
  })

  it('resolves dataset-item tokens against the ancestor model fields', () => {
    expect(resolveTokenLabel('{{item.fld1}}', context)).toEqual({
      label: 'Author',
      group: 'dataset',
      known: true,
    })
    expect(resolveTokenLabel('{{item.other}}', context)).toEqual({
      label: 'item.other',
      group: 'dataset',
      known: false,
    })
  })

  it('labels a one-hop reference token through the field + hop id', () => {
    const resolved = resolveTokenLabel('{{item.fld1.displayName}}', context)
    expect(resolved.group).toBe('dataset')
    expect(resolved.known).toBe(true)
    expect(resolved.label.startsWith('Author → ')).toBe(true)
  })

  it('tolerates whitespace inside the braces', () => {
    expect(resolveTokenLabel('{{ var:v2 }}', context).label).toBe('Tagline')
  })

  it('flags unknown grammar as unknown', () => {
    expect(resolveTokenLabel('{{whatever this is}}', context)).toEqual({
      label: 'whatever this is',
      group: 'unknown',
      known: false,
    })
  })
})
