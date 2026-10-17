/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

import { aiLayoutPromisesContent } from './ai-layout-promised-copy'

describe('a line that promises the page’s content later (AGL-3887)', () => {
  it.each([
    'We are building this space for the words of families we have worked with.',
    'We’re still gathering this section’s stories.',
    'This space will soon hold the words of the couples we have photographed.',
    'This section is being built.',
    'This page is currently under construction.',
    'Client reviews are coming soon.',
    'Testimonials coming soon!',
    'Photos of recent projects are on their way.',
    'Check back soon for reviews from our clients.',
    'Stay tuned for this space.',
    'Kind words from our families — check back soon.',
  ])('reads "%s" as one', (line) => {
    expect(aiLayoutPromisesContent(line)).toBe(true)
  })

  it.each([
    'Coming soon: our spring legal clinic.',
    'New location coming soon to Dublin, Ohio.',
    'Fall gala — details coming soon.',
    'Price coming soon',
    'Our first pieces are being finished now. Check back soon.',
    'Three homes under construction in Grandview this fall.',
    'This page will help you prepare for your first consultation.',
    'We are building a practice around families, not files.',
    'Relaxed, prepared and personal: what a session with us is like.',
  ])('reads "%s" as none', (line) => {
    expect(aiLayoutPromisesContent(line)).toBe(false)
  })
})
