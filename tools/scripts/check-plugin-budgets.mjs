/**
 * Per-plugin EAGER bundle budgets (AGL-436, AGL-3649).
 *
 *   node tools/scripts/check-plugin-budgets.mjs                 # check
 *   node tools/scripts/check-plugin-budgets.mjs --why ai        # what is eager, largest first
 *   node tools/scripts/check-plugin-budgets.mjs --update ai mui # re-baseline the named plugins
 *   node tools/scripts/check-plugin-budgets.mjs --update        # re-baseline every plugin
 *
 * ## What is measured
 *
 * The bytes a plugin costs the moment it is loaded: the STATIC import closure
 * of its client barrel, `src/index.ts`. Each plugin is bundled by esbuild with
 * code splitting on (`--splitting --format=esm --metafile`), everything
 * outside the plugin's own directory left external, so the number is the
 * plugin's own minified source — the thing a PR can regress — and not the
 * shared vendor chunks. From the metafile the entry chunk is walked along its
 * `import-statement` edges only: a chunk reached solely through `import()`
 * (a `React.lazy` page or card) loads when it is drawn, not when the plugin
 * is, so it is reported as lazy and never counted against the budget.
 *
 * That distinction is the point. The console loads a plugin on every screen
 * whose zones it fills (`console-plugin-load-points.ts`); AI fills the dock
 * and the top bar, so it loads everywhere. Before AGL-3649 this script built
 * one file with no splitting, so a lazy chunk counted as eager, a plugin that
 * made its cards lazy saw no change, and the check ran nowhere: no npm script
 * named it and no workflow called it. It is now `check:plugin-budgets`, run
 * by NX CI and so by `run-guards.mjs`.
 *
 * ## The budgets
 *
 * tools/plugin-budgets.json holds each plugin's measured `baseline` and its
 * `budget`: the baseline times the entry's `headroom` (1.25 when it names
 * none), rounded up to a KB. An entry's `note` says why its numbers are what
 * they are; a key starting `_` is a note on the file and names no plugin. The check fails when a plugin's eager bytes outgrow its
 * budget, and when a plugin has no entry. `--update` re-baselines after a
 * deliberate change; given plugin ids it touches only those, keeping every
 * other entry and every `note` as it is.
 *
 * esbuild is not a workspace dependency, so `npx` fetches it at a pinned
 * version: a different esbuild minifies differently, and the baselines are
 * only comparable against the version that measured them. `npx` is asked once
 * for the binary's path and the binary is run directly, because each `npx`
 * start costs seconds and the builds themselves cost a fraction of one.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ESBUILD = 'esbuild@0.28.1'
const HEADROOM = 1.25

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const budgetsPath = join(repoRoot, 'tools', 'plugin-budgets.json')

const argv = process.argv.slice(2)
const flagArgs = (name) => {
  const i = argv.indexOf(name)
  if (i < 0) return null
  const ids = []
  for (const arg of argv.slice(i + 1)) {
    if (arg.startsWith('--')) break
    ids.push(arg)
  }
  return ids
}
const update = flagArgs('--update')
const why = flagArgs('--why')

const { plugins } = JSON.parse(readFileSync(join(repoRoot, 'plugins.config.json'), 'utf8'))

/**
 * Splits a metafile's outputs into the entry's static closure and the rest.
 * Exported in spirit for `--why`: returns per-input byte attribution too.
 */
function closure(meta) {
  const outputs = meta.outputs
  const entry = Object.keys(outputs).find((key) =>
    outputs[key].entryPoint?.endsWith('src/index.ts'),
  )
  const eagerChunks = new Set()
  const stack = [entry]
  while (stack.length > 0) {
    const chunk = stack.pop()
    if (eagerChunks.has(chunk)) continue
    eagerChunks.add(chunk)
    for (const edge of outputs[chunk].imports) {
      if (edge.kind === 'import-statement' && outputs[edge.path]) stack.push(edge.path)
    }
  }
  let eager = 0
  let lazy = 0
  const eagerInputs = {}
  for (const [key, output] of Object.entries(outputs)) {
    if (key.endsWith('.map')) continue
    if (eagerChunks.has(key)) {
      eager += output.bytes
      for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
        eagerInputs[input] = (eagerInputs[input] ?? 0) + bytesInOutput
      }
    } else {
      lazy += output.bytes
    }
  }
  return { eager, lazy, eagerInputs }
}

/** The pinned esbuild's binary, resolved (and if need be fetched) once. */
function resolveEsbuild() {
  const out = execFileSync('npx', ['--yes', '-p', ESBUILD, '-c', 'command -v esbuild'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const bin = out.trim().split('\n').pop()
  if (!bin) throw new Error(`npx could not resolve ${ESBUILD}`)
  return bin
}

const esbuild = resolveEsbuild()
const workDir = mkdtempSync(join(tmpdir(), 'aglyn-budget-'))
const sizes = {}
try {
  for (const plugin of plugins) {
    const libDir = plugin.package.replace('@aglyn/plugins-', 'libs/plugins/')
    const entry = join(repoRoot, libDir, 'src', 'index.ts')
    const outDir = join(workDir, plugin.id)
    const metaFile = join(workDir, `${plugin.id}.meta.json`)
    execFileSync(
      esbuild,
      [
        entry,
        '--bundle',
        '--splitting',
        '--minify',
        '--format=esm',
        '--platform=browser',
        `--outdir=${outDir}`,
        `--metafile=${metaFile}`,
        '--packages=external',
        '--log-level=error',
        '--external:@aglyn/*',
        '--external:react',
        '--external:react/jsx-runtime',
        '--external:react-dom',
        '--loader:.svg=text',
      ],
      { cwd: repoRoot, stdio: 'pipe' },
    )
    sizes[plugin.id] = closure(JSON.parse(readFileSync(metaFile, 'utf8')))
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1).padStart(7)} KB`

if (why) {
  for (const id of why.length > 0 ? why : Object.keys(sizes)) {
    const size = sizes[id]
    if (!size) continue
    console.log(`${id}: eager ${kb(size.eager)}, lazy ${kb(size.lazy)}`)
    const ranked = Object.entries(size.eagerInputs).sort((a, b) => b[1] - a[1])
    for (const [input, bytes] of ranked.slice(0, 25)) console.log(`  ${kb(bytes)}  ${input}`)
  }
  process.exit(0)
}

const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'))

if (update) {
  const ids = update.length > 0 ? update : Object.keys(sizes)
  for (const id of ids) {
    if (!sizes[id]) throw new Error(`No plugin "${id}" in plugins.config.json`)
    const baseline = sizes[id].eager
    const headroom = budgets[id]?.headroom ?? HEADROOM
    budgets[id] = {
      ...budgets[id],
      baseline,
      budget: Math.ceil((baseline * headroom) / 1024) * 1024,
    }
    console.log(`  ${id.padEnd(16)} ${kb(baseline)}  (budget ${kb(budgets[id].budget)})`)
  }
  writeFileSync(budgetsPath, JSON.stringify(budgets, null, 2) + '\n')
  console.log(`Wrote ${budgetsPath}`)
  process.exit(0)
}

let failed = false
for (const [id, { eager, lazy }] of Object.entries(sizes)) {
  const budget = budgets[id]?.budget
  const label = `${id.padEnd(16)} eager ${kb(eager)} (lazy ${kb(lazy)})`
  if (!budget) {
    console.log(`NEW:  ${label} — no budget yet (run with --update ${id})`)
    failed = true
  } else if (eager > budget) {
    console.log(
      `FAIL: ${label} > budget ${kb(budget)} — make what is not needed at load ` +
        `lazy (\`--why ${id}\` lists it), or deliberately re-baseline with --update ${id}`,
    )
    failed = true
  } else {
    console.log(`OK:   ${label}, budget ${kb(budget)}`)
  }
}
process.exit(failed ? 1 : 0)
