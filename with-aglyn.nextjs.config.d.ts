/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import type { NextConfig } from 'next'

export interface WithAglynOptions extends NextConfig {
  /** Stripped before Next reads the config (tools/build/next-workspace-config.js). */
  nx?: Record<string, unknown>
  aglyn?: {
    /**
     * The app directory: pass the next.config's `__dirname`. A production
     * build lands in `dist/<app dir>/.next`, as it did under `@nx/next:build`.
     */
    appDir?: string
    /**
     * Enable the Webpack Bundle Analyzer plugin for the webpack config. You may
     * also enable this by using an ENV variable NEXT_ANALYZE_BUNDLE="true"
     */
    analyzeBundle?: boolean
    /**
     * When {@link analyzeBundle} is equal to true, these options will be passed
     * to the constructor during `new BundleAnalyzerPlugin()`
     */
    analyzerOptions?: {
      analyzerMode?: 'json' | 'static' | 'server'
      serverFilename?: string
      clientFilename?: string
      reportTitle?: string
      defaultSizes?: 'parsed' | string
      generateStatsFile?: true
      statsFilename?: string
      statsOptions?: any
      excludeAssets?: any
      logLevel: 'info' | string
    }
  }
  publicRuntimeConfig?: Record<string, unknown> & {
    /**
     * The absolute path to the root directory of location where static files
     * within the runtime environment can be accessed
     * @example -
     * Source location (actual): `APP_ROOT_DIR/public/_static/`
     * Runtime location (value): `'/_static'`
     */
    staticFolder?: string
  }
}

export type WithAglyn = {
  (nextConfig?: WithAglynOptions): WithAglynOptions
}

export default WithAglyn
