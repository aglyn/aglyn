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

import type { SiteChatTool } from '@aglyn/aglyn/plugin-manager/plugin-site-chat-tools'

/**
 * The store's tools for the AI chat on its site (AGL-4250), as the chat
 * offers them to the model: names, descriptions and argument schemas only.
 * What each one does is `server/site-chat-tools.ts`, loaded on its first
 * call, so the boot that registers them reads nothing.
 */

type Definition = Omit<SiteChatTool, 'run'>

export const COMMERCE_SITE_CHAT_TOOLS: readonly Definition[] = [
  {
    name: 'commerce_product_details',
    kind: 'lookup',
    capability: 'answer',
    description:
      "A product's options, prices (and sale prices), whether it asks for the day it will be used, and whether it has add-ons to choose. Use it before offering to add a product, or when a visitor asks about a product's options or price.",
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: "The product's name, as the visitor or the site calls it." },
      },
      required: ['product'],
      additionalProperties: false,
    },
  },
  {
    name: 'commerce_propose_add_to_cart',
    kind: 'proposal',
    capability: 'cart',
    endpoints: ['commerce/cart'],
    description:
      'Offer the visitor a card to add one product to their cart. Only once you know the product, its option where it has several, and the day where it asks for one. The visitor presses the card to add it; nothing is added before.',
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: "The product's name." },
        option: { type: 'string', description: 'The option the visitor chose, such as "Adult" or "Large"; empty when the product has one.' },
        quantity: { type: 'integer', description: 'How many, 1 or more.' },
        day: { type: 'string', description: 'The day it will be used, YYYY-MM-DD, for a product that asks; otherwise empty.' },
      },
      required: ['product', 'option', 'quantity', 'day'],
      additionalProperties: false,
    },
  },
  {
    name: 'commerce_stay_availability',
    kind: 'lookup',
    capability: 'answer',
    description:
      'Whether a stay (a cabin, a room, a campsite) is free for the nights from a check-in day to a check-out day, and its nightly price. Use it whenever a visitor asks if dates are free.',
    inputSchema: {
      type: 'object',
      properties: {
        stay: { type: 'string', description: "The stay's name." },
        checkIn: { type: 'string', description: 'Check-in day, YYYY-MM-DD.' },
        checkOut: { type: 'string', description: 'Check-out day, YYYY-MM-DD.' },
      },
      required: ['stay', 'checkIn', 'checkOut'],
      additionalProperties: false,
    },
  },
  {
    name: 'commerce_propose_reservation',
    kind: 'proposal',
    capability: 'book',
    endpoints: ['commerce/reserve'],
    description:
      'Offer the visitor a card to reserve a stay for free dates, after commerce_stay_availability showed them free. The visitor enters their name and email on the card and pays at the normal checkout.',
    inputSchema: {
      type: 'object',
      properties: {
        stay: { type: 'string', description: "The stay's name." },
        checkIn: { type: 'string', description: 'Check-in day, YYYY-MM-DD.' },
        checkOut: { type: 'string', description: 'Check-out day, YYYY-MM-DD.' },
        guests: { type: 'integer', description: 'How many guests; 0 when the visitor did not say.' },
      },
      required: ['stay', 'checkIn', 'checkOut', 'guests'],
      additionalProperties: false,
    },
  },
]
