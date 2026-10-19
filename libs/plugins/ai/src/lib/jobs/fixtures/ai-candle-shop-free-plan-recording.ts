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
 * RECORDED, NOT GOLDEN: the Free candle-shop site plan the beta.260
 * pre-promotion eval recorded on 2026-10-16 (its re-ask, the answer that was
 * refused), copied here by hand so the specs can hold the plan settles to it
 * (AGL-3845, AGL-3969). On an empty site it reuses a layout and duplicates a
 * page the site does not have, and writes descriptions into every section's
 * uses, so the Free wall's trim could take no section.
 */
export const LIVE_CANDLE_ANSWER = {
  "reuse": [
    {
      "kind": "layout",
      "id": "laySite",
      "purpose": "shared site header, navigation and footer for both pages"
    }
  ],
  "create": [
    {
      "kind": "form",
      "name": "newsletterForm",
      "why": "No form exists on the site yet; the newsletter sign-up band needs a form that routes submissions to the inbox.",
      "duplicateOf": null,
      "fields": [
        "email:email",
        "firstName:text",
        "consent:checkbox"
      ]
    }
  ],
  "screens": [
    {
      "title": "Home",
      "slug": "/",
      "layout": "laySite",
      "template": null,
      "duplicateOf": "scrStarter",
      "nav": true,
      "seoTitle": "Willow Wick Candles | Hand-Poured Soy Candles",
      "seoDescription": "Small-batch, hand-poured soy candles made for everyday rituals and thoughtful gifts. Shop Willow Wick Candles online.",
      "sections": [
        {
          "name": "Hero that sells first",
          "uses": [
            "hero"
          ],
          "items": 0
        },
        {
          "name": "Bestsellers",
          "uses": [
            "product grid"
          ],
          "items": 0
        },
        {
          "name": "Shop by collection",
          "uses": [
            "collection tiles"
          ],
          "items": 3
        },
        {
          "name": "Brand story",
          "uses": [
            "story text"
          ],
          "items": 0
        },
        {
          "name": "Why buy here",
          "uses": [
            "benefit list"
          ],
          "items": 4
        },
        {
          "name": "Newsletter sign-up",
          "uses": [
            "new:newsletterForm"
          ],
          "items": 0
        }
      ]
    },
    {
      "title": "Shop",
      "slug": "/shop",
      "layout": "laySite",
      "template": null,
      "duplicateOf": null,
      "nav": true,
      "seoTitle": "Shop Soy Candles | Willow Wick Candles",
      "seoDescription": "Browse every hand-poured soy candle from Willow Wick Candles. Filter by scent, sort by price, and find a gift for someone you love.",
      "sections": [
        {
          "name": "Short title",
          "uses": [
            "page title"
          ],
          "items": 0
        },
        {
          "name": "Product grid",
          "uses": [
            "store product listing"
          ],
          "items": 0
        },
        {
          "name": "Care and shipping help",
          "uses": [
            "help text"
          ],
          "items": 2
        }
      ]
    }
  ],
  "language": "en",
  "photoWords": null
} as const
