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

import { renderWaiverPdf, textWidth, wrapText, type WaiverPdfInput } from './waiver-pdf'

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
})
