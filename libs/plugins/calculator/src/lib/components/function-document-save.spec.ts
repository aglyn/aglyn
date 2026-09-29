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
  PRINT_HIDE_ATTRIBUTE,
  PRINT_TARGET_ATTRIBUTE,
  copyFunctionDocumentText,
  fillDocumentTitle,
  functionDocumentText,
  printFunctionDocument,
  shareFunctionDocumentText,
} from './function-document-save'

/**
 * WHAT A CALCULATOR HANDS OVER (AGL-3387): the region is printed alone and
 * the page is handed back exactly as it was.
 */
function page() {
  document.head.innerHTML = '<style id="site">body{}</style>'
  document.body.innerHTML = `
    <header id="header">Site header</header>
    <main id="main">
      <section id="intro">Intro</section>
      <section id="calc">
        <div id="inputs">Inputs</div>
        <div id="doc"><h2>Receipt</h2><p>Visit — 2 hr</p><p>Total <span>$165.00</span></p></div>
        <button id="save">Save</button>
      </section>
    </main>
    <footer id="footer">Footer</footer>`
  document.title = 'Pricing | Ready To Roll'
  return document.getElementById('doc') as HTMLElement
}

describe('fillDocumentTitle', () => {
  const values: Record<string, string> = { number: 'RTR-1001', customer: 'Pat Miller', empty: '' }
  const read = (name: string) => values[name] ?? ''

  it('fills names in braces from the calculator', () => {
    expect(fillDocumentTitle('Receipt {number} {customer}', read)).toBe('Receipt RTR-1001 Pat Miller')
    expect(fillDocumentTitle('Receipt { number }', read)).toBe('Receipt RTR-1001')
  })

  it('fills an unknown or empty name with nothing and drops the dangling separator', () => {
    expect(fillDocumentTitle('Receipt — {empty}', read)).toBe('Receipt')
    expect(fillDocumentTitle('Quote {missing}', read)).toBe('Quote')
  })

  it('falls back when nothing is left', () => {
    expect(fillDocumentTitle('', read)).toBe('Document')
    expect(fillDocumentTitle('{empty}', read, 'Receipt')).toBe('Receipt')
  })
})

describe('printFunctionDocument', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('prints the document alone, under its own title, and puts the page back after', () => {
    const target = page()
    let duringPrint: { hidden: string[]; title: string; style: string; target: boolean } | null = null
    jest.spyOn(window, 'print').mockImplementation(() => {
      duringPrint = {
        hidden: Array.from(document.querySelectorAll(`[${PRINT_HIDE_ATTRIBUTE}]`)).map((e) => e.id),
        title: document.title,
        style: document.getElementById('aglyn-function-document-print')?.textContent ?? '',
        target: target.hasAttribute(PRINT_TARGET_ATTRIBUTE),
      }
    })

    expect(printFunctionDocument(target, { title: 'Receipt RTR-1001', paper: 'a4', margin: 6 })).toBe(true)

    expect(duringPrint).not.toBeNull()
    const seen = duringPrint as unknown as { hidden: string[]; title: string; style: string; target: boolean }
    // Every sibling along the way up is left out; the ancestors stay.
    expect(seen.hidden.sort()).toEqual(['footer', 'header', 'inputs', 'intro', 'save'].sort())
    expect(seen.title).toBe('Receipt RTR-1001')
    expect(seen.target).toBe(true)
    expect(seen.style).toContain('size: A4')
    expect(seen.style).toContain('margin: 6mm')
    // The site's own stylesheet was never hidden.
    expect(document.getElementById('site')?.hasAttribute(PRINT_HIDE_ATTRIBUTE)).toBe(false)

    window.dispatchEvent(new Event('afterprint'))
    expect(document.querySelectorAll(`[${PRINT_HIDE_ATTRIBUTE}]`)).toHaveLength(0)
    expect(target.hasAttribute(PRINT_TARGET_ATTRIBUTE)).toBe(false)
    expect(document.getElementById('aglyn-function-document-print')).toBeNull()
    expect(document.title).toBe('Pricing | Ready To Roll')
  })

  it('uses Letter with a normal margin when none is given, and no size for the printer’s own', () => {
    const target = page()
    const styles: string[] = []
    jest.spyOn(window, 'print').mockImplementation(() => {
      styles.push(document.getElementById('aglyn-function-document-print')?.textContent ?? '')
    })
    printFunctionDocument(target)
    window.dispatchEvent(new Event('afterprint'))
    printFunctionDocument(target, { paper: 'auto' })
    window.dispatchEvent(new Event('afterprint'))
    expect(styles[0]).toContain('size: letter; margin: 12mm')
    expect(styles[1]).not.toContain('size:')
  })

  it('hands the page back when printing throws', () => {
    const target = page()
    jest.spyOn(window, 'print').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(printFunctionDocument(target, { title: 'Receipt' })).toBe(false)
    expect(document.querySelectorAll(`[${PRINT_HIDE_ATTRIBUTE}]`)).toHaveLength(0)
    expect(document.title).toBe('Pricing | Ready To Roll')
  })
})

describe('functionDocumentText', () => {
  it('puts each block on its own line and keeps inline text together', () => {
    const target = page()
    expect(functionDocumentText(target)).toBe('Receipt\nVisit — 2 hr\nTotal $165.00')
  })

  it('reads a document that is not displayed', () => {
    const target = page()
    target.style.display = 'none'
    expect(functionDocumentText(target)).toBe('Receipt\nVisit — 2 hr\nTotal $165.00')
  })
})

describe('copy and share', () => {
  const navigatorRef = window.navigator as Navigator & { share?: unknown; clipboard?: unknown }
  const original = { share: navigatorRef.share, clipboard: navigatorRef.clipboard }
  afterEach(() => {
    Object.defineProperty(navigatorRef, 'share', { value: original.share, configurable: true })
    Object.defineProperty(navigatorRef, 'clipboard', { value: original.clipboard, configurable: true })
  })

  it('copies through the clipboard', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigatorRef, 'clipboard', { value: { writeText }, configurable: true })
    await expect(copyFunctionDocumentText('Total $165.00')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('Total $165.00')
  })

  it('shares through the share sheet, and treats a cancel as a cancel', async () => {
    const share = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigatorRef, 'share', { value: share, configurable: true })
    await expect(shareFunctionDocumentText('Receipt', 'Total')).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: 'Receipt', text: 'Total' })
    share.mockRejectedValueOnce(Object.assign(new Error('cancel'), { name: 'AbortError' }))
    await expect(shareFunctionDocumentText('Receipt', 'Total')).resolves.toBe('cancelled')
  })

  it('copies instead where there is no share sheet', async () => {
    Object.defineProperty(navigatorRef, 'share', { value: undefined, configurable: true })
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigatorRef, 'clipboard', { value: { writeText }, configurable: true })
    await expect(shareFunctionDocumentText('Receipt', 'Total')).resolves.toBe('copied')
  })
})
