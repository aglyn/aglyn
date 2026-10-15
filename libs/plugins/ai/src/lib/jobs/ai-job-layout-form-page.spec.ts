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

import type { AiBuildPlanScreen } from '../model/ai-build-plan'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { emptyAiSiteInventory } from '../model/ai-site-inventory'
import { aiLayoutFrameCheck, aiLayoutFrameTargets, aiLayoutHomeId, aiLayoutNavPages } from './ai-job-layout-language'
import { AI_LAYOUT_SITE_PAGES_INPUT, aiLayoutSitePagesOfPlan } from './ai-job-layout-site-pages'
import { AI_LAYOUT_FORM_PAGE_INPUT, aiLayoutFormPageOfPlan, aiLayoutPageTargets } from './ai-job-page-language'

/**
 * The beta.253 Panadería La Concha Dorada start (2026-10-15, job eg4maZMGtN):
 * its plan's pages and the sections that place its one created form, as the
 * job stored them. Home closes on "Visítanos o encarga", a copy of the form,
 * and is listed first; /pasteles and /visitanos place it too.
 */
const FORM = 'new:Formulario de contacto'
const section = (name: string, uses: string[] = []) => ({ name, uses, items: 0 })
const SCREENS = [
  {
    id: '5ZdrA-eIND',
    title: 'Inicio',
    slug: '/',
    nav: true,
    record: null,
    sections: [section('Hero'), section('Favoritos del menú', ['NCR4gX9ABA']), section('Visítanos o encarga', [FORM])],
  },
  { id: '2-1UNi9j2T', title: 'Menú', slug: '/menu', nav: true, record: null, sections: [section('Lista del menú', ['NCR4gX9ABA']), section('Invitación a encargar')] },
  {
    id: '56h95EYuXq',
    title: 'Pasteles',
    slug: '/pasteles',
    nav: true,
    record: null,
    sections: [section('Tipos de celebración'), section('Preguntas frecuentes', ['vkPjuiHoOT']), section('Cómo encargar', [FORM])],
  },
  { id: '0QEsx5yrli', title: 'Nuestra historia', slug: '/nuestra-historia', nav: true, record: null, sections: [section('Raíces en Oaxaca')] },
  { id: 'hsR_4p3K9c', title: 'Visítanos', slug: '/visitanos', nav: true, record: null, sections: [section('Dirección y horario'), section('Formulario de contacto', [FORM])] },
] as unknown as AiBuildPlanScreen[]
const PLAN = {
  screens: SCREENS,
  create: [{ kind: 'form', name: 'Formulario de contacto' }],
} as unknown as Pick<AiJobPlan, 'create' | 'screens'>
const HOME = '5ZdrA-eIND'
const PASTELES = '56h95EYuXq'

describe("a call to action asking to get in touch goes to the form's own page, not Home (AGL-3805)", () => {
  it('reads the page placing the form as the first one that is not Home', () => {
    expect(aiLayoutFormPageOfPlan(PLAN)).toBe(PASTELES)
  })

  it('still sends it Home when Home is the only page placing the form (AGL-3729)', () => {
    const homeOnly = {
      ...PLAN,
      screens: SCREENS.map((screen) => (screen.id === HOME ? screen : { ...screen, sections: screen.sections.map((entry) => ({ ...entry, uses: [] })) })),
    }
    expect(aiLayoutFormPageOfPlan(homeOnly)).toBe(HOME)
  })

  it('reads a form the site already has the same way, and none where no page places one', () => {
    const reused = { ...PLAN, create: [], screens: SCREENS.map((screen) => ({ ...screen, sections: screen.sections.map((entry) => ({ ...entry, uses: entry.uses.map((ref) => (ref === FORM ? 'form-1' : ref)) })) })) }
    expect(aiLayoutFormPageOfPlan(reused, ['form-1'])).toBe(PASTELES)
    expect(aiLayoutFormPageOfPlan(reused)).toBeNull()
  })

  it("links the header's and the footer's call to action to /pasteles, never the home page they show on", () => {
    const job = {
      $id: 'eg4maZMGtN',
      brief: 'Una panadería familiar de San Antonio con pan dulce, conchas y pasteles de tres leches.',
      inputs: {
        businessName: 'Panadería La Concha Dorada',
        [AI_LAYOUT_SITE_PAGES_INPUT]: aiLayoutSitePagesOfPlan(SCREENS, { guided: true }),
        // As the site step hands the layout unit its form's page.
        [AI_LAYOUT_FORM_PAGE_INPUT]: aiLayoutFormPageOfPlan(PLAN),
      },
      plan: { language: 'es' },
    } as unknown as AiJob
    const inventory = emptyAiSiteInventory('ltM_YVi33K')
    const pages = aiLayoutNavPages(job, inventory)
    const check = aiLayoutFrameCheck({
      siteName: 'Panadería La Concha Dorada',
      homeId: aiLayoutHomeId(pages, inventory),
      pages,
      targets: aiLayoutFrameTargets(job, inventory),
      extend: () => [],
      language: 'es',
    })
    // The production answer's shape: the header's button and the footer's,
    // each sent to the form as the frame's prompt says.
    const result = check({
      header: { band: 'plain', align: 'start', cols: [], blocks: [{ kind: 'button', col: -1, text: 'Pide tu pastel', to: 'form', icon: '', style: 'primary', items: [] }] },
      footer: {
        band: 'soft',
        align: 'start',
        cols: [2, 1],
        blocks: [
          { kind: 'text', col: 0, text: 'Pan dulce recién horneado cada mañana.', to: '', icon: '', style: 'none', items: [] },
          { kind: 'button', col: 1, text: 'Contáctanos', to: 'form', icon: '', style: 'secondary', items: [] },
        ],
      },
    })
    expect(result.violations).toEqual([])
    const nodes = Object.values(result.value?.nodes ?? {}) as Array<{ componentId: string; props?: Record<string, unknown> }>
    const buttons = nodes.filter((node) => node.componentId === 'muiButton').map((node) => [node.props?.['children'], node.props?.['screenId'] ?? node.props?.['href']])
    // The header's button, the phone menu's copy of it, and the footer's.
    expect(buttons).toEqual([
      ['Pide tu pastel', PASTELES],
      ['Pide tu pastel', PASTELES],
      ['Contáctanos', PASTELES],
    ])
  })

  it("leaves a page's own form section where it is: Home's links scroll to its form, the other pages' go to /pasteles", () => {
    const job = { brief: '', inputs: { [AI_LAYOUT_FORM_PAGE_INPUT]: aiLayoutFormPageOfPlan(PLAN) } } as unknown as AiJob
    expect(aiLayoutPageTargets({ job, inventory: null, own: [HOME] }).formPageId).toBe(PASTELES)
    expect(aiLayoutPageTargets({ job, inventory: null, own: ['2-1UNi9j2T'] }).formPageId).toBe(PASTELES)
    // The form's own page links no page for it: its section is on the page.
    expect(aiLayoutPageTargets({ job, inventory: null, own: [PASTELES] }).formPageId).toBeNull()
  })
})
