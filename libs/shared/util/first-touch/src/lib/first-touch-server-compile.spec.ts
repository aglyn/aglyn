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
 *
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.example.com/pricing?utm_source=newsletter", "referrer": "https://www.g2.com/products/aglyn"}
 */

/**
 * The served capture is the TEXT of `createFirstTouchKit`, taken from the
 * bundle that builds the route — in both apps, a Next.js SERVER bundle. A
 * server compile settles environment checks in advance: Next's replaces
 * `typeof window` with "undefined", and its minifier then drops every path
 * that needs a DOM. The kit still booted and still exposed a runtime; it
 * recorded nothing, on every surface.
 *
 * The other specs stringify the kit as the test compiler leaves it. This one
 * compiles the modules the way a Next server build does — the same optimizer
 * globals, then the minifier — and runs the script that comes out.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transformSync } from '@swc/core'
import type { FirstTouchConfig, FirstTouchRuntime } from './first-touch'
import { FIRST_TOUCH_PAGE_GLOBAL } from './first-touch-page'

/** Next's server-layer optimizer (`next/dist/build/swc/options.js`), then its minifier. */
function compileForTheServer(file: string): string {
  return transformSync(readFileSync(join(__dirname, file), 'utf8'), {
    filename: file,
    jsc: {
      parser: { syntax: 'typescript' },
      target: 'es2022',
      transform: {
        optimizer: {
          simplify: false,
          globals: {
            typeofs: { window: 'undefined' },
            envs: { NODE_ENV: '"production"' },
          },
        },
      },
      minify: { compress: true, mangle: true },
    },
    module: { type: 'commonjs' },
    minify: true,
  }).code
}

/** The lib's modules, compiled that way and wired only to one another. */
function compiledScriptBuilder(): (config: FirstTouchConfig) => string {
  const loaded: Record<string, Record<string, unknown>> = {}
  const load = (name: string): Record<string, unknown> => {
    if (loaded[name]) return loaded[name]
    const exports: Record<string, unknown> = {}
    loaded[name] = exports
    const requireSibling = (specifier: string): Record<string, unknown> => {
      if (!specifier.startsWith('./')) throw new Error(`unexpected import: ${specifier}`)
      return load(specifier.slice(2))
    }
    new Function('exports', 'require', compileForTheServer(`${name}.ts`))(exports, requireSibling)
    return exports
  }
  return load('first-touch-script')['firstTouchScript'] as (config: FirstTouchConfig) => string
}

const page = window as unknown as Record<string, unknown>

describe('the capture a server bundle serves', () => {
  it('still records the visit after a server build has compiled it', () => {
    const script = compiledScriptBuilder()({ hosts: ['example.com', '*.example.com'], storage: true })
    const element = document.createElement('script')
    element.textContent = script
    document.head.appendChild(element)
    const runtime = page[FIRST_TOUCH_PAGE_GLOBAL] as FirstTouchRuntime | undefined
    expect(runtime?.read()).toMatchObject({
      host: 'www.example.com',
      path: '/pricing',
      ref: 'www.g2.com',
      utm: { source: 'newsletter' },
    })
    expect(runtime?.tier()).toBe('cookie')
  })

  it('asks the host nothing a compiler could answer in advance', () => {
    const code = readFileSync(join(__dirname, 'first-touch.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(
      /typeof\s+(window|document|location|navigator|history|fetch|self|globalThis|sessionStorage|localStorage)\b/,
    )
  })
})
