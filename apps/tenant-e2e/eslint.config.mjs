import baseConfig from '../../eslint.config.mjs'
import cypress from 'eslint-plugin-cypress'

export default [
  ...baseConfig,
  cypress.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
]
