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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')
const PLUGINS = [
  'ad-conversions',
  'couriers',
  'fulfillment-networks',
  'inventory-sync',
  'loyalty',
  'marketing-platforms',
  'marketplaces',
  'post-purchase',
  'print-on-demand',
  'review-platforms',
  'sales-channels',
  'shipping',
  'tax-engines',
]
/** A press that only reads or that another plugin's route answers. */
const UNGATED = new Set(['/api/commerce/returns'])

const screensOf = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return screensOf(path)
    return name.endsWith('.screens.json') ? [path] : []
  })

type Node = Record<string, unknown>
const SKIPPED = new Set(['load', 'then', 'else', 'otherwise', 'gate', 'body', 'initial', 'prompt'])

function presses(value: unknown, found: Node[] = []): Node[] {
  if (Array.isArray(value)) value.forEach((one) => presses(one, found))
  else if (value && typeof value === 'object') {
    const node = value as Node
    const url = node['url']
    if (typeof url === 'string' && url.startsWith('/api/') && node['method'] !== 'GET' && (node['id'] || node['label'])) {
      found.push(node)
    }
    for (const [key, child] of Object.entries(node)) if (!SKIPPED.has(key)) presses(child, found)
  }
  return found
}

const catalog = new Set(
  (
    JSON.parse(readFileSync(join(ROOT, 'libs/native/contracts/contracts.generated.json'), 'utf8')) as {
      ORG_ROLE_GRANTS: { permissions: Array<{ key: string }> }
    }
  ).ORG_ROLE_GRANTS.permissions.map((one) => one.key),
)

describe('native integration screens ask the key their route asks (AGL-4047)', () => {
  for (const plugin of PLUGINS) {
    it(`${plugin}: every press names a catalog key`, () => {
      const files = screensOf(join(ROOT, 'libs/plugins', plugin, 'src/ios/Sources'))
      const pressed = files.flatMap((file) => {
        const spec = JSON.parse(readFileSync(file, 'utf8')) as { screens: Array<Node> }
        return spec.screens.flatMap((screen) => presses([screen['blocks'], screen['actions']]))
      })
      expect(pressed.length).toBeGreaterThan(0)
      for (const press of pressed) {
        if (UNGATED.has(String(press['url']).split('?')[0])) continue
        const gate = `${String(press['when'] ?? '')} ${String(press['disabledWhen'] ?? '')}`
        const keys = [...gate.matchAll(/site\.can\[([^\]]+)\]/g)].map((match) => match[1])
        expect([press['url'], keys.length > 0]).toEqual([press['url'], true])
        for (const key of keys) expect([key, catalog.has(key)]).toEqual([key, true])
      }
    })
  }
})
