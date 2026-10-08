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
 * RECORDED, NOT GOLDEN: the Portfolio page answer the local Free guided start
 * of 2026-10-08 (job e6XQdRXvnJ, "Juniper Clay Studio", claude-sonnet-5-5)
 * gave, copied verbatim from its replay recording (AGL-3660). Its plan named
 * two sections — "Portfolio Hero" and "Works Gallery", the latter with no
 * items — and the answer gave three: a hero, "Selected works" as six cards,
 * and an inquiry beside the site's form. The reader kept the form and left
 * the works out.
 */
export const AI_JUNIPER_PORTFOLIO_PAGE_ANSWER = {
  "sections": [
    {
      "band": "dark",
      "cols": [],
      "align": "start",
      "blocks": [
        {
          "kind": "eyebrow",
          "col": -1,
          "text": "Juniper Clay Studio",
          "to": "",
          "style": "none",
          "icon": "",
          "items": []
        },
        {
          "kind": "heading",
          "col": -1,
          "text": "Handmade stoneware, shaped slowly.",
          "to": "",
          "style": "large",
          "icon": "",
          "items": []
        },
        {
          "kind": "lede",
          "col": -1,
          "text": "A selection of recent work from Juniper Clay Studio, made for galleries, shops and collectors.",
          "to": "",
          "style": "none",
          "icon": "",
          "items": []
        },
        {
          "kind": "button",
          "col": -1,
          "text": "Get in touch",
          "to": "form",
          "style": "primary",
          "icon": "",
          "items": []
        }
      ]
    },
    {
      "band": "plain",
      "cols": [],
      "align": "start",
      "blocks": [
        {
          "kind": "heading",
          "col": -1,
          "text": "Selected works",
          "to": "",
          "style": "none",
          "icon": "",
          "items": []
        },
        {
          "kind": "cards",
          "col": -1,
          "text": "",
          "to": "",
          "style": "none",
          "icon": "",
          "items": [
            {
              "title": "Stoneware vessels",
              "text": "Thrown forms with quiet, matte glazes.",
              "to": "",
              "icon": "camera"
            },
            {
              "title": "Tableware",
              "text": "Bowls, plates and cups made for daily use.",
              "to": "",
              "icon": "camera"
            },
            {
              "title": "Sculptural pieces",
              "text": "Hand-built forms for the gallery wall and plinth.",
              "to": "",
              "icon": "camera"
            },
            {
              "title": "Vases",
              "text": "Tall and narrow shapes with textured surfaces.",
              "to": "",
              "icon": "camera"
            },
            {
              "title": "Exhibition pieces",
              "text": "Work shown in recent exhibitions.",
              "to": "",
              "icon": "camera"
            },
            {
              "title": "Studio details",
              "text": "Close views of glaze, clay and finish.",
              "to": "",
              "icon": "camera"
            }
          ]
        }
      ]
    },
    {
      "band": "soft",
      "cols": [
        1,
        1
      ],
      "align": "start",
      "blocks": [
        {
          "kind": "heading",
          "col": 0,
          "text": "Interested in a piece or an exhibition?",
          "to": "",
          "style": "none",
          "icon": "",
          "items": []
        },
        {
          "kind": "text",
          "col": 0,
          "text": "Galleries, shop buyers and collectors are welcome to send an inquiry. Tell us what you are looking for and Juniper Clay Studio will reply.",
          "to": "",
          "style": "none",
          "icon": "",
          "items": []
        },
        {
          "kind": "form",
          "col": 1,
          "text": "",
          "to": "VA0eQnc5VQ",
          "style": "none",
          "icon": "",
          "items": []
        }
      ]
    }
  ]
} as const

/** The plan's sections for that page, as the job planned them. */
export const AI_JUNIPER_PORTFOLIO_PLANNED_SECTIONS = [
  { name: 'Portfolio Hero', uses: [] as string[], items: 0 },
  { name: 'Works Gallery', uses: [] as string[], items: 0 },
]
