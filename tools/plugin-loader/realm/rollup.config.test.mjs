#!/usr/bin/env node
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
/**
 * A realm bundle uses the SITE's MUI: it compiles none in, and its elements
 * follow the site's theme (AGL-3392).
 *
 * The realm Rollup config turns `@mui/material` imports into lookups on the
 * host, whose MUI is the site's own instance — its theme, its style cache,
 * code the page has already downloaded — and refuses to compile MUI in. What
 * only a real build and a real render can show is that nothing slipped
 * through: that the bundle carries no MUI code, and that an element built this
 * way renders with the site's theme on the SERVER, where the styles must be
 * written during the render itself.
 *
 *   node --test tools/plugin-loader/realm/rollup.config.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import { rollup } from 'rollup'
import { aglynHostExternals, productionEnv } from './rollup.config.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..')
// Inside the repository, so the fixture's imports resolve against its packages.
const FIXTURE = join(HERE, '__realm-theme-fixture__.js')

async function build(source) {
  const bundle = await rollup({
    input: FIXTURE,
    plugins: [
      {
        name: 'fixture',
        resolveId: (id) => (id === FIXTURE ? id : null),
        load: (id) => (id === FIXTURE ? source : null),
      },
      aglynHostExternals(),
      nodeResolve({ browser: true, extensions: ['.mjs', '.js', '.json'] }),
      commonjs(),
      productionEnv(),
    ],
    onwarn: () => undefined,
  })
  const { output } = await bundle.generate({ format: 'es' })
  await bundle.close()
  return output[0].code
}

const BUTTON = `
import { createElement } from 'react'
import Button from '@mui/material/Button'
import { alpha } from '@mui/material/styles'
export function register() {
  globalThis.__realmThemeFixture = () =>
    createElement(Button, { sx: { outlineColor: alpha('#000', 0.5) } }, 'Save')
}
`

/** The host as an app composes it: the site's own module instances. */
async function composeHost() {
  const styles = await import('@mui/material/styles')
  const Button = (await import('@mui/material/Button')).default
  globalThis.__AGLYN_PLUGIN_HOST__ = {
    version: 1,
    React: await import('react'),
    jsxRuntime: await import('react/jsx-runtime'),
    aglyn: {},
    mui: { Button },
    muiStyles: { alpha: styles.alpha, styled: styles.styled, useTheme: styles.useTheme },
  }
  return { host: globalThis.__AGLYN_PLUGIN_HOST__, styles }
}

test('compiles no MUI or emotion in and imports nothing', async () => {
  const code = await build(BUTTON)
  assert.doesNotMatch(code, /^\s*import\s/m)
  for (const key of ['React', 'mui', 'muiStyles']) {
    assert.match(code, new RegExp(`host(\\$\\d+)?\\["${key}"\\]`), `reads ${key} from the host`)
  }
  // Button's and the styling runtime's own code would name these.
  assert.doesNotMatch(code, /MuiButtonBase|createTheme|styleFunctionSx|@emotion/)
})

test("renders on the server with the site's theme and default props", async () => {
  const code = await build(BUTTON)
  const { host, styles: site } = await composeHost()
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  mod.register()
  const { renderToString } = await import('react-dom/server')
  const { default: createCache } = await import('@emotion/cache')
  const cache = createCache({ key: 'site' })
  // What `@emotion/server` sets to extract critical CSS: keep each rule's text.
  cache.compat = true
  // The site's side, which a bundle never touches: its theme and cache.
  const { CacheProvider } = await import('@emotion/react')
  const theme = site.createTheme({
    palette: { primary: { main: '#123456' } },
    components: { MuiButton: { defaultProps: { variant: 'contained' } } },
  })
  const { createElement } = host.React
  const html = renderToString(
    createElement(
      CacheProvider,
      { value: cache },
      createElement(
        site.ThemeProvider,
        { theme },
        createElement(globalThis.__realmThemeFixture),
      ),
    ),
  )
  const styles = Object.values(cache.inserted).join('\n')
  assert.match(styles, /#123456/, "the site's primary color styles the button")
  assert.match(html, /MuiButton-contained/, "the theme's default variant applies")
  assert.match(html, /\bsite-[a-z0-9]+\b/, "its class comes from the site's style cache")
})

test('refuses to compile in MUI, emotion or react-dom', async () => {
  for (const source of ['@mui/system', '@emotion/react', 'react-dom']) {
    await assert.rejects(
      build(`import * as x from '${source}'\nexport function register() { return x }\n`),
      /never compiles it in/,
      source,
    )
  }
})

/** The publish verifier, loaded from source the way the publish route runs it. */
async function loadVerifier() {
  const require = createRequire(join(ROOT, 'package.json'))
  const { createJiti } = require('jiti')
  // The workspace's path aliases, as `generate-plugin-manifests.mjs` builds them.
  const { paths } = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8')).compilerOptions
  const alias = {}
  for (const [key, [target]] of Object.entries(paths)) {
    const path = target.replace(/^\.\//, '')
    alias[key.endsWith('/*') ? key.slice(0, -1) : key] = key.endsWith('/*')
      ? join(ROOT, path.replace(/\/?\*$/, '')) + '/'
      : join(ROOT, path)
  }
  const jiti = createJiti(join(ROOT, 'package.json'), { alias })
  return jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/plugin-bundle-checks.ts'))
}

test('the verifier refuses a component off the MUI surface', async () => {
  const code = await build(
    "import Slider from '@mui/material/Slider'\nexport function register() { return Slider }\n",
  )
  const { checkPluginBundle } = await loadVerifier()
  const verdict = checkPluginBundle(code)
  assert.equal(verdict.ok, false)
  assert.match(
    verdict.problems.map((problem) => problem.message).join('\n'),
    /reads Slider from the host's mui/,
  )
})

// The Calculators marketplace plugin (AGL-3394), built with its own config:
// TypeScript and JSX, minified, reaching core and MUI only through the host.
test('the Calculators bundle builds, carries no host code, and verifies for publishing', async () => {
  const { default: config } = await import(
    join(ROOT, 'libs/plugins/calculator/rollup.config.mjs')
  )
  const bundle = await rollup({ ...config, onwarn: () => undefined })
  const { output } = await bundle.generate(config.output)
  await bundle.close()
  const code = output[0].code

  assert.doesNotMatch(code, /emotion|MuiButtonBase-root|createTheme/)
  for (const role of ['scope', 'input', 'result', 'showWhen', 'document', 'saveButton']) {
    assert.match(code, new RegExp(`aglyn\\.calculator\\.${role}|\\.${role}\``))
  }

  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'libs/plugins/calculator/manifest.json'), 'utf8'),
  )
  const { checkPluginBundle } = await loadVerifier()
  const verdict = checkPluginBundle(code, {
    declaredNetwork: [],
    declaredContributions: manifest.contributes,
    requireContributions: true,
  })
  assert.deepEqual(
    verdict.problems.filter((problem) => problem.level === 'error'),
    [],
  )
  assert.equal(verdict.ok, true)
})
