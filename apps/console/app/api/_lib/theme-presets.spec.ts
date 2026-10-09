import type { ConsoleThemePreset } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { presetTargetFromRegistry, summarizeThemePresets } from './theme-presets'

const PRESETS: ConsoleThemePreset[] = [
  {
    id: 'themes.bootstrap',
    name: 'Bootstrap',
    description: 'Bootstrap 5’s blue',
    theme: {
      colorSchemes: {
        light: {
          primary: { main: '#0d6efd' },
          secondary: { main: '#6c757d' },
          background: { default: '#ffffff' },
        },
      },
    },
  },
  { id: 'themes.bare', name: 'Bare', theme: {} },
]

describe('theme presets for an app', () => {
  it('summarizes each preset by its name, line and swatches', () => {
    expect(summarizeThemePresets(PRESETS)).toEqual([
      {
        id: 'themes.bootstrap',
        name: 'Bootstrap',
        description: 'Bootstrap 5’s blue',
        swatches: ['#0d6efd', '#6c757d', '#ffffff'],
      },
      { id: 'themes.bare', name: 'Bare', description: '', swatches: [] },
    ])
  })

  it('finds the theme a picked id stands for', () => {
    expect(presetTargetFromRegistry('themes.bootstrap', PRESETS)?.name).toBe('Bootstrap')
    expect(presetTargetFromRegistry('themes.bootstrap', PRESETS)?.theme).toBe(PRESETS[0]?.theme)
    expect(presetTargetFromRegistry('themes.gone', PRESETS)).toBeUndefined()
  })
})
