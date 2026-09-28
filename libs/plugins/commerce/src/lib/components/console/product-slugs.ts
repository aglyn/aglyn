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
  collection,
  type Firestore,
  getDocs,
  query,
  where,
} from 'firebase/firestore'

/** Firestore's cap on the values of one `in`. */
const SLUG_IN_MAX = 30

/** Suffixed candidates asked for together once a slug turns out to be held. */
const SLUG_PROBE = 10

/**
 * Which slugs the site's products already hold, asked of the STORE (AGL-3321).
 *
 * The CSV importer, Duplicate and the AI drafts each pick a slug no product
 * has. They used to ask the rows the products table had loaded — five hundred
 * of them — so a slug held by a product past that window was handed out
 * again. The table now holds one page, which would make that worse; so the
 * question goes to the store instead, by `slug in […]`, which Firestore's
 * automatic single-field index answers.
 *
 * A SOFT-DELETED product still holds its slug. The storefront resolves
 * `/products/{slug}` with `where('slug', '==', …).limit(1)` and 404s a deleted
 * match, so a live product sharing a deleted one's slug can be shadowed by it.
 *
 * `claim` hands out the first of `base`, `base-2`, `base-3`, … that no
 * product holds and this ledger has not already handed out, so one batch
 * cannot give two products the same slug either. A ledger is for one action;
 * a new action starts a new one.
 */
export interface ProductSlugLedger {
  /** Ask the store about these slugs, in `in` chunks; each is asked once. */
  ask(slugs: Iterable<string>): Promise<void>
  /** The first free slug from `base`, now held by this ledger. */
  claim(base: string): Promise<string>
}

export function productSlugLedger(
  firestore: Firestore,
  hostId: string,
): ProductSlugLedger {
  const held = new Set<string>()
  const asked = new Set<string>()
  const productsRef = collection(firestore, 'hosts', hostId, 'products')

  const ask = async (slugs: Iterable<string>) => {
    const fresh = [...new Set([...slugs].filter((slug) => slug && !asked.has(slug)))]
    for (const slug of fresh) asked.add(slug)
    const chunks = Array.from(
      { length: Math.ceil(fresh.length / SLUG_IN_MAX) },
      (_, index) => fresh.slice(index * SLUG_IN_MAX, (index + 1) * SLUG_IN_MAX),
    )
    const reads = await Promise.all(
      chunks.map((chunk) => getDocs(query(productsRef, where('slug', 'in', chunk)))),
    )
    for (const read of reads) {
      for (const product of read.docs) held.add(String(product.get('slug') ?? ''))
    }
  }

  const candidate = (base: string, suffix: number) =>
    suffix < 2 ? base : `${base}-${suffix}`

  const claim = async (base: string) => {
    for (let suffix = 1; ; suffix += 1) {
      const slug = candidate(base, suffix)
      if (!asked.has(slug)) {
        await ask(
          Array.from({ length: SLUG_PROBE }, (_, offset) => candidate(base, suffix + offset)),
        )
      }
      if (!held.has(slug)) {
        held.add(slug)
        return slug
      }
    }
  }

  return { ask, claim }
}
