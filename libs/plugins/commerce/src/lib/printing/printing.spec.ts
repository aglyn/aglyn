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

import type { ReceiptData } from '../model/commerce-receipt'
import {
  code128Printable,
  layoutDrawerKick,
  layoutReceipt,
  layoutReport,
  layoutTestPage,
  toPrintable,
  twoColumnLines,
  wrapText,
} from './print-document'
import {
  EPSON_DRAWER_KICK,
  epsonJobId,
  epsonLogoKeys,
  parseEpsonPrintResults,
  renderEposPrint,
  renderEpsonServerDirectPrint,
} from './render-epson'
import { renderStar, STAR_DRAWER_KICK, starLogoNumber } from './render-star'
import { renderText } from './render-text'

const RECEIPT: ReceiptData = {
  storeName: 'Corner Café',
  storeLines: ['12 Main St, Springfield'],
  orderNumber: '1042',
  orderId: 'order1',
  createdAtMs: Date.UTC(2026, 9, 6, 20, 4),
  timeZone: 'America/Chicago',
  registerName: 'Front counter',
  currency: 'usd',
  lines: [
    {
      name: 'Latte',
      detail: 'Oat milk',
      quantity: 2,
      unitCents: 450,
      totalCents: 900,
    },
    {
      name: 'Crème brûlée with a very long name that wraps',
      quantity: 1,
      unitCents: 725,
      totalCents: 725,
    },
  ],
  subtotalCents: 1625,
  discountCents: 100,
  taxCents: 126,
  totalCents: 1651,
  tenders: [{ label: 'Cash', amountCents: 2000 }],
  changeCents: 349,
  barcode: '1042',
  footer: 'Thank you — returns within 30 days.',
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ')

describe('the printer-neutral layout (AGL-3619)', () => {
  it('folds accents and spells punctuation in ASCII', () => {
    expect(toPrintable('Crème brûlée • “hot” – €3…')).toBe(
      'Creme brulee * "hot" - EUR3...',
    )
    expect(toPrintable('日本')).toBe('??')
  })

  it('wraps on words, and breaks a word only when it alone is too long', () => {
    expect(wrapText('one two three four', 9)).toEqual([
      'one two',
      'three',
      'four',
    ])
    expect(wrapText('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl'])
  })

  it('puts the amount flush right, wrapping a long label above it', () => {
    expect(twoColumnLines('Latte', '$9.00', 20)).toEqual([
      'Latte          $9.00',
    ])
    const lines = twoColumnLines(
      'A very long product name indeed',
      '$12.00',
      20,
    )
    expect(lines.at(-1)).toMatch(/\$12\.00$/)
    expect(lines.every((line) => line.length <= 20)).toBe(true)
  })

  it('reduces a barcode to Code128 set B characters', () => {
    expect(code128Printable(' #1042 ')).toBe('#1042')
    expect(code128Printable('x'.repeat(40))).toHaveLength(20)
  })

  it('lays the receipt out to the paper width (48 columns, 80mm)', () => {
    const text = renderText(layoutReceipt(RECEIPT, { columns: 48 }))
    expect(text).toMatchInlineSnapshot(`
      "                  Corner Cafe
                  12 Main St, Springfield

      Order #1042                 Oct 6, 2026, 3:04 PM
      Front counter
      ------------------------------------------------
      2 x Latte                                  $9.00
        Oat milk
        @ $4.50 each
      Creme brulee with a very long name that
      wraps                                      $7.25
      ------------------------------------------------
      Subtotal                                  $16.25
      Discount                                  -$1.00
      Tax                                        $1.26
      TOTAL             $16.51

      Cash                                      $20.00
      Change                                     $3.49

                           [1042]

            Thank you - returns within 30 days.


      "
    `)
    for (const line of text.split('\n'))
      expect(line.length).toBeLessThanOrEqual(48)
  })

  it('fits 58mm paper too (32 columns)', () => {
    const text = renderText(layoutReceipt(RECEIPT, { columns: 32 }))
    for (const line of text.split('\n'))
      expect(line.length).toBeLessThanOrEqual(32)
    expect(text).toContain('TOTAL     $16.51')
  })

  it('opens the drawer FIRST on a cash receipt, so change is made while it prints', () => {
    const ops = layoutReceipt(RECEIPT, {
      columns: 48,
      openDrawer: true,
      logo: true,
    }).ops
    expect(ops[0]).toEqual({ op: 'drawer' })
    expect(ops[1]).toEqual({ op: 'logo' })
    expect(ops.at(-1)).toEqual({ op: 'cut' })
  })

  it('a drawer kick prints nothing', () => {
    expect(layoutDrawerKick(48).ops).toEqual([{ op: 'drawer' }])
  })

  it('a shift report prints its sections as aligned two-column rows (AGL-3609)', () => {
    const document = layoutReport(
      {
        title: 'Z REPORT',
        storeName: 'Corner Café',
        subtitle: 'Front - Closed by Cal',
        sections: [
          { section: 'Sales', rows: [{ label: 'Net sales', value: '$71.60', strong: true }] },
          { section: 'Cash drawer', rows: [{ label: 'Short', value: '-$0.60', strong: true }] },
        ],
      },
      { columns: 32 },
    )
    const text = renderText(document)
    expect(text).toContain('Z REPORT')
    expect(text).toContain('Corner Cafe')
    expect(text).toContain('CASH DRAWER')
    const short = text.split('\n').find((line) => line.startsWith('Short'))!
    expect(short).toHaveLength(32)
    expect(short.endsWith('-$0.60')).toBe(true)
    expect(document.ops.some((op) => op.op === 'drawer')).toBe(false)
    expect(document.ops.at(-1)).toEqual({ op: 'cut' })
  })

  it('a test page names the printer and exercises alignment, emphasis, size and a barcode', () => {
    const document = layoutTestPage({
      columns: 48,
      printerName: 'Counter Star',
      storeName: 'Corner Café',
      atMs: Date.UTC(2026, 9, 6, 20, 4),
    })
    const text = renderText(document)
    expect(text).toContain('TEST PRINT')
    expect(text).toContain('Counter Star')
    expect(text).toContain('[TEST-PRINT]')
    expect(document.ops.some((op) => op.op === 'text' && op.bold)).toBe(true)
    expect(document.ops.some((op) => op.op === 'text' && op.size === 2)).toBe(
      true,
    )
  })
})

describe('Star bytes (application/vnd.star.starprntcore)', () => {
  it('the drawer kick is BEL', () => {
    expect([...STAR_DRAWER_KICK]).toEqual([0x07])
    expect(hex(renderStar(layoutDrawerKick(48)))).toBe('1b 40 07')
  })

  it('renders alignment, emphasis, expansion, Code128, NV logo and the cut', () => {
    const bytes = renderStar(
      {
        columns: 48,
        ops: [
          { op: 'logo' },
          { op: 'text', text: 'Hi', align: 'center', bold: true, size: 2 },
          { op: 'text', text: 'ok' },
          { op: 'barcode', data: '1042' },
          { op: 'drawer' },
          { op: 'cut' },
        ],
      },
      { logoKey: '1' },
    )
    expect(hex(bytes)).toBe(
      [
        '1b 40', // initialize
        '1b 1d 61 01', // center
        '1b 1c 70 01 00', // NV logo 1
        '1b 69 01 01 1b 45 48 69 0a 1b 46 1b 69 00 00', // 2x bold "Hi"
        '1b 1d 61 00 6f 6b 0a', // left "ok"
        '1b 1d 61 01 1b 62 06 02 02 50 31 30 34 32 1e 0a', // Code128 "1042"
        '07', // drawer
        '1b 64 03', // partial cut with feed
      ].join(' '),
    )
  })

  it('prints no logo without a valid NV logo number', () => {
    expect(starLogoNumber('')).toBeNull()
    expect(starLogoNumber('256')).toBeNull()
    expect(starLogoNumber('7')).toBe(7)
    expect(hex(renderStar({ columns: 48, ops: [{ op: 'logo' }] }))).toBe(
      '1b 40',
    )
  })

  it('never emits a non-ASCII byte', () => {
    const bytes = renderStar(layoutReceipt(RECEIPT, { columns: 48 }))
    const text = Array.from(bytes).filter((byte) => byte >= 0x80)
    expect(text).toEqual([])
  })
})

describe('Epson ePOS-Print XML (Server Direct Print)', () => {
  it('the drawer kick is a 100 ms pulse on pin 2', () => {
    expect(EPSON_DRAWER_KICK).toBe(
      '<pulse drawer="drawer_1" time="pulse_100"/>',
    )
    expect(renderEposPrint(layoutDrawerKick(48))).toContain(EPSON_DRAWER_KICK)
  })

  it('wraps the job in PrintRequestInfo 2.00 with its print job id', () => {
    const xml = renderEpsonServerDirectPrint(
      layoutReceipt(RECEIPT, { columns: 48 }),
      {
        jobId: 'Ab_c-1.2/3',
        logoKey: '48,48',
      },
    )
    expect(
      xml.startsWith(
        '<?xml version="1.0" encoding="utf-8"?><PrintRequestInfo Version="2.00">',
      ),
    ).toBe(true)
    expect(xml).toContain('<devid>local_printer</devid>')
    expect(xml).toContain('<printjobid>Ab_c-1.23</printjobid>')
    expect(xml).toContain(
      '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">',
    )
    expect(xml).toContain(
      '<barcode type="code128" hri="below" font="font_a" width="2" height="64">{B1042</barcode>',
    )
    expect(xml).toContain('<cut type="feed"/>')
    expect(xml).toContain(
      '<text>Creme brulee with a very long name that&#10;</text>',
    )
  })

  it('escapes merchant text', () => {
    const xml = renderEposPrint({
      columns: 48,
      ops: [{ op: 'text', text: 'Fish & <Chips>' }],
    })
    expect(xml).toContain('<text>Fish &amp; &lt;Chips&gt;&#10;</text>')
  })

  it('emits an NV logo only for a valid two-byte key', () => {
    expect(epsonLogoKeys('48,48')).toEqual([48, 48])
    expect(epsonLogoKeys('48')).toBeNull()
    expect(
      renderEposPrint(
        { columns: 48, ops: [{ op: 'logo' }] },
        { logoKey: '32, 33' },
      ),
    ).toContain('<logo key1="32" key2="33"/>')
  })

  it('keeps job ids to the 30 characters Epson allows', () => {
    expect(epsonJobId('x'.repeat(40))).toHaveLength(30)
  })

  it('reads the printer results back by print job id', () => {
    const responseFile =
      '<?xml version="1.0" encoding="utf-8"?><PrintResponseInfo Version="2.00">' +
      '<ePOSPrint><Parameter><devid>local_printer</devid><printjobid>job1</printjobid></Parameter>' +
      '<PrintResponse><response xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print" ' +
      'success="true" code="" status="251854870" battery="0"/></PrintResponse></ePOSPrint>' +
      '<ePOSPrint><Parameter><devid>local_printer</devid><printjobid>job2</printjobid></Parameter>' +
      '<PrintResponse><response success="false" code="EPTR_REC_EMPTY" status="252641308" battery="0"/>' +
      '</PrintResponse></ePOSPrint></PrintResponseInfo>'
    expect(parseEpsonPrintResults(responseFile)).toEqual([
      { jobId: 'job1', success: true, code: '', status: 251854870 },
      {
        jobId: 'job2',
        success: false,
        code: 'EPTR_REC_EMPTY',
        status: 252641308,
      },
    ])
    expect(parseEpsonPrintResults('nonsense')).toEqual([])
  })
})
