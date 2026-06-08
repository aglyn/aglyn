/**
 * Rollup config plugin to suppress known non-fatal build log noise.
 *
 * Covers three categories of warnings that flood build logs and hide real errors:
 *
 * 1. MODULE_LEVEL_DIRECTIVE — emitted when bundling files with "use client" /
 *    "use server" directives (MUI, and library source files). Non-fatal but
 *    generates hundreds of events per build.
 *
 * 2. INVALID_ANNOTATION — emitted when a bundled dependency (e.g. react-virtuoso)
 *    has /* @__PURE__ *\/ comments in positions rollup cannot interpret. Non-fatal,
 *    but each warning spans multiple lines (~5 log events each).
 *
 * 3. UNRESOLVED_IMPORT for @aglyn/* packages — monorepo workspace packages are
 *    resolved via tsconfig paths at source level and cannot be found in node_modules
 *    by rollup's node-resolve plugin. Rollup correctly treats them as external and
 *    emits this warning, which is expected and harmless. Suppressing it keeps the
 *    log window clear for real errors.
 *
 * 4. CIRCULAR_DEPENDENCY from node_modules — packages like next.js have internal
 *    circular dependencies that rollup detects and warns about. Non-fatal and
 *    irrelevant to our build correctness.
 */
module.exports = function suppressRollupNoise(config) {
  const originalOnwarn = config.onwarn

  config.onwarn = function (warning, warn) {
    // Suppress "use client" and "use server" module directive warnings
    if (
      warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
      warning.message &&
      (warning.message.includes('"use client"') ||
        warning.message.includes('"use server"'))
    ) {
      return
    }

    // Suppress @__PURE__ annotation position warnings from node_modules.
    // These come from packages like react-virtuoso that use tree-shaking
    // annotations in positions rollup cannot process. Completely non-fatal —
    // rollup removes the comment and continues bundling.
    if (
      warning.code === 'INVALID_ANNOTATION' &&
      warning.message &&
      warning.message.includes('node_modules')
    ) {
      return
    }

    // Suppress UNRESOLVED_IMPORT for @aglyn/* monorepo workspace packages.
    // These packages resolve via tsconfig paths but not node_modules, so
    // rollup warns and treats them as external. This is correct and expected.
    if (
      warning.code === 'UNRESOLVED_IMPORT' &&
      warning.message &&
      warning.message.includes('@aglyn/')
    ) {
      return
    }

    // Suppress circular dependency warnings from node_modules.
    // Internal circular deps in packages like next.js are non-fatal and
    // irrelevant to library build correctness.
    if (
      warning.code === 'CIRCULAR_DEPENDENCY' &&
      warning.message &&
      warning.message.includes('node_modules')
    ) {
      return
    }

    if (originalOnwarn) {
      originalOnwarn(warning, warn)
    } else {
      warn(warning)
    }
  }

  return config
}
