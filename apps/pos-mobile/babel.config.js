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
 * Babel for Aglyn POS (AGL-3618), as for the Aglyn app (AGL-3620). Present
 * so Babel's project-wide config is this app's `babel-preset-expo`, never
 * the repository root's `babel.config.json`, which is the web apps' and
 * knows nothing of Metro.
 */
module.exports = function babelConfig(api) {
  const test = api.cache.using(() => process.env.NODE_ENV) === 'test'
  return {
    presets: ['babel-preset-expo'],
    // Under jest a lazy `import()` (a plugin's screens, the mobile manifest's
    // entries) becomes a `require`: jest runs CommonJS, and Metro, which
    // splits on `import()`, never reads this branch.
    plugins: test ? ['@babel/plugin-transform-dynamic-import'] : [],
    // Under jest an ES module shipped as `.mjs` (Firebase's) becomes
    // CommonJS too. Only those: applied to everything, the CommonJS pass runs
    // before React Native's codegen and leaves its generated `export` behind,
    // so no screen with a ScrollView could render in a spec.
    overrides: test ? [{ test: /\.mjs$/, plugins: ['@babel/plugin-transform-modules-commonjs'] }] : [],
  }
}
