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
 *
 * @jest-environment node
 */

import { productCard } from './product-card'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))

describe('what a product looks like to a surface that is not commerce’s', () => {
  it('captions the LOWEST variant price, which is the rule a caller must not copy', () => {
    expect(
      productCard('p1', {
        name: 'Aeron Chair',
        slug: 'aeron-chair',
        imageUrl: 'https://cdn.example/aeron.jpg',
        variants: [{ priceUsd: 1295 }, { priceUsd: 995 }, { priceUsd: 1100 }],
      }),
    ).toEqual({
      title: 'Aeron Chair',
      caption: '$995',
      imageUrl: 'https://cdn.example/aeron.jpg',
      path: '/products/aeron-chair',
    })
  })

  it('falls back to the first media url, and to the id for a product with no name', () => {
    expect(productCard('p2', { mediaUrls: ['https://cdn.example/a.jpg'], variants: [] })).toEqual({
      title: 'p2',
      imageUrl: 'https://cdn.example/a.jpg',
    })
  })

  it('claims no price, image or address it does not have', () => {
    expect(productCard('p3', { name: 'Draft', variants: [{ priceUsd: 0 }] })).toEqual({
      title: 'Draft',
    })
  })
})
