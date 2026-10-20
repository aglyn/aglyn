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

import type { NodesMap } from '@aglyn/aglyn/types/nodes'

/**
 * THE V1.0.0-BETA.271 LAUREL FORK PHOTOGRAPHY GUIDED START (AGL-3988), as
 * production left it: workspace jWmGooWE3L, host zVfToa7iIQ
 * (laurel-fork-photography.aglyn.app), job yZUqIPmjIZ, 2026-10-19 23:05Z,
 * "a wedding and family photographer in the Blue Ridge Mountains who books
 * sessions and elopements". Read back read-only from production's job and
 * host documents after the job finished.
 *
 * - `LAUREL_FORK_PAGES`: each published page's tree, cut to its sections,
 *   its pictures and every node between them (frames keep their shape), in
 *   document order. Copy and styling are left out; nothing else is changed.
 * - `LAUREL_FORK_PHOTOS`: the ten stock photos the job copied into the
 *   site's library (23:08:29 to 23:13:30), with the query that found each.
 * - `LAUREL_FORK_COVERS`: the twelve "Gallery collections" records, in
 *   order, every one on a starter (the office team and the desk in turn).
 * - `LAUREL_FORK_REFUSALS`: the Pixabay ids whose downloads the console's
 *   request logs show pixabay.com's Cloudflare refusing with 429 (after four
 *   tries each), by the beat that sent them. The logs name the photo, not
 *   the slot: the covers' beat built the datasets (23:07:09), the next beat
 *   the home page (23:08:11).
 */

/** The site's share image the publish left: the starter the site was created with. */
export const LAUREL_FORK_SHARE_IMAGE = { image: '/_static/starter/hero-team.jpg', imageWidth: 1600, imageHeight: 1067, imageAlt: 'A small team working together around a table in a bright office' } as const

/** The pages the start put live, in the site's order, each cut to its pictures. */
export const LAUREL_FORK_PAGES: ReadonlyArray<{ id: string; title: string; slug: string; nodes: NodesMap }> = [
  {
    id: '5opPRLVW_U',
    title: 'Home',
    slug: '/',
    nodes: {
      '_@_': { $id: '_@_', componentId: 'div', nodes: ['ai-5opPRLVW_U-section-1', 'ai-5opPRLVW_U-section-2', 'ai-5opPRLVW_U-section-3', 'ai-5opPRLVW_U-section-4', 'ai-5opPRLVW_U-section-5', 'ai-5opPRLVW_U-section-6'] },
      'ai-5opPRLVW_U-section-1': { $id: 'ai-5opPRLVW_U-section-1', componentId: 'section', parentId: '_@_', nodes: ['bUKvvYVspl'] },
      'ai-5opPRLVW_U-section-2': { $id: 'ai-5opPRLVW_U-section-2', componentId: 'section', parentId: '_@_', nodes: ['kZnxgtEEwW'] },
      'ai-5opPRLVW_U-section-3': { $id: 'ai-5opPRLVW_U-section-3', componentId: 'section', parentId: '_@_', nodes: ['rPNWWfbfQf'] },
      'ai-5opPRLVW_U-section-4': { $id: 'ai-5opPRLVW_U-section-4', componentId: 'section', parentId: '_@_', nodes: [] },
      'ai-5opPRLVW_U-section-5': { $id: 'ai-5opPRLVW_U-section-5', componentId: 'section', parentId: '_@_', nodes: ['k0XulehpfP'] },
      'ai-5opPRLVW_U-section-6': { $id: 'ai-5opPRLVW_U-section-6', componentId: 'section', parentId: '_@_', nodes: ['p9fSYaMS_L'], sx: { position: 'relative' } },
      bUKvvYVspl: { $id: 'bUKvvYVspl', componentId: 'muiContainer', parentId: 'ai-5opPRLVW_U-section-1', nodes: ['qDfEd0AZCr'] },
      kZnxgtEEwW: { $id: 'kZnxgtEEwW', componentId: 'muiContainer', parentId: 'ai-5opPRLVW_U-section-2', nodes: ['AyvCN0Vv9Z'] },
      rPNWWfbfQf: { $id: 'rPNWWfbfQf', componentId: 'muiContainer', parentId: 'ai-5opPRLVW_U-section-3', nodes: ['Ffnn6cK5Ga'] },
      k0XulehpfP: { $id: 'k0XulehpfP', componentId: 'muiContainer', parentId: 'ai-5opPRLVW_U-section-5', nodes: ['FR7WdQd4sZ'] },
      p9fSYaMS_L: { $id: 'p9fSYaMS_L', componentId: 'muiBox', parentId: 'ai-5opPRLVW_U-section-6', nodes: ['Hg-Yoxi45H'], sx: { position: 'absolute', width: '100%', height: '100%' } },
      qDfEd0AZCr: { $id: 'qDfEd0AZCr', componentId: 'muiStack', parentId: 'bUKvvYVspl', nodes: ['ECW4_DSLWt'] },
      AyvCN0Vv9Z: { $id: 'AyvCN0Vv9Z', componentId: 'muiStack', parentId: 'kZnxgtEEwW', nodes: ['QwlyU6yYqS'] },
      Ffnn6cK5Ga: { $id: 'Ffnn6cK5Ga', componentId: 'muiGrid', parentId: 'rPNWWfbfQf', nodes: ['bAJ25yBgWt'] },
      FR7WdQd4sZ: { $id: 'FR7WdQd4sZ', componentId: 'muiStack', parentId: 'k0XulehpfP', nodes: ['mTWJuHpqNc'] },
      'Hg-Yoxi45H': { $id: 'Hg-Yoxi45H', componentId: 'image', parentId: 'p9fSYaMS_L', nodes: [], props: { alt: 'A couple at a wedding', src: 'media:zVfToa7iIQ/20t9SUxyKJ', intrinsicWidth: 1280, intrinsicHeight: 720 } },
      ECW4_DSLWt: { $id: 'ECW4_DSLWt', componentId: 'muiBox', parentId: 'qDfEd0AZCr', nodes: ['MDpjUplylc'], sx: { position: 'relative', aspectRatio: { xs: '4 / 3', md: '21 / 9' } } },
      QwlyU6yYqS: { $id: 'QwlyU6yYqS', componentId: 'muiBox', parentId: 'AyvCN0Vv9Z', nodes: ['-AJupgvXns'] },
      bAJ25yBgWt: { $id: 'bAJ25yBgWt', componentId: 'muiGrid', parentId: 'Ffnn6cK5Ga', nodes: ['21gPMGZVtp'] },
      mTWJuHpqNc: { $id: 'mTWJuHpqNc', componentId: 'muiGrid', parentId: 'FR7WdQd4sZ', nodes: ['6fk0o-tRgv'] },
      MDpjUplylc: { $id: 'MDpjUplylc', componentId: 'image', parentId: 'ECW4_DSLWt', nodes: [], props: { alt: 'A small team working together around a table in a bright office', src: '/_static/starter/hero-team.jpg', intrinsicWidth: 1600, intrinsicHeight: 1067, loading: 'eager' } },
      '-AJupgvXns': { $id: '-AJupgvXns', componentId: 'muiStack', parentId: 'QwlyU6yYqS', nodes: ['pfhzMkYkWV'] },
      '21gPMGZVtp': { $id: '21gPMGZVtp', componentId: 'muiBox', parentId: 'bAJ25yBgWt', nodes: ['A60C_InPsl'], sx: { position: 'relative', aspectRatio: '4 / 3' } },
      '6fk0o-tRgv': { $id: '6fk0o-tRgv', componentId: 'muiGrid', parentId: 'mTWJuHpqNc', nodes: ['MDsN8QXzkJ'] },
      pfhzMkYkWV: { $id: 'pfhzMkYkWV', componentId: 'image', parentId: '-AJupgvXns', nodes: [], sx: { aspectRatio: '4 / 5' }, props: { alt: '{{item.image_description}}', loading: 'lazy', src: '{{item.image}}' } },
      A60C_InPsl: { $id: 'A60C_InPsl', componentId: 'image', parentId: '21gPMGZVtp', nodes: [], sx: { position: 'absolute', width: '100%', height: '100%' }, props: { alt: 'A tidy desk with a laptop, a lamp and fresh flowers', src: '/_static/starter/gallery-desk.jpg', intrinsicWidth: 1600, intrinsicHeight: 1068 } },
      MDsN8QXzkJ: { $id: 'MDsN8QXzkJ', componentId: 'muiStack', parentId: '6fk0o-tRgv', nodes: ['HpkOCRgkaU'] },
      HpkOCRgkaU: { $id: 'HpkOCRgkaU', componentId: 'image', parentId: 'MDsN8QXzkJ', nodes: [], sx: { aspectRatio: { xs: '4 / 3', md: '4 / 5' } }, props: { alt: 'A family in the mountains', src: 'media:zVfToa7iIQ/Dno5tXH307', intrinsicWidth: 853, intrinsicHeight: 1280 } },
    } as unknown as NodesMap,
  },
  {
    id: 'GLoK3JfOCj',
    title: 'Galleries',
    slug: '/galleries',
    nodes: {
      '_@_': { $id: '_@_', componentId: 'div', nodes: ['ai-GLoK3JfOCj-section-1', 'ai-GLoK3JfOCj-section-2', 'ai-GLoK3JfOCj-section-3', 'ai-GLoK3JfOCj-section-4'] },
      'ai-GLoK3JfOCj-section-1': { $id: 'ai-GLoK3JfOCj-section-1', componentId: 'section', parentId: '_@_', nodes: ['bE7h5VR4fS'] },
      'ai-GLoK3JfOCj-section-2': { $id: 'ai-GLoK3JfOCj-section-2', componentId: 'section', parentId: '_@_', nodes: ['keKfGYqdrv'] },
      'ai-GLoK3JfOCj-section-3': { $id: 'ai-GLoK3JfOCj-section-3', componentId: 'section', parentId: '_@_', nodes: ['T0-Kc1k-5E'] },
      'ai-GLoK3JfOCj-section-4': { $id: 'ai-GLoK3JfOCj-section-4', componentId: 'section', parentId: '_@_', nodes: ['m7rhszuwJ_'], sx: { position: 'relative' } },
      bE7h5VR4fS: { $id: 'bE7h5VR4fS', componentId: 'muiContainer', parentId: 'ai-GLoK3JfOCj-section-1', nodes: ['61515BBhnA'] },
      keKfGYqdrv: { $id: 'keKfGYqdrv', componentId: 'muiContainer', parentId: 'ai-GLoK3JfOCj-section-2', nodes: ['dmaHvXXLog'] },
      'T0-Kc1k-5E': { $id: 'T0-Kc1k-5E', componentId: 'muiContainer', parentId: 'ai-GLoK3JfOCj-section-3', nodes: ['rRaTuKKtV_'] },
      m7rhszuwJ_: { $id: 'm7rhszuwJ_', componentId: 'muiBox', parentId: 'ai-GLoK3JfOCj-section-4', nodes: ['wt_B806Cz2'], sx: { position: 'absolute', width: '100%', height: '100%' } },
      '61515BBhnA': { $id: '61515BBhnA', componentId: 'muiStack', parentId: 'bE7h5VR4fS', nodes: ['lxEoMaVorh'] },
      dmaHvXXLog: { $id: 'dmaHvXXLog', componentId: 'muiStack', parentId: 'keKfGYqdrv', nodes: ['vjw8N7hFAS'] },
      rRaTuKKtV_: { $id: 'rRaTuKKtV_', componentId: 'muiStack', parentId: 'T0-Kc1k-5E', nodes: ['lrqoLGssJc'] },
      wt_B806Cz2: { $id: 'wt_B806Cz2', componentId: 'image', parentId: 'm7rhszuwJ_', nodes: [], props: { alt: 'A father with a son in the mountains', src: 'media:zVfToa7iIQ/oKqg7KVmFs', intrinsicWidth: 1280, intrinsicHeight: 820 } },
      lxEoMaVorh: { $id: 'lxEoMaVorh', componentId: 'muiBox', parentId: '61515BBhnA', nodes: ['8Z0J2Dvkc4'], sx: { position: 'relative', aspectRatio: { xs: '16 / 9', md: '3 / 1' } } },
      vjw8N7hFAS: { $id: 'vjw8N7hFAS', componentId: 'muiBox', parentId: 'dmaHvXXLog', nodes: ['bctLBlZwCn'] },
      lrqoLGssJc: { $id: 'lrqoLGssJc', componentId: 'muiBox', parentId: 'rRaTuKKtV_', nodes: ['BuK5C-zbWh'] },
      '8Z0J2Dvkc4': { $id: '8Z0J2Dvkc4', componentId: 'image', parentId: 'lxEoMaVorh', nodes: [], props: { alt: 'A flower at a wedding', src: 'media:zVfToa7iIQ/adqePe-iIO', intrinsicWidth: 1280, intrinsicHeight: 853, loading: 'eager' } },
      bctLBlZwCn: { $id: 'bctLBlZwCn', componentId: 'muiStack', parentId: 'vjw8N7hFAS', nodes: ['5VjwlqdQsP'] },
      'BuK5C-zbWh': { $id: 'BuK5C-zbWh', componentId: 'muiStack', parentId: 'lrqoLGssJc', nodes: ['rmPoyiqnm1'] },
      '5VjwlqdQsP': { $id: '5VjwlqdQsP', componentId: 'image', parentId: 'bctLBlZwCn', nodes: [], sx: { aspectRatio: '4 / 5' }, props: { alt: '{{item.image_description}}', loading: 'lazy', src: '{{item.image}}' } },
      rmPoyiqnm1: { $id: 'rmPoyiqnm1', componentId: 'image', parentId: 'BuK5C-zbWh', nodes: [], sx: { aspectRatio: '4 / 5' }, props: { alt: '{{item.image_description}}', loading: 'lazy', src: '{{item.image}}' } },
    } as unknown as NodesMap,
  },
  {
    id: 'KgHi9fbWpy',
    title: 'Packages',
    slug: '/packages',
    nodes: {
      '_@_': { $id: '_@_', componentId: 'div', nodes: ['ai-KgHi9fbWpy-section-1', 'ai-KgHi9fbWpy-section-2', 'ai-KgHi9fbWpy-section-3', 'ai-KgHi9fbWpy-section-4'] },
      'ai-KgHi9fbWpy-section-1': { $id: 'ai-KgHi9fbWpy-section-1', componentId: 'section', parentId: '_@_', nodes: ['KcpbqM5HGe'] },
      'ai-KgHi9fbWpy-section-2': { $id: 'ai-KgHi9fbWpy-section-2', componentId: 'section', parentId: '_@_', nodes: [] },
      'ai-KgHi9fbWpy-section-3': { $id: 'ai-KgHi9fbWpy-section-3', componentId: 'section', parentId: '_@_', nodes: [] },
      'ai-KgHi9fbWpy-section-4': { $id: 'ai-KgHi9fbWpy-section-4', componentId: 'section', parentId: '_@_', nodes: ['RUCfDEpGHe'], sx: { position: 'relative' } },
      KcpbqM5HGe: { $id: 'KcpbqM5HGe', componentId: 'muiContainer', parentId: 'ai-KgHi9fbWpy-section-1', nodes: ['FqJTPKOFhc'] },
      RUCfDEpGHe: { $id: 'RUCfDEpGHe', componentId: 'muiBox', parentId: 'ai-KgHi9fbWpy-section-4', nodes: ['JYPG2A7rAM'], sx: { position: 'absolute', width: '100%', height: '100%' } },
      FqJTPKOFhc: { $id: 'FqJTPKOFhc', componentId: 'muiStack', parentId: 'KcpbqM5HGe', nodes: ['A0jJJciYYl'] },
      JYPG2A7rAM: { $id: 'JYPG2A7rAM', componentId: 'image', parentId: 'RUCfDEpGHe', nodes: [], props: { alt: 'A couple at sunset', src: 'media:zVfToa7iIQ/RyW7TuJfq4', intrinsicWidth: 1280, intrinsicHeight: 1117 } },
      A0jJJciYYl: { $id: 'A0jJJciYYl', componentId: 'muiBox', parentId: 'FqJTPKOFhc', nodes: ['TSZstV47eS'], sx: { position: 'relative', aspectRatio: { xs: '16 / 9', md: '3 / 1' } } },
      TSZstV47eS: { $id: 'TSZstV47eS', componentId: 'image', parentId: 'A0jJJciYYl', nodes: [], props: { alt: 'An aisle at a wedding', src: 'media:zVfToa7iIQ/Q_imBRl0u7', intrinsicWidth: 1280, intrinsicHeight: 854, loading: 'eager' } },
    } as unknown as NodesMap,
  },
  {
    id: '2V3XE8mq50',
    title: 'About',
    slug: '/about',
    nodes: {
      '_@_': { $id: '_@_', componentId: 'div', nodes: ['ai-2V3XE8mq50-section-1', 'ai-2V3XE8mq50-section-2', 'ai-2V3XE8mq50-section-3', 'ai-2V3XE8mq50-section-4', 'ai-2V3XE8mq50-section-5'] },
      'ai-2V3XE8mq50-section-1': { $id: 'ai-2V3XE8mq50-section-1', componentId: 'section', parentId: '_@_', nodes: ['_qdKnXC6SG'] },
      'ai-2V3XE8mq50-section-2': { $id: 'ai-2V3XE8mq50-section-2', componentId: 'section', parentId: '_@_', nodes: ['DNXBX6Rjty'] },
      'ai-2V3XE8mq50-section-3': { $id: 'ai-2V3XE8mq50-section-3', componentId: 'section', parentId: '_@_', nodes: ['P05uXIH3ay'] },
      'ai-2V3XE8mq50-section-4': { $id: 'ai-2V3XE8mq50-section-4', componentId: 'section', parentId: '_@_', nodes: ['laVjLPJZ4L'] },
      'ai-2V3XE8mq50-section-5': { $id: 'ai-2V3XE8mq50-section-5', componentId: 'section', parentId: '_@_', nodes: [] },
      _qdKnXC6SG: { $id: '_qdKnXC6SG', componentId: 'muiContainer', parentId: 'ai-2V3XE8mq50-section-1', nodes: ['uPTgcF6jUS'] },
      DNXBX6Rjty: { $id: 'DNXBX6Rjty', componentId: 'muiContainer', parentId: 'ai-2V3XE8mq50-section-2', nodes: ['7W5I4m7ArO'] },
      P05uXIH3ay: { $id: 'P05uXIH3ay', componentId: 'muiContainer', parentId: 'ai-2V3XE8mq50-section-3', nodes: ['3s62hrq9-J'] },
      laVjLPJZ4L: { $id: 'laVjLPJZ4L', componentId: 'muiContainer', parentId: 'ai-2V3XE8mq50-section-4', nodes: ['o66WNW1fIn'] },
      uPTgcF6jUS: { $id: 'uPTgcF6jUS', componentId: 'muiStack', parentId: '_qdKnXC6SG', nodes: ['Kg7ruI_Meh'] },
      '7W5I4m7ArO': { $id: '7W5I4m7ArO', componentId: 'muiGrid', parentId: 'DNXBX6Rjty', nodes: ['QWuFAJeRmO'] },
      '3s62hrq9-J': { $id: '3s62hrq9-J', componentId: 'muiStack', parentId: 'P05uXIH3ay', nodes: ['vFwen5PXdE'] },
      o66WNW1fIn: { $id: 'o66WNW1fIn', componentId: 'muiStack', parentId: 'laVjLPJZ4L', nodes: ['ermJcuJZ3n'] },
      Kg7ruI_Meh: { $id: 'Kg7ruI_Meh', componentId: 'muiBox', parentId: 'uPTgcF6jUS', nodes: ['w2coL2n_tN'], sx: { position: 'relative', aspectRatio: { xs: '16 / 9', md: '3 / 1' } } },
      QWuFAJeRmO: { $id: 'QWuFAJeRmO', componentId: 'muiGrid', parentId: '7W5I4m7ArO', nodes: ['oXdwyBK5Gj'] },
      vFwen5PXdE: { $id: 'vFwen5PXdE', componentId: 'muiGrid', parentId: '3s62hrq9-J', nodes: ['R8y0_H5y1r', 'qh6v4JMuvM', 'ss9ZdrPkPO'] },
      ermJcuJZ3n: { $id: 'ermJcuJZ3n', componentId: 'muiGrid', parentId: 'o66WNW1fIn', nodes: ['zNjq_ENdsA', 'xHGY5h74hw', 'OXk2tX7oIo'] },
      w2coL2n_tN: { $id: 'w2coL2n_tN', componentId: 'image', parentId: 'Kg7ruI_Meh', nodes: [], props: { alt: 'A father with a son in the mountains', src: 'media:zVfToa7iIQ/oKqg7KVmFs', intrinsicWidth: 1280, intrinsicHeight: 820, loading: 'eager' } },
      oXdwyBK5Gj: { $id: 'oXdwyBK5Gj', componentId: 'muiBox', parentId: 'QWuFAJeRmO', nodes: ['oFYhWhTjA8'], sx: { position: 'relative', aspectRatio: '4 / 3' } },
      R8y0_H5y1r: { $id: 'R8y0_H5y1r', componentId: 'muiGrid', parentId: 'vFwen5PXdE', nodes: ['mxxJl8mJeQ'] },
      qh6v4JMuvM: { $id: 'qh6v4JMuvM', componentId: 'muiGrid', parentId: 'vFwen5PXdE', nodes: ['7B-dRm9KH0'] },
      ss9ZdrPkPO: { $id: 'ss9ZdrPkPO', componentId: 'muiGrid', parentId: 'vFwen5PXdE', nodes: ['UqRQw7fAJL'] },
      zNjq_ENdsA: { $id: 'zNjq_ENdsA', componentId: 'muiGrid', parentId: 'ermJcuJZ3n', nodes: ['_tcXdiehBM'] },
      xHGY5h74hw: { $id: 'xHGY5h74hw', componentId: 'muiGrid', parentId: 'ermJcuJZ3n', nodes: ['DhHFJngdtx'] },
      OXk2tX7oIo: { $id: 'OXk2tX7oIo', componentId: 'muiGrid', parentId: 'ermJcuJZ3n', nodes: ['DX1d3Nk_SS'] },
      oFYhWhTjA8: { $id: 'oFYhWhTjA8', componentId: 'image', parentId: 'oXdwyBK5Gj', nodes: [], sx: { position: 'absolute', width: '100%', height: '100%' }, props: { alt: 'A couple at sunset', src: 'media:zVfToa7iIQ/RyW7TuJfq4', intrinsicWidth: 1280, intrinsicHeight: 1117 } },
      mxxJl8mJeQ: { $id: 'mxxJl8mJeQ', componentId: 'muiStack', parentId: 'R8y0_H5y1r', nodes: ['NUokTPuJqS'] },
      '7B-dRm9KH0': { $id: '7B-dRm9KH0', componentId: 'muiStack', parentId: 'qh6v4JMuvM', nodes: ['mXvxLG6ZCC'] },
      UqRQw7fAJL: { $id: 'UqRQw7fAJL', componentId: 'muiStack', parentId: 'ss9ZdrPkPO', nodes: ['cDkrmCHRY8'] },
      _tcXdiehBM: { $id: '_tcXdiehBM', componentId: 'muiStack', parentId: 'zNjq_ENdsA', nodes: ['_18zZdjkXI'] },
      DhHFJngdtx: { $id: 'DhHFJngdtx', componentId: 'muiStack', parentId: 'xHGY5h74hw', nodes: ['T4nyq3oMFE'] },
      DX1d3Nk_SS: { $id: 'DX1d3Nk_SS', componentId: 'muiStack', parentId: 'OXk2tX7oIo', nodes: ['6r8o7QflaP'] },
      NUokTPuJqS: { $id: 'NUokTPuJqS', componentId: 'image', parentId: 'mxxJl8mJeQ', nodes: [], sx: { aspectRatio: { xs: '4 / 3', md: '4 / 5' } }, props: { alt: 'A family in the mountains', src: 'media:zVfToa7iIQ/Dno5tXH307', intrinsicWidth: 853, intrinsicHeight: 1280 } },
      mXvxLG6ZCC: { $id: 'mXvxLG6ZCC', componentId: 'image', parentId: '7B-dRm9KH0', nodes: [], sx: { aspectRatio: { xs: '4 / 3', md: '4 / 5' } }, props: { alt: 'An aisle at a wedding', src: 'media:zVfToa7iIQ/Q_imBRl0u7', intrinsicWidth: 1280, intrinsicHeight: 854 } },
      cDkrmCHRY8: { $id: 'cDkrmCHRY8', componentId: 'image', parentId: 'UqRQw7fAJL', nodes: [], sx: { aspectRatio: { xs: '4 / 3', md: '4 / 5' } }, props: { alt: 'A flower at a wedding', src: 'media:zVfToa7iIQ/adqePe-iIO', intrinsicWidth: 1280, intrinsicHeight: 853 } },
      _18zZdjkXI: { $id: '_18zZdjkXI', componentId: 'image', parentId: '_tcXdiehBM', nodes: [], sx: { aspectRatio: { xs: '4 / 3', md: '4 / 5' } }, props: { alt: 'A couple at a wedding', src: 'media:zVfToa7iIQ/20t9SUxyKJ', intrinsicWidth: 1280, intrinsicHeight: 720 } },
      T4nyq3oMFE: { $id: 'T4nyq3oMFE', componentId: 'image', parentId: 'DhHFJngdtx', nodes: [], sx: { aspectRatio: { xs: '4 / 3', md: '4 / 5' } }, props: { alt: 'A family in the mountains', src: 'media:zVfToa7iIQ/Dno5tXH307', intrinsicWidth: 853, intrinsicHeight: 1280 } },
      '6r8o7QflaP': { $id: '6r8o7QflaP', componentId: 'image', parentId: 'DX1d3Nk_SS', nodes: [], sx: { aspectRatio: { xs: '4 / 3', md: '4 / 5' } }, props: { alt: 'A couple at sunset', src: 'media:zVfToa7iIQ/RyW7TuJfq4', intrinsicWidth: 1280, intrinsicHeight: 1117 } },
    } as unknown as NodesMap,
  },
  {
    id: 'uck__d_Wpk',
    title: 'FAQ',
    slug: '/faq',
    nodes: {
      '_@_': { $id: '_@_', componentId: 'div', nodes: ['ai-uck__d_Wpk-section-1', 'ai-uck__d_Wpk-section-2', 'ai-uck__d_Wpk-section-3'] },
      'ai-uck__d_Wpk-section-1': { $id: 'ai-uck__d_Wpk-section-1', componentId: 'section', parentId: '_@_', nodes: ['Sq20gfoLHO'] },
      'ai-uck__d_Wpk-section-2': { $id: 'ai-uck__d_Wpk-section-2', componentId: 'section', parentId: '_@_', nodes: [] },
      'ai-uck__d_Wpk-section-3': { $id: 'ai-uck__d_Wpk-section-3', componentId: 'section', parentId: '_@_', nodes: ['iPn-4Qm3HO'], sx: { position: 'relative' } },
      Sq20gfoLHO: { $id: 'Sq20gfoLHO', componentId: 'muiContainer', parentId: 'ai-uck__d_Wpk-section-1', nodes: ['jm8QiMQi_q'] },
      'iPn-4Qm3HO': { $id: 'iPn-4Qm3HO', componentId: 'muiBox', parentId: 'ai-uck__d_Wpk-section-3', nodes: ['ELjSSmxB67'], sx: { position: 'absolute', width: '100%', height: '100%' } },
      jm8QiMQi_q: { $id: 'jm8QiMQi_q', componentId: 'muiStack', parentId: 'Sq20gfoLHO', nodes: ['xBtp9iJ8EL'] },
      ELjSSmxB67: { $id: 'ELjSSmxB67', componentId: 'image', parentId: 'iPn-4Qm3HO', nodes: [], props: { alt: 'A family in the mountains', src: 'media:zVfToa7iIQ/OdwfZdKKAt', intrinsicWidth: 1280, intrinsicHeight: 853 } },
      xBtp9iJ8EL: { $id: 'xBtp9iJ8EL', componentId: 'muiBox', parentId: 'jm8QiMQi_q', nodes: ['AGD00MGenQ'], sx: { position: 'relative', aspectRatio: { xs: '16 / 9', md: '3 / 1' } } },
      AGD00MGenQ: { $id: 'AGD00MGenQ', componentId: 'image', parentId: 'xBtp9iJ8EL', nodes: [], props: { alt: 'A bride at a wedding', src: 'media:zVfToa7iIQ/abVI9Y5qiS', intrinsicWidth: 1280, intrinsicHeight: 853, loading: 'eager' } },
    } as unknown as NodesMap,
  },
  {
    id: 'BmIet_iYyX',
    title: 'Contact',
    slug: '/contact',
    nodes: {
      '_@_': { $id: '_@_', componentId: 'div', nodes: ['ai-BmIet_iYyX-section-1', 'ai-BmIet_iYyX-section-2', 'ai-BmIet_iYyX-section-3', 'ai-BmIet_iYyX-section-4'] },
      'ai-BmIet_iYyX-section-1': { $id: 'ai-BmIet_iYyX-section-1', componentId: 'section', parentId: '_@_', nodes: ['30K-RgmUlF'] },
      'ai-BmIet_iYyX-section-2': { $id: 'ai-BmIet_iYyX-section-2', componentId: 'section', parentId: '_@_', nodes: [] },
      'ai-BmIet_iYyX-section-3': { $id: 'ai-BmIet_iYyX-section-3', componentId: 'section', parentId: '_@_', nodes: ['5DbQg2dXyW'] },
      'ai-BmIet_iYyX-section-4': { $id: 'ai-BmIet_iYyX-section-4', componentId: 'section', parentId: '_@_', nodes: [] },
      '30K-RgmUlF': { $id: '30K-RgmUlF', componentId: 'muiContainer', parentId: 'ai-BmIet_iYyX-section-1', nodes: ['adsQCltSNm'] },
      '5DbQg2dXyW': { $id: '5DbQg2dXyW', componentId: 'muiContainer', parentId: 'ai-BmIet_iYyX-section-3', nodes: ['EYX7UJW0m4'] },
      adsQCltSNm: { $id: 'adsQCltSNm', componentId: 'muiStack', parentId: '30K-RgmUlF', nodes: ['4EJrAgdmXy'] },
      EYX7UJW0m4: { $id: 'EYX7UJW0m4', componentId: 'muiGrid', parentId: '5DbQg2dXyW', nodes: ['1wp3Gj6_uw'] },
      '4EJrAgdmXy': { $id: '4EJrAgdmXy', componentId: 'muiBox', parentId: 'adsQCltSNm', nodes: ['DY8Ya5RX5O'], sx: { position: 'relative', aspectRatio: { xs: '16 / 9', md: '3 / 1' } } },
      '1wp3Gj6_uw': { $id: '1wp3Gj6_uw', componentId: 'muiGrid', parentId: 'EYX7UJW0m4', nodes: ['4dzQeWnYMQ'] },
      DY8Ya5RX5O: { $id: 'DY8Ya5RX5O', componentId: 'image', parentId: '4EJrAgdmXy', nodes: [], props: { alt: 'A family in the mountains', src: 'media:zVfToa7iIQ/TIP2UNTKZJ', intrinsicWidth: 1280, intrinsicHeight: 853, loading: 'eager' } },
      '4dzQeWnYMQ': { $id: '4dzQeWnYMQ', componentId: 'muiBox', parentId: '1wp3Gj6_uw', nodes: ['cS8XMuN79D'], sx: { position: 'relative', aspectRatio: '4 / 3' } },
      cS8XMuN79D: { $id: 'cS8XMuN79D', componentId: 'image', parentId: '4dzQeWnYMQ', nodes: [], sx: { position: 'absolute', width: '100%', height: '100%' }, props: { alt: 'A couple with a cowboy', src: 'media:zVfToa7iIQ/4QuVNZGL4H', intrinsicWidth: 1280, intrinsicHeight: 719 } },
    } as unknown as NodesMap,
  },
]

/** The photos the job copied into the site's library, in the order it copied them. */
export const LAUREL_FORK_PHOTOS: ReadonlyArray<{ mediaId: string; key: string; width: number; height: number; alt: string; query: string; at: string }> = [
  { mediaId: '20t9SUxyKJ', key: 'pixabay:5401602', width: 1280, height: 720, alt: 'A couple at a wedding', query: 'wedding couple mountains', at: '2026-10-19T23:08:29.029Z' },
  { mediaId: 'Dno5tXH307', key: 'pixabay:6071186', width: 853, height: 1280, alt: 'A family in the mountains', query: 'family mountains', at: '2026-10-19T23:08:29.363Z' },
  { mediaId: 'adqePe-iIO', key: 'pixabay:5582980', width: 1280, height: 853, alt: 'A flower at a wedding', query: 'wedding', at: '2026-10-19T23:09:30.033Z' },
  { mediaId: 'oKqg7KVmFs', key: 'pixabay:1576456', width: 1280, height: 820, alt: 'A father with a son in the mountains', query: 'family mountains', at: '2026-10-19T23:09:30.054Z' },
  { mediaId: 'Q_imBRl0u7', key: 'pixabay:1846114', width: 1280, height: 854, alt: 'An aisle at a wedding', query: 'wedding', at: '2026-10-19T23:10:42.873Z' },
  { mediaId: 'RyW7TuJfq4', key: 'pixabay:2191391', width: 1280, height: 1117, alt: 'A couple at sunset', query: 'wedding couple mountains', at: '2026-10-19T23:10:42.886Z' },
  { mediaId: 'abVI9Y5qiS', key: 'pixabay:1837148', width: 1280, height: 853, alt: 'A bride at a wedding', query: 'wedding couple mountains', at: '2026-10-19T23:12:32.576Z' },
  { mediaId: 'OdwfZdKKAt', key: 'pixabay:4610864', width: 1280, height: 853, alt: 'A family in the mountains', query: 'family mountains', at: '2026-10-19T23:12:32.883Z' },
  { mediaId: '4QuVNZGL4H', key: 'pixabay:5404826', width: 1280, height: 719, alt: 'A couple with a cowboy', query: 'wedding couple mountains', at: '2026-10-19T23:13:29.574Z' },
  { mediaId: 'TIP2UNTKZJ', key: 'pixabay:7843738', width: 1280, height: 853, alt: 'A family in the mountains', query: 'family mountains', at: '2026-10-19T23:13:30.077Z' },
]

/** The "Gallery collections" records production wrote (dataset WX2B9IcAnF), in order. */
export const LAUREL_FORK_COVERS: ReadonlyArray<{ order: number; title: string; category: string; image: string; imageDescription: string }> = [
  { order: 0, title: 'Mountain elopements', category: 'Weddings and elopements', image: '/_static/starter/hero-team.jpg', imageDescription: 'A small team working together around a table in a bright office' },
  { order: 1, title: 'Overlook vows', category: 'Weddings and elopements', image: '/_static/starter/gallery-desk.jpg', imageDescription: 'A tidy desk with a laptop, a lamp and fresh flowers' },
  { order: 2, title: 'Small weddings', category: 'Weddings and elopements', image: '/_static/starter/hero-team.jpg', imageDescription: 'A small team working together around a table in a bright office' },
  { order: 3, title: 'Getting ready', category: 'Weddings and elopements', image: '/_static/starter/gallery-desk.jpg', imageDescription: 'A tidy desk with a laptop, a lamp and fresh flowers' },
  { order: 4, title: 'First looks in the trees', category: 'Weddings and elopements', image: '/_static/starter/hero-team.jpg', imageDescription: 'A small team working together around a table in a bright office' },
  { order: 5, title: 'Couples portraits', category: 'Weddings and elopements', image: '/_static/starter/gallery-desk.jpg', imageDescription: 'A tidy desk with a laptop, a lamp and fresh flowers' },
  { order: 6, title: 'Family sessions outdoors', category: 'Family portraits', image: '/_static/starter/hero-team.jpg', imageDescription: 'A small team working together around a table in a bright office' },
  { order: 7, title: 'Parents and little ones', category: 'Family portraits', image: '/_static/starter/gallery-desk.jpg', imageDescription: 'A tidy desk with a laptop, a lamp and fresh flowers' },
  { order: 8, title: 'Multi-generation portraits', category: 'Family portraits', image: '/_static/starter/hero-team.jpg', imageDescription: 'A small team working together around a table in a bright office' },
  { order: 9, title: 'Golden hour families', category: 'Family portraits', image: '/_static/starter/gallery-desk.jpg', imageDescription: 'A tidy desk with a laptop, a lamp and fresh flowers' },
  { order: 10, title: 'Milestone sessions', category: 'Family portraits', image: '/_static/starter/hero-team.jpg', imageDescription: 'A small team working together around a table in a bright office' },
  { order: 11, title: 'Siblings and cousins', category: 'Family portraits', image: '/_static/starter/gallery-desk.jpg', imageDescription: 'A tidy desk with a laptop, a lamp and fresh flowers' },
]

/** The downloads the image hosts refused, by the beat that sent them (its request's start, from the console's logs). */
export const LAUREL_FORK_REFUSALS = {
  /** The beat that built the site layout, the datasets and the form: every one of them a "Gallery collections" cover's pick. */
  covers: {
    at: '2026-10-19T23:07:09.140Z',
    ids: ['8028185', '2179256', '7612157', '1837148', '5693164', '6935359', '6704262', '7103290', '2191391', '7162791', '6230410', '1576456', '621634', '4610864', '2592704', '868394', '5401602', '7843738', '3717770', '6883668', '515532', '6935341'],
  },
  /** The beat that built the home page: its hero's and its about split's picks among them. */
  home: {
    at: '2026-10-19T23:08:11.813Z',
    ids: ['1846114', '5061887', '7302669', '7315389', '1837148', '3997967', '7103290', '621634', '5582980', '9981742', '9034408'],
  },
} as const

