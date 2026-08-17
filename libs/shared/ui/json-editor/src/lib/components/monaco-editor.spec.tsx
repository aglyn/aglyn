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
 * AGL-1779 — Monaco must load from our origin, never from a CDN.
 *
 * This drives the REAL `@monaco-editor/loader`, not a spy on it. Asserting
 * that `loader.config` was called would prove the call and nothing else; what
 * actually matters is the `src` of the `<script>` the loader appends to
 * `document.body`, because that is the thing that executes in the
 * `app.aglyn.com` origin. So the test imports the component module for its
 * side effect, runs `loader.init()`, and reads the injected element.
 *
 * Untouched, `@monaco-editor/loader` injects
 * `https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs/loader.js`.
 */
describe('MonacoEditor loader configuration', () => {
  it('injects the loader script from our own origin, not a CDN', async () => {
    // Imported for the module-scope `loader.config` call in the component.
    await import('./monaco-editor')
    const { loader } = await import('@monaco-editor/react')

    const injected: HTMLScriptElement[] = []
    const appendChild = jest
      .spyOn(document.body, 'appendChild')
      .mockImplementation(((node: HTMLScriptElement) => {
        injected.push(node)
        return node
      }) as typeof document.body.appendChild)

    // `init()` never resolves here — nothing loads the script it injects — so
    // the promise is cancelled rather than awaited.
    const pending = loader.init() as ReturnType<typeof loader.init> & {
      cancel: () => void
    }
    pending.cancel()
    appendChild.mockRestore()

    expect(injected).toHaveLength(1)
    const src = injected[0].getAttribute('src')
    expect(src).toBe('/monaco/vs/loader.js')
    expect(src).not.toMatch(/^https?:|\/\//)
    expect(src).not.toContain('jsdelivr')
  })
})
