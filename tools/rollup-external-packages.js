/**
 * Rollup config function that marks next/* and @aglyn/* imports as external.
 *
 * Without this, rollup bundles the entire Next.js package tree into every
 * library that uses next/link, next/router, next/navigation, etc. That
 * inflates bundle sizes to 5+ MB and can cause OOM kills on Vercel's 8 GB
 * build machines when multiple such bundles are produced sequentially.
 *
 * @aglyn/* packages are monorepo workspace packages. They are resolved via
 * tsconfig paths at source level but cannot be found in node_modules by
 * rollup's node-resolve plugin. This function marks them external so rollup
 * leaves those import statements as-is rather than attempting (and failing)
 * to bundle them.
 *
 * Preserves any existing external array/function already on the config.
 */
module.exports = function externalPackages(config) {
  const prev = config.external

  config.external = function (id) {
    // Preserve prior external entries
    if (typeof prev === 'function' && prev(id)) return true
    if (Array.isArray(prev) && prev.includes(id)) return true

    // Never bundle Next.js — it is always provided by the consuming app
    if (id === 'next' || id.startsWith('next/')) return true

    // Never bundle @aglyn/* monorepo workspace packages
    if (id.startsWith('@aglyn/')) return true

    return false
  }

  return config
}
