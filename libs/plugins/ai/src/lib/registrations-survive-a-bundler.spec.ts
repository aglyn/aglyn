/**
 * @jest-environment node
 */
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
 * What an app registers when it loads this plugin through a bundler
 * (AGL-3025).
 *
 * Every other spec imports the plugin straight into jest, where an import
 * always runs the module it names. A bundler need not. One that honors
 * `sideEffects` in `package.json` — Turbopack and webpack both do — deletes
 * an import of a module the package declares effect-free when the importer
 * uses nothing it exports. A registration made by being imported therefore
 * ran in every spec and in neither app: every generative job failed "not
 * available yet" while every project was green.
 *
 * So this spec puts a real bundler between the plugin and the assertion.
 * webpack bundles the entries the apps load, in production mode and reading
 * the plugin's own `package.json`. Everything outside the plugin stays
 * external and is loaded by jest, so the registries a bundle writes are the
 * ones read here. A bundle must register exactly what the unbundled plugin
 * registers, and every planned kind must be able to plan and then generate.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import webpack, { type Configuration } from 'webpack'

const LIB = __dirname
const PLUGIN_ROOT = resolve(LIB, '..', '..')

type Loaded = Record<string, any>

/**
 * `require` behind a non-literal specifier. A literal first-party specifier
 * inside a callback reads to nx as a DYNAMIC graph edge, which forbids every
 * static import of that library elsewhere (AGL-949); the registries are
 * re-read inside `jest.isolateModules`, so they are required, not imported.
 */
const reRequire = (id: string): Loaded => (require as unknown as (spec: string) => Loaded)(id)

const SERVER_ENTRY = `
export { registerAiConsoleApi } from ${JSON.stringify(join(LIB, 'server'))}
export {
  AI_PLANNED_JOB_KINDS,
  aiJobRunnerForStep,
  aiJobStepMaxPasses,
  aiJobStepNames,
} from ${JSON.stringify(join(LIB, 'jobs', 'ai-jobs'))}
export { aiJobAdmissionFor } from ${JSON.stringify(join(LIB, 'jobs', 'ai-job-admission'))}
export { AI_JOB_KINDS } from ${JSON.stringify(join(LIB, 'model', 'ai-jobs.types'))}
`

/** The declarations entry alone, as the apps' declarations manifests load it. */
const DECLARATIONS_ENTRY = `
export { registerAiDeclarations } from ${JSON.stringify(join(LIB, 'declarations'))}
`

const scratch: string[] = []

/** One production bundle of `source`, which imports the plugin by absolute path. */
async function bundle(name: string, source: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), `aglyn-ai-${name}-`))
  scratch.push(dir)
  const entry = join(dir, 'entry.ts')
  writeFileSync(entry, source)
  const inPlugin = (path: string) =>
    path.startsWith(PLUGIN_ROOT + sep) && !path.includes(`${sep}node_modules${sep}`)
  const config: Configuration = {
    mode: 'production',
    target: 'node',
    context: dir,
    entry,
    output: { path: dir, filename: 'bundle.js', library: { type: 'commonjs2' } },
    devtool: false,
    cache: false,
    resolve: { extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'] },
    externals: [
      ({ context, request }, callback) => {
        if (!request || !context) return callback()
        if (request === entry) return callback()
        const target = request.startsWith('.') ? resolve(context, request) : request
        if (target.startsWith(sep)) {
          return inPlugin(target) ? callback() : callback(undefined, `commonjs ${target}`)
        }
        return callback(undefined, `commonjs ${request}`)
      },
    ],
    module: {
      rules: [
        {
          test: /\.[jt]sx?$/,
          exclude: /node_modules/,
          use: {
            loader: require.resolve('babel-loader'),
            options: {
              babelrc: false,
              configFile: false,
              presets: [
                [require.resolve('@babel/preset-typescript'), { allowDeclareFields: true }],
                [require.resolve('@babel/preset-react'), { runtime: 'automatic' }],
              ],
            },
          },
        },
      ],
    },
    optimization: {
      // The one production behavior this spec is about: an import of a
      // module the package declares effect-free, whose exports go unused,
      // is dropped. Minifying and the NODE_ENV substitution change nothing
      // it asks, so both stay off.
      sideEffects: true,
      usedExports: true,
      minimize: false,
      nodeEnv: false,
      splitChunks: false,
    },
    plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })],
  }
  await new Promise<void>((done, fail) => {
    webpack(config, (error, stats) => {
      if (error) return fail(error)
      if (stats?.hasErrors()) {
        return fail(new Error(stats.toString({ all: false, errors: true })))
      }
      done()
    })
  })
  return join(dir, 'bundle.js')
}

/** Runs a bundle with jest's `require`, so its externals are jest's modules. */
function load(file: string): Loaded {
  const bundled = { exports: {} as Loaded }
  const run = new Function(
    'module',
    'exports',
    'require',
    '__filename',
    '__dirname',
    readFileSync(file, 'utf8'),
  )
  run(bundled, bundled.exports, require, file, dirname(file))
  return bundled.exports
}

interface Registered {
  steps: Record<string, Array<{ step: string; runner: boolean }>>
  admissions: string[]
  passes: Record<string, number>
  /** Every platform job the plugin put on a job runner: none since AGL-3026. */
  jobs: string[]
  /** The console API paths the plugin registered. */
  routes: string[]
}

/**
 * Registers the plugin as the console does — the one app that loads its
 * server surface (AGL-3026) — and reads back what that registered.
 */
function registered(plugin: Loaded): Registered {
  plugin.registerAiConsoleApi()
  const { listPluginApiRoutes, listPluginJobs } = reRequire('@aglyn/aglyn/server')
  const steps: Registered['steps'] = {}
  const passes: Registered['passes'] = {}
  const admissions: string[] = []
  for (const kind of plugin.AI_JOB_KINDS as string[]) {
    steps[kind] = (plugin.aiJobStepNames(kind) as string[]).map((step) => ({
      step,
      runner: plugin.aiJobRunnerForStep(kind, step) !== null,
    }))
    passes[kind] = plugin.aiJobStepMaxPasses(kind)
    if (plugin.aiJobAdmissionFor(kind)) admissions.push(kind)
  }
  const jobs = (listPluginJobs() as Array<{ pluginId: string; name: string }>)
    .filter((job) => job.pluginId === 'ai')
    .map((job) => job.name)
    .sort()
  const routes = (listPluginApiRoutes() as string[]).slice().sort()
  return { steps, admissions, passes, jobs, routes }
}

/** The AI activity codes the activity registry holds, with their labels. */
function declaredActivity(): Array<{ key: string; label: string }> {
  const { listPluginActivityActions } = reRequire('@aglyn/aglyn/plugin-manager/plugin-activity-actions')
  return (listPluginActivityActions() as Array<{ key: string; label: string }>)
    .filter((action) => action.key.startsWith('ai.'))
    .map(({ key, label }) => ({ key, label }))
}

function isolated<T>(read: () => T): T {
  let value: T | undefined
  jest.isolateModules(() => {
    value = read()
  })
  return value as T
}

describe('the AI plugin, loaded through a bundler that honors sideEffects', () => {
  let serverBundle = ''
  let declarationsBundle = ''

  beforeAll(async () => {
    ;[serverBundle, declarationsBundle] = await Promise.all([
      bundle('server', SERVER_ENTRY),
      bundle('declarations', DECLARATIONS_ENTRY),
    ])
  }, 300_000)

  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
  })

  it('registers from a bundle exactly what it registers unbundled', () => {
    const unbundled = isolated(() =>
      registered({
        ...require('./server'),
        ...require('./jobs/ai-jobs'),
        ...require('./jobs/ai-job-admission'),
        ...require('./model/ai-jobs.types'),
      }),
    )
    const bundled = isolated(() => registered(load(serverBundle)))
    expect(bundled).toEqual(unbundled)
  })

  it('lets every planned kind plan and then generate', () => {
    const bundled = isolated(() => {
      const plugin = load(serverBundle)
      return { kinds: plugin.AI_PLANNED_JOB_KINDS as string[], registered: registered(plugin) }
    })
    const both = [
      { step: 'plan', runner: true },
      { step: 'generate', runner: true },
    ]
    expect(Object.fromEntries(bundled.kinds.map((kind) => [kind, bundled.registered.steps[kind]])))
      .toEqual(Object.fromEntries(bundled.kinds.map((kind) => [kind, both])))
    expect(bundled.registered.admissions).toEqual(expect.arrayContaining(bundled.kinds))
  })

  it('registers a runner for the kind of every step module beside the machine', () => {
    // A new step module that nothing calls registers nowhere, bundled or
    // not, so comparing the two cannot see it; its file can.
    const kinds = readdirSync(join(LIB, 'jobs'))
      .map((file) => /^ai-job-([a-z-]+)-step\.ts$/.exec(file)?.[1])
      .filter((kind): kind is string => kind !== undefined && kind !== 'plan')
    const bundled = isolated(() => registered(load(serverBundle)))
    expect(kinds.length).toBeGreaterThan(0)
    expect(kinds.filter((kind) => !bundled.steps[kind]?.every(({ runner }) => runner))).toEqual([])
  })

  it('serves the jobs beat from the console surface, and puts nothing on the tenant’s job runner', () => {
    // AGL-3026: every step calls the provider, whose key only the console
    // holds, so the beat is a console route and the tenant loads no server
    // surface of this plugin at all.
    const bundled = isolated(() => registered(load(serverBundle)))
    const { AI_JOBS_BEAT_PATH } = require('./jobs/ai-jobs-beat')
    expect(bundled.routes).toContain(AI_JOBS_BEAT_PATH)
    expect(bundled.jobs).toEqual([])
    expect(isolated(() => require('./server').registerAiApi)).toBeUndefined()
    const config = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, '..', '..', '..', 'plugins.config.json'), 'utf8')) as {
      plugins: Array<{ id: string; register: Record<string, string> }>
    }
    expect(Object.keys(config.plugins.find((plugin) => plugin.id === 'ai')?.register ?? {})).not.toContain('tenantApi')
  })

  it('declares the activity catalog from the declarations entry alone', () => {
    const unbundled = isolated(() => {
      require('./declarations').registerAiDeclarations()
      return declaredActivity()
    })
    const bundled = isolated(() => {
      load(declarationsBundle).registerAiDeclarations()
      return declaredActivity()
    })
    expect(unbundled.length).toBeGreaterThan(0)
    expect(bundled).toEqual(unbundled)
  })
})
