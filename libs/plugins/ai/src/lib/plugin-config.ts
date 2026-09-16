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

import type { PluginConfigSchema } from '@aglyn/aglyn'
import { AI_PLUGIN_SETTINGS_ID } from './constants'
import { AI_CATALOG_PROVIDERS, AI_MODEL_CATALOG, type AiStepKind } from './providers/catalog'

/**
 * The org's AI settings (AGL-2939), stored in `pluginSettings/ai` and
 * inherited per site the way every plugin setting is (AGL-428): which
 * provider serves the workspace, and which catalog model each kind of step
 * runs on. `platform` means "whatever the deployment's environment says",
 * which is what every workspace runs with until it chooses.
 *
 * PURE DATA (type-only aglyn import): the client barrel registers it via
 * '@aglyn/aglyn' and the /server entry via '@aglyn/aglyn/server'.
 */

/** The value that defers to the deployment's environment. */
export const AI_SETTING_PLATFORM = 'platform'

/** The setting key each step kind's model override is stored under. */
export const AI_STEP_MODEL_SETTING: Record<AiStepKind, string> = {
  'assist.chat': 'chatModel',
  'copy.element': 'copyElementModel',
  'copy.section': 'copySectionModel',
  'copy.blog': 'copyBlogModel',
  'generate.section': 'generateModel',
  'job.layout': 'jobLayoutModel',
  'job.template': 'jobTemplateModel',
  'job.seo': 'jobSeoModel',
  'job.text': 'jobTextModel',
  'job.theme': 'jobThemeModel',
  'job.plan': 'jobPlanModel',
}

const MODEL_OPTIONS = [
  { value: AI_SETTING_PLATFORM, label: 'Platform default' },
  ...AI_MODEL_CATALOG.map((entry) => ({
    value: entry.id,
    label: `${entry.label} (${entry.provider})`,
  })),
]

const modelField = (kind: AiStepKind, label: string, description: string) => ({
  key: AI_STEP_MODEL_SETTING[kind],
  label,
  type: 'select' as const,
  options: MODEL_OPTIONS,
  description,
})

export const AI_CONFIG_SCHEMA: PluginConfigSchema = {
  pluginId: AI_PLUGIN_SETTINGS_ID,
  fields: [
    {
      key: 'provider',
      label: 'AI provider',
      type: 'select',
      options: [
        { value: AI_SETTING_PLATFORM, label: 'Platform default' },
        ...AI_CATALOG_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.label })),
      ],
      description:
        'Which provider answers this workspace. A model chosen below must ' +
        'be one the provider serves; otherwise the provider’s default for ' +
        'that kind of step is used.',
    },
    modelField('assist.chat', 'Assistant model', 'The in-console assistant’s answers.'),
    modelField('copy.element', 'Copy assistant (element) model', 'Rewriting one element’s text.'),
    modelField('copy.section', 'Copy assistant (section) model', 'Writing a section’s copy.'),
    modelField('copy.blog', 'Copy assistant (blog) model', 'Drafting a blog post.'),
    modelField('generate.section', 'Section generation model', 'Generating a section’s structure.'),
    modelField('job.layout', 'Generation job (layout) model', 'Generating a shared layout from a confirmed plan.'),
    modelField('job.template', 'Generation job (template) model', 'Generating a page template from a confirmed plan.'),
    modelField('job.seo', 'Generation job (SEO) model', 'Search listings, image descriptions and a site audit’s fixes.'),
    modelField('job.text', 'Generation job (text) model', 'The text step of a generation job.'),
    modelField('job.theme', 'Generation job (theme) model', 'Proposing a change to a site’s theme.'),
    modelField('job.plan', 'Generation job (plan) model', 'The plan step of a generation job.'),
  ],
  defaults: {
    provider: AI_SETTING_PLATFORM,
    ...Object.fromEntries(
      Object.values(AI_STEP_MODEL_SETTING).map((key) => [key, AI_SETTING_PLATFORM]),
    ),
  },
}
