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
 * A site's first post held to what its blog publishes (AGL-3676): plain
 * fields, a markdown-lite body with no title line, no link or bracket, and
 * no price, claim or rating the brief did not give.
 */

import {
  AI_BLOG_POST_INSTRUCTIONS,
  AI_BLOG_POST_MAX_TOKENS,
  aiBlogPostPrompt,
} from '../runtime/ai-blog-post-generation'
import { AI_BLOG_POST_LIMITS, AI_BLOG_POST_TOOL, checkAiBlogPost } from './ai-blog-post-tool'

const BRIEF = 'A blog about wheel-thrown pottery for beginners, by a small studio in Austin.'

const BODY = [
  'Centering is the first thing the wheel asks of you, and the one that takes the longest to feel right.',
  '',
  '## Start wet, not soaked',
  '',
  'Keep your hands and the clay damp so they glide. Too much water softens the clay and it collapses; too little and it drags.',
  '',
  '## Brace, then press',
  '',
  '- Rest your elbows on your thighs.',
  '- Press inward and down with steady, even pressure.',
  '- Let the wheel do the work at a medium speed.',
  '',
  'When the clay stops wobbling under your hands, it is centered. **Stop there** and open it.',
  '',
  'If it keeps wobbling, take a breath, slow the wheel a little, and start again from a lower mound.',
].join('\n')

const GOOD = {
  title: 'Centering clay without the struggle',
  excerpt: 'The first skill on the wheel, broken into steps you can practice.',
  body: BODY,
  seoDescription: 'How to center clay on the pottery wheel, step by step, for beginners.',
}

const check = (answer: Record<string, unknown>, earlierTitles: string[] = []) =>
  checkAiBlogPost(answer, { merchantWords: BRIEF, earlierTitles })
const codes = (answer: Record<string, unknown>, earlierTitles: string[] = []) =>
  check(answer, earlierTitles).violations.map((violation) => violation.code)

describe('a first post', () => {
  it('keeps a post that holds to every rule, as written', () => {
    const result = check(GOOD)
    expect(result.violations).toEqual([])
    expect(result.value).toEqual(GOOD)
  })

  it('refuses a title line, a link, brackets and HTML in the body', () => {
    expect(codes({ ...GOOD, body: `# ${GOOD.title}\n\n${BODY}` })).toContain('title-line')
    expect(codes({ ...GOOD, body: `${BODY}\n\nSee [our classes](https://example.com).` })).toEqual(
      expect.arrayContaining(['link', 'bracket']),
    )
    expect(codes({ ...GOOD, body: `${BODY}\n\nWe are open [hours].` })).toContain('bracket')
    expect(codes({ ...GOOD, body: `${BODY}\n\n<b>Hi</b>` })).toContain('markup')
  })

  it('refuses a body too short or too long, and a field past its length', () => {
    expect(codes({ ...GOOD, body: 'Short.' })).toContain('length')
    expect(codes({ ...GOOD, body: 'a '.repeat(AI_BLOG_POST_LIMITS.bodyMax) })).toContain('length')
    expect(codes({ ...GOOD, title: 'x'.repeat(AI_BLOG_POST_LIMITS.titleMax + 1) })).toContain('too-long')
  })

  it('refuses marks in its plain fields', () => {
    expect(codes({ ...GOOD, title: '**Centering** clay' })).toContain('markup')
    expect(codes({ ...GOOD, excerpt: 'Read at www.example.com' })).toContain('link')
  })

  it('refuses a price, a rating and a claim nobody gave', () => {
    expect(codes({ ...GOOD, body: `${BODY}\n\nOur beginner class is $45 a session.` })).toContain('storefront-price-invented')
    expect(codes({ ...GOOD, body: `${BODY}\n\nStudents rate us 4.9 out of 5.` })).toContain('rating-invented')
    expect(codes({ ...GOOD, body: `${BODY}\n\nClay work cures anxiety.` })).toEqual(
      expect.arrayContaining([expect.stringMatching(/^storefront-claim-health$/)]),
    )
  })

  it('refuses a title another post already has', () => {
    expect(codes(GOOD, ['Centering Clay Without The Struggle'])).toContain('title-duplicate')
  })
})

describe('how a post is asked', () => {
  it('asks every field, strictly', () => {
    expect(AI_BLOG_POST_TOOL.strict).toBe(true)
    expect(AI_BLOG_POST_TOOL.inputSchema['required']).toEqual(['title', 'excerpt', 'body', 'seoDescription'])
  })

  it('keeps the rules byte-identical and cached, with the site in the user turn', () => {
    expect(AI_BLOG_POST_INSTRUCTIONS).toHaveLength(1)
    expect(AI_BLOG_POST_INSTRUCTIONS[0].cacheBreakpoint).toBe(true)
    expect(AI_BLOG_POST_INSTRUCTIONS[0].text).not.toContain('pottery')
    expect(aiBlogPostPrompt({ brief: BRIEF, earlierTitles: ['One'], index: 2, total: 3 })).toBe(
      `Brief:\n${BRIEF}\nPosts already written: “One”\nWrite post 2 of 3.`,
    )
  })

  it('asks for one post body at the routing row’s ceiling', () => {
    expect(AI_BLOG_POST_MAX_TOKENS).toBe(2048)
    // The longest body the check keeps fits the ceiling with its fields beside it.
    expect(AI_BLOG_POST_LIMITS.bodyMax / 3).toBeLessThan(AI_BLOG_POST_MAX_TOKENS)
  })
})
