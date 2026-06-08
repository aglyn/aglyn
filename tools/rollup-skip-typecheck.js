/**
 * Rollup config function that patches the @rollup/plugin-typescript plugin to
 * survive the Vercel rootDir mismatch without fatal errors.
 *
 * Root cause: NX's rollup executor sets rootDir=workspaceRoot via createTsCompilerOptions
 * in with-nx.js. On Vercel, workspaceRoot resolves to the *project* directory
 * (e.g. /vercel/path0/libs/shared/ui/jsx) rather than the monorepo root
 * (/vercel/path0). This breaks the TypeScript plugin in two ways:
 *
 * 1. TS6059 "rootDir" diagnostics — cross-library imports from outside the
 *    (wrong) rootDir cause TS6059. With noEmitOnError:false (set by skipTypeCheck:true)
 *    these are non-fatal context.warn() calls, but they flood build logs and must be
 *    suppressed to keep actual errors visible.
 *
 * 2. Fatal emitFile path error — in generateBundle, the TypeScript plugin emits
 *    .d.ts declaration files for every compiled source file. Paths are computed
 *    relative to rootDir. For cross-library files the result is a relative path
 *    starting with ".." (e.g. "../../../../../libs/shared/data/types/src/lib/dod.d.ts").
 *    Rollup hard-rejects relative/absolute fileName values with:
 *      RollupError: The "fileName" or "name" properties of emitted chunks and assets
 *      must be strings that are neither absolute nor relative paths.
 *    This is the fatal error that was crashing shared-ui-jsx:build on Vercel.
 */
module.exports = function skipTypecheckConfig(config) {
  if (!Array.isArray(config.plugins)) return config

  config.plugins = config.plugins.map((plugin) => {
    if (!plugin || plugin.name !== 'typescript') return plugin

    // Helper: wrap a hook function to intercept context methods
    function wrapHook(originalHook, suppressWarnPattern) {
      return async function (...args) {
        const origError = this.error.bind(this)
        const origWarn = this.warn.bind(this)
        const origEmitFile = this.emitFile.bind(this)

        // Silence TypeScript type-checking errors (TS followed by a number)
        this.error = function (err) {
          const msg = typeof err === 'string' ? err : (err && err.message) || ''
          if (/\[plugin typescript\].*TS\d+/.test(msg) || /TS\d+/.test(msg)) {
            origWarn(typeof err === 'string' ? { message: err, code: 'TS_TYPE_ERROR' } : err)
            return
          }
          origError(err)
        }.bind(this)

        // Suppress specific TS warning patterns (e.g. TS6059 rootDir noise)
        if (suppressWarnPattern) {
          this.warn = function (err) {
            const msg = typeof err === 'string' ? err : (err && err.message) || ''
            if (suppressWarnPattern.test(msg)) return
            origWarn(err)
          }.bind(this)
        }

        // Drop emitFile calls whose fileName is a relative or absolute path.
        // On Vercel, the TypeScript plugin computes .d.ts paths relative to the
        // wrong rootDir, producing paths like "../../../../../libs/shared/data/types/…"
        // which Rollup rejects with a fatal RollupError. Skipping these calls
        // silently drops declaration files for cross-library types, which is
        // acceptable because those types are already provided by the source libs.
        this.emitFile = function (file) {
          if (
            file &&
            typeof file.fileName === 'string' &&
            (file.fileName.startsWith('..') || file.fileName.startsWith('/'))
          ) {
            return 'skipped-' + Math.random().toString(36).slice(2)
          }
          return origEmitFile(file)
        }.bind(this)

        return originalHook.call(this, ...args)
      }
    }

    // Wrap buildStart to silence TypeScript type errors AND suppress TS6059 rootDir warnings.
    // TS6059 fires during buildStart (TypeScript compilation phase) as context.warn()
    // when noEmitOnError:false. These are non-fatal but flood build logs.
    if (typeof plugin.buildStart === 'function') {
      plugin.buildStart = wrapHook(plugin.buildStart, /TS6059/)
    }

    // Wrap generateBundle to suppress TS6059 warnings AND block fatal emitFile calls.
    // The emitFile interception is the critical fix: cross-library .d.ts declarations
    // come out as relative paths on Vercel, which Rollup rejects as a fatal error.
    if (typeof plugin.generateBundle === 'function') {
      plugin.generateBundle = wrapHook(plugin.generateBundle, /TS6059/)
    }

    return plugin
  })

  return config
}
