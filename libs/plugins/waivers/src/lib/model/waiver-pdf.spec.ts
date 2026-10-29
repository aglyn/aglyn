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

import { createHash } from 'node:crypto'
import { textWidth, wrapText } from '@aglyn/shared-util-tools/pdf/pdf-text'
import { renderWaiverPdf, type WaiverPdfInput } from './waiver-pdf'

/** The hand-written signed copy (AGL-4042): a well-formed PDF a reader opens, holding what was signed. */

const INPUT: WaiverPdfInput = {
  businessName: 'Acme Motocross',
  title: 'Rider release (2026)',
  version: 2,
  bodyText: 'Motocross is dangerous.\n\n• Wear a helmet — always.',
  checkboxes: ['I have read this waiver.'],
  validityText: 'Good for one visit',
  signerLines: [
    ['Name', 'Jordan Lee'],
    ['Date of birth', '1990-04-02'],
  ],
  minors: [{ name: 'Pat Lee', dateOfBirth: '2014-09-30' }],
  relationship: 'Parent',
  signature: { kind: 'drawn', strokes: [[[0, 0], [500, 500], [1000, 1000]]] },
  consentText: 'I agree to sign electronically.',
  auditLines: [['IP address', '203.0.113.7']],
  sha256: 'ab'.repeat(32),
}

const text = (bytes: Uint8Array) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')

describe('the signed copy PDF', () => {
  it('is a PDF whose cross-reference table points at every object', () => {
    const pdf = text(renderWaiverPdf(INPUT))
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true)
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true)
    const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)?.[1])
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref')
    const offsets = pdf
      .slice(startxref)
      .split('\n')
      .filter((line) => /^\d{10} 00000 n $/.test(line))
      .map((line) => Number(line.slice(0, 10)))
    offsets.forEach((offset, index) => {
      expect(pdf.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`)
    })
  })

  it('carries the words, the signer, the minor and the fingerprint, with parentheses escaped', () => {
    const pdf = text(renderWaiverPdf(INPUT))
    expect(pdf).toContain('(Rider release \\(2026\\)) Tj')
    expect(pdf).toContain('(Jordan Lee) Tj')
    expect(pdf).toContain('Pat Lee, born 2014-09-30')
    expect(pdf).toContain(`SHA-256 ${'ab'.repeat(32)}`)
    // The bullet and the dash in WinAnsi, as octal escapes.
    expect(pdf).toContain('\\225 Wear a helmet \\227 always.')
  })

  it('redraws a drawn signature as strokes and prints a typed one', () => {
    expect(text(renderWaiverPdf(INPUT))).toMatch(/ m [\d. ]+ l [\d. ]+ l S/)
    expect(text(renderWaiverPdf({ ...INPUT, signature: { kind: 'typed', text: 'Jordan Lee' } }))).toContain('/F3 24 Tf')
  })

  it('runs onto more pages for a long waiver, numbering each', () => {
    const pdf = text(renderWaiverPdf({ ...INPUT, bodyText: Array(120).fill('A paragraph of the waiver that goes on.').join('\n\n') }))
    const count = Number(/\/Count (\d+)/.exec(pdf)?.[1])
    expect(count).toBeGreaterThan(1)
    expect(pdf).toContain(`page ${count} of ${count}`)
  })

  it('wraps words to the width and breaks one longer than a line', () => {
    const lines = wrapText('alpha beta gamma delta epsilon', 10, 60)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(textWidth(line, 10)).toBeLessThanOrEqual(60)
    expect(wrapText('x'.repeat(200), 10, 100).length).toBeGreaterThan(1)
  })

  it('prints a character Helvetica cannot draw as the nearest one it can, never as a broken byte', () => {
    const pdf = text(renderWaiverPdf({ ...INPUT, signerLines: [['Name', 'Łukasz Nowak 🎉']] }))
    expect(pdf).toContain('(Lukasz Nowak ) Tj')
    expect([...pdf.slice(pdf.indexOf('stream'), pdf.lastIndexOf('endstream'))].every((char) => char.charCodeAt(0) < 128)).toBe(true)
  })
})

/**
 * The signed copy's exact bytes for a spread of signatures, measured from the
 * writer as it stood inside this plugin before it became the shared one
 * (`@aglyn/shared-util-tools/pdf/*`). A copy made again from the same record
 * must be the same file, so these never change unless the layout does.
 */
describe('the signed copy is the same file it always was', () => {
  const BASE: WaiverPdfInput = {
    ...INPUT,
    signature: { kind: 'drawn', strokes: [[[0, 0], [500, 500], [1000, 1000]], [[250, 250]]] },
    signerLines: [['Name', 'Jordan Lee'], ['Date of birth', '1990-04-02']],
  }
  const CASES: Record<string, [WaiverPdfInput, string]> = {
    drawn: [BASE, 'b15f5e866cbcbad27ddc1691026887d041d3f7a6e5b3a06bfa385265bd26b254'],
    typed: [
      { ...BASE, signature: { kind: 'typed', text: 'Jordan Lee' }, minors: [], relationship: null },
      'fe77622c2841fa71913c2f814a787c1401e19e878f27ea58e78e4eb2ded9ab9b',
    ],
    paper: [
      { ...BASE, signature: { kind: 'paper' }, consentText: null, checkboxes: [] },
      '9c76b7cf62a2bda3f94c2ba5bd3705da3bc12db763fea84f83e521c505f6bc1e',
    ],
    voided: [
      { ...BASE, voidedText: 'VOIDED on 2026-10-01: signed for the wrong rider' },
      'eb9f4092cfe5de6b9866b91abd67d9f5aa1e7f149d64451c4424b75055c90615',
    ],
    long: [
      { ...BASE, bodyText: Array(140).fill('A paragraph of the waiver that goes on (and on) \\ with a backslash.').join('\n\n') },
      'b92c79c85a88ffaf743af9ebc836e17743638d5e78895124447a6bb595fd7e4c',
    ],
    latin: [
      {
        ...BASE,
        businessName: 'Café Zoë © Señor’s “Best” — Résumé… €5 ™',
        bodyText: 'Ångström façade naïve coöperate déjà vu ¿Qué? ¡Sí! ½ ¼ ° ± × ÷ ß æ ø Ø',
        signerLines: [['Name', 'Zoë Ærøskøbing'], ['Note', 'It’s ‘fine’']],
      },
      'd5bb8e187837723f9fbb154d56bcdf802b20623006569dc2711cd037e88a621c',
    ],
  }
  it.each(Object.entries(CASES))('%s', (_, [input, sha256]) => {
    expect(createHash('sha256').update(renderWaiverPdf(input)).digest('hex')).toBe(sha256)
  })
})
