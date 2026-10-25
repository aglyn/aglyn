import baseConfig, { boundaryOverridesFor } from '../../../eslint.config.mjs'

export default [
  ...baseConfig,
  // The contracts of the plugins named in its "uses" in plugins.config.json
  // (AGL-3980): `@aglyn/plugins-<id>/contracts`, and nothing else of them.
  ...boundaryOverridesFor(import.meta.url),
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    // Override or add rules here
    rules: {},
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
]
