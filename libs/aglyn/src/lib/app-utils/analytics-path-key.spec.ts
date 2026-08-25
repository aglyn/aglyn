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
 * The map key a path is counted under (AGL-2498).
 *
 * This function is only interesting because TWO sides call it: the tenant's
 * `/api/analytics/collect` writes `paths[analyticsPathKey(path)]`, and the
 * console's entry traffic card READS one key back out of that map. They agree
 * or the card reports a page nobody could tell was being under-counted —
 * a swallowed lookup renders as a measured zero, and zero is indistinguishable
 * from "nobody read it".
 *
 * So these cases are not about the substitution being clever. They pin the
 * exact behaviour a second implementation would get subtly wrong.
 */
import { analyticsPathKey } from './analytics-path-key'

describe('analyticsPathKey', () => {
  it('leaves an ordinary entry path alone', () => {
    // The overwhelmingly common case, and the one the entry card depends on:
    // `/{collectionSlug}/{entrySlug}` contains nothing that needs folding, so
    // the key IS the path and a reader can build it by hand.
    expect(analyticsPathKey('/blog/multi-tenant-by-design-orgs-and-hosts')).toBe(
      '/blog/multi-tenant-by-design-orgs-and-hosts',
    )
  })

  it('counts an empty path as the home page', () => {
    // `''` is what a router reports for the root on some clients. Counting it
    // under its own empty key would split the home page's traffic in two.
    expect(analyticsPathKey('')).toBe('/')
  })

  it('folds every character Firestore cannot hold in a map key', () => {
    // `.`, `$`, `#`, `[` and `]` cannot be parsed as field paths on read.
    expect(analyticsPathKey('/a.b$c#d[e]f')).toBe('/a_b_c_d_e_f')
  })

  it('is LOSSY, and deliberately stays that way', () => {
    // `/a.b` and `/a_b` share a key. That has been true of every count ever
    // written, so it cannot be "fixed" without orphaning the history — this
    // case exists so a future reader finds the decision rather than the bug.
    expect(analyticsPathKey('/a.b')).toBe(analyticsPathKey('/a_b'))
  })

  it('caps the key so an attacker cannot mint an unbounded map', () => {
    // The path arrives on an unauthenticated endpoint and becomes a map key
    // on a document that already holds every other path.
    const long = `/${'x'.repeat(500)}`
    expect(analyticsPathKey(long)).toHaveLength(200)
  })

  it('preserves a query-less path exactly, including its case', () => {
    // Lower-casing would merge `/Blog/Post` with `/blog/post`, which are
    // different URLs and — on a case-sensitive host — different pages.
    expect(analyticsPathKey('/Blog/Post')).toBe('/Blog/Post')
  })
})
