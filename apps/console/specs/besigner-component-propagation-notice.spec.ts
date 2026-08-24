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

/**
 * THE PROPAGATION NOTICE HAS TO WATCH THE LAYOUT TOO (AGL-1898 phase 2).
 *
 * `use-component-propagation-notice.spec.tsx` proves what the hook decides,
 * given documents. What it cannot prove is which documents this page hands
 * it — and the whole feature turns on that, because the component an author
 * goes off to edit is most often the site nav, which lives in the LAYOUT
 * chrome rather than on the screen. Passing only `nodes` would leave the
 * notice permanently silent for the commonest case while every unit test
 * stayed green.
 *
 * Source-level on purpose: `besigner-seo-stale-seed.spec.tsx` already
 * renders this page with the REAL hook, so "it runs without throwing" is
 * covered there. What is left is an argument list, which is a two-line thing
 * that reads plausible with either document missing.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SCREEN_BESIGNER = join(
  __dirname,
  '..',
  'app',
  '(editor)',
  '[orgSlug]',
  'hosts',
  '[host]',
  'screens',
  '[screenId]',
  'versions',
  '[versionId]',
  'besigner',
  'page.tsx',
)

describe('the component-propagation notice is wired to both documents (AGL-1898)', () => {
  const source = readFileSync(SCREEN_BESIGNER, 'utf8')

  /** The hook call's argument object, from the call to its closing brace. */
  const callSite = () => {
    const at = source.indexOf('useComponentPropagationNotice({')
    expect(at).toBeGreaterThan(-1)
    return source.slice(at, source.indexOf('\n  })', at))
  }

  it('passes the screen nodes AND the bound layout version nodes', () => {
    const call = callSite()
    expect(call).toMatch(/documents:\s*\[/)
    expect(call).toContain('nodes as Record<string, unknown> | undefined')
    // The layout half. Its absence is the silent failure this file exists
    // for — a nav published in another tab would never be announced.
    expect(call).toContain('layoutVersionResult?.data?.nodes')
  })

  it('feeds it the live definitions map, not a one-shot read', () => {
    // `componentDefinitions` is the listener's map. Anything else here would
    // be a snapshot that never changes, and a notice that never fires.
    expect(callSite()).toMatch(/definitions:\s*componentDefinitions/)
  })

  it('names components from the definition docs rather than their ids', () => {
    const call = callSite()
    expect(call).toMatch(/names:\s*componentNames/)
    expect(source).toMatch(/componentNames\s*=\s*useMemo/)
    expect(source).toContain('definition.displayName')
  })

  it('says it with the shared copy, not a string invented here', () => {
    // Two surfaces wording the same event differently is how "updated" ends
    // up describing a component that was deleted.
    expect(source).toContain('describeComponentPropagation(changes)')
  })

  it('reads the definitions listener rather than adding a second one', () => {
    // The notice must add no reads: one `useHostComponentDefinitions` call
    // on this page, shared by the chrome graft and the notice.
    const occurrences = source.split('useHostComponentDefinitions(').length - 1
    expect(occurrences).toBe(1)
  })
})
