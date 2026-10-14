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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * Copies of a buyer's order email, asked for by another plugin (AGL-3699).
 *
 * Some services learn about a sale by being copied on the mail the buyer
 * already gets: Trustpilot gives every business an invitation address, and
 * an order email blind-copied to it — with a small structured-data block
 * naming the buyer and the order — becomes a review invitation. A plugin
 * that wants that registers here; the seller asks just before it sends a
 * buyer email about an order, adds whatever blind copies and data blocks
 * come back, and tells each provider whether the message left.
 *
 * The words are an order email's: a site, the record, which email (its
 * designable key), which moment, the buyer's address, and the order as the
 * seller's public API shapes it. A provider answers `null` to add nothing.
 * Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-order-email-copies`); it is not in the
 * barrel.
 */

export interface PluginOrderEmailCopyRequest {
  hostId: string
  recordId: string
  /** The designable email being sent, e.g. `order-shipped`. */
  emailKey: string
  /** The moment in the order's life, e.g. `shipped`, `delivered`, `picked_up`. */
  moment: string
  /** The buyer's address the email is to. */
  recipient: string
  /** The order as the seller's public API returns it. */
  order: Readonly<Record<string, unknown>>
  signal?: AbortSignal
}

/** A structured-data block a copy's reader looks for in the HTML part. */
export interface PluginOrderEmailDataBlock {
  /** The `<script type>`: `application/json`, `application/ld+json` or `application/json+<name>`. */
  type: string
  json: unknown
}

export interface PluginOrderEmailCopy {
  /** Addresses blind-copied on the message. */
  bcc: string[]
  /** Blocks added to the HTML part, where only a machine reads them. */
  dataBlocks?: PluginOrderEmailDataBlock[]
  /**
   * Told once whether the message left with these copies on it, so a
   * provider that claimed the order can keep or release its claim. Never
   * throws into the seller.
   */
  settle?: (sent: boolean) => Promise<void>
}

export type PluginOrderEmailCopyProvider = (
  request: PluginOrderEmailCopyRequest,
) => Promise<PluginOrderEmailCopy | null>

const PLUGIN_ORDER_EMAIL_COPIES = definePluginServiceContract<PluginOrderEmailCopyProvider>(
  'core.order-email-copies',
  { multiple: true },
)

/** Joins the providers. Re-registering under the same plugin replaces its own. */
export function registerPluginOrderEmailCopies(
  provider: PluginOrderEmailCopyProvider,
  options?: { pluginId?: string },
): void {
  const pluginId = getRegisteringPluginId() ?? options?.pluginId
  registerPluginService(PLUGIN_ORDER_EMAIL_COPIES, provider, {
    ...(pluginId ? { pluginId } : {}),
  })
}

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/
const DATA_TYPE = /^application\/(ld\+)?json(\+[a-z0-9-]{1,40})?$/

/** The copies every provider asked for on one email, joined. */
export interface ResolvedOrderEmailCopies {
  bcc: string[]
  /** The data blocks as markup, ready to go before `</body>`; `''` when none. */
  html: string
  /** Tells every provider that answered whether the message left. Never throws. */
  settle: (sent: boolean) => Promise<void>
}

/**
 * A data block as a `<script>` element. The JSON is escaped so no value can
 * close the element or open markup of its own.
 */
export function orderEmailDataBlockHtml(block: PluginOrderEmailDataBlock): string {
  const json = JSON.stringify(block.json ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `<script type="${block.type}">${json}</script>`
}

/** Puts `markup` just before `</body>`, or at the end of a fragment with none. */
export function withOrderEmailDataBlocks(html: string, markup: string): string {
  if (!markup) return html
  const close = html.toLowerCase().lastIndexOf('</body>')
  return close === -1 ? `${html}${markup}` : `${html.slice(0, close)}${markup}${html.slice(close)}`
}

/**
 * Asks every provider, together, and gives up on any that has not answered
 * after `timeoutMs` — a late answer adds nothing and is told the message
 * did not carry it. A provider that throws adds nothing. Never throws.
 */
export async function resolvePluginOrderEmailCopies(
  request: Omit<PluginOrderEmailCopyRequest, 'signal'>,
  options: { timeoutMs: number },
): Promise<ResolvedOrderEmailCopies> {
  const providers = resolvePluginServices(PLUGIN_ORDER_EMAIL_COPIES)
  const empty: ResolvedOrderEmailCopies = { bcc: [], html: '', settle: async () => undefined }
  if (!providers.length || !EMAIL.test(String(request.recipient ?? '').trim())) return empty
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(0, options.timeoutMs))
  const late = new Promise<'late'>((resolve) => controller.signal.addEventListener('abort', () => resolve('late')))
  const recipient = String(request.recipient).trim().toLowerCase()
  try {
    const answers = await Promise.all(
      providers.map(async (entry) => {
        const pending = entry.impl({ ...request, signal: controller.signal }).catch((error: unknown): null => {
          console.error(`[order-email-copies] provider "${entry.pluginId}" failed for ${request.hostId}`, error)
          return null
        })
        const answer = await Promise.race([pending, late])
        if (answer === 'late') {
          // It may still claim something after the deadline: tell it the
          // message went without it once it does.
          void pending.then((copy): void => void copy?.settle?.(false).catch((): undefined => undefined))
          return null
        }
        return answer
      }),
    )
    const copies = answers.filter((copy): copy is PluginOrderEmailCopy => Boolean(copy))
    const bcc = [
      ...new Set(
        copies
          .flatMap((copy) => (Array.isArray(copy.bcc) ? copy.bcc : []))
          .map((address) => String(address ?? '').trim())
          .filter((address) => EMAIL.test(address) && address.toLowerCase() !== recipient),
      ),
    ]
    const html = copies
      .flatMap((copy) => (Array.isArray(copy.dataBlocks) ? copy.dataBlocks : []))
      .filter((block) => block && DATA_TYPE.test(String(block.type ?? '')))
      .map(orderEmailDataBlockHtml)
      .join('')
    return {
      bcc,
      html,
      settle: async (sent) => {
        await Promise.all(
          copies.map((copy) =>
            Promise.resolve()
              .then(() => copy.settle?.(sent))
              .catch((error: unknown) => console.error('[order-email-copies] settle failed', error)),
          ),
        )
      },
    }
  } finally {
    clearTimeout(timer)
  }
}
