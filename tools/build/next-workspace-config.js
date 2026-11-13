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

'use strict'

/**
 * What `withNx()` from `@nx/next` did for the Next apps, kept here because
 * Nx 24 turned `withNx()` into an inert stub and removed the `@nx/next:build`
 * and `@nx/next:server` executors (AGL-4218).
 *
 * Three behaviours are carried over, each exactly as Nx 23 applied it:
 *
 * 1. WHERE A PRODUCTION BUILD LANDS. `nx build <app>` wrote the app's `.next`
 *    to `dist/apps/<app>/.next`, and everything downstream reads it there:
 *    Vercel's Output Directory for aglyn-console and aglyn-tenant is
 *    `dist/apps/<app>/.next`, the Dockerfiles copy its `standalone/` and
 *    `static/`, the app tsconfigs include its `types/`, and the wire-weight
 *    and chunk gates read its manifests. So a production build, and the
 *    `next start` that serves it, use that `distDir`, as the same relative
 *    path Nx 23 wrote (`../../dist/apps/<app>/.next`). The dev server and a
 *    `development` build keep `.next` inside the app, which Turbopack expects.
 *    A bare `next build` outside Nx also keeps `.next`, as it did before.
 *
 * 2. WORKSPACE LIBRARIES ARE TRANSPILED. Under an Nx task, every library the
 *    app depends on (transitively, from the project graph) is added to
 *    `transpilePackages` under its tsconfig path alias.
 *
 * 3. THE `nx` KEY IS STRIPPED, so Next does not report it as an unknown
 *    option. SVGR is configured explicitly in with-aglyn.nextjs.config.js.
 *
 * Under webpack (never the default here: Next 16 builds and serves with
 * Turbopack) the `.js` -> `.ts` extension aliases withNx added are kept too.
 * withNx's CSS-module loader patches are not: no workspace library ships a
 * `.module.css`/`.module.scss`, and they only ever touched webpack.
 */

const path = require('path')

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..')

/** `dist/<appRoot>/.next`, relative to the app directory. */
function productionDistDir(appDir) {
  const appRoot = path.relative(WORKSPACE_ROOT, appDir)
  return path
    .relative(appDir, path.join(WORKSPACE_ROOT, 'dist', appRoot, '.next'))
    .split(path.sep)
    .join('/')
}

function distDirFor(phase, appDir) {
  const {
    PHASE_PRODUCTION_BUILD,
    PHASE_PRODUCTION_SERVER,
  } = require('next/constants')
  // `nx build <app> --configuration=development` built in place in Nx 23.
  if (process.env.NX_TASK_TARGET_CONFIGURATION === 'development') return null
  if (phase === PHASE_PRODUCTION_SERVER) return productionDistDir(appDir)
  if (phase === PHASE_PRODUCTION_BUILD && process.env.NX_TASK_TARGET_TARGET) {
    return productionDistDir(appDir)
  }
  return null
}

/** Every workspace library the Nx task's project depends on, by path alias. */
function workspaceLibraryAliases() {
  const project = process.env.NX_TASK_TARGET_PROJECT
  if (!project || global.NX_GRAPH_CREATION) return []
  const { readCachedProjectGraph } = require('@nx/devkit')
  const graph = readCachedProjectGraph()
  if (!graph.dependencies[project]) return []

  const seen = new Set()
  const queue = [project]
  while (queue.length) {
    const name = queue.shift()
    for (const dep of graph.dependencies[name] ?? []) {
      if (!graph.nodes[dep.target] || seen.has(dep.target)) continue
      seen.add(dep.target)
      queue.push(dep.target)
    }
  }

  const tsconfig = require(path.join(WORKSPACE_ROOT, 'tsconfig.base.json'))
  const paths = Object.entries(tsconfig.compilerOptions?.paths ?? {})
  const aliases = []
  for (const dep of seen) {
    const root = graph.nodes[dep].data.root
    const match = paths.find(([, lookups]) =>
      lookups.some(
        (lookup) => lookup.startsWith(root) || lookup.startsWith(`./${root}`),
      ),
    )
    if (match) aliases.push(match[0])
  }
  return aliases
}

/**
 * Wrap a Next config (an object) for an app in this workspace.
 *
 * @param {object} nextConfig the composed config
 * @param {string} appDir the app directory (`__dirname` of its next.config)
 */
function withWorkspace(nextConfig, appDir) {
  return async (phase) => {
    const config = { ...nextConfig }
    delete config.nx

    const distDir = distDirFor(phase, appDir)
    if (distDir && (!config.distDir || config.distDir === '.next')) {
      config.distDir = distDir
    }

    const aliases = workspaceLibraryAliases()
    if (aliases.length) {
      config.transpilePackages = [
        ...new Set([...(config.transpilePackages ?? []), ...aliases]),
      ]
    }

    const userWebpack = config.webpack
    config.webpack = (webpackConfig, options) => {
      webpackConfig.resolve.extensionAlias = {
        ...(webpackConfig.resolve.extensionAlias || {}),
        '.js': ['.ts', '.tsx', '.js', '.jsx'],
        '.mjs': ['.mts', '.mjs'],
        '.cjs': ['.cts', '.cjs'],
        '.jsx': ['.tsx', '.jsx'],
      }
      return userWebpack ? userWebpack(webpackConfig, options) : webpackConfig
    }

    return config
  }
}

module.exports = { withWorkspace, productionDistDir }
