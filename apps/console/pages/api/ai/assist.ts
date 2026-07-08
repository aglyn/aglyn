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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

const MODEL = 'claude-sonnet-5'

/**
 * AI assist (AGL-89): rewrites/generates copy for a besigner element via
 * the Anthropic Messages API. Env-gated on ANTHROPIC_API_KEY (501 without,
 * same degrade pattern as Stripe); auth via Firebase ID token.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res
      .status(501)
      .json({ error: 'AI assist is not configured (ANTHROPIC_API_KEY).' })
  }

  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  const text = String(req.body?.text ?? '').slice(0, 12000)
  const instruction = String(req.body?.instruction ?? '').slice(0, 500)
  // Modes (AGL-130): 'element' rewrites short copy; 'blog' writes or
  // improves markdown-lite entry bodies with title/excerpt context.
  const mode = req.body?.mode === 'blog' ? 'blog' : 'element'
  const title = String(req.body?.title ?? '').slice(0, 200)
  const excerpt = String(req.body?.excerpt ?? '').slice(0, 500)
  if (!instruction) {
    return res.status(400).json({ error: 'Missing instruction' })
  }

  try {
    await firebaseAdmin.app().auth().verifyIdToken(idToken)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: mode === 'blog' ? 2048 : 1024,
        system:
          mode === 'blog'
            ? 'You write blog posts inside a site builder. Reply with ONLY ' +
              'the post body in markdown-lite: **bold**, *italic*, ## ' +
              'headings, - lists, [links](https://url). No front matter, ' +
              'title line, or preamble — the title renders separately.'
            : 'You write website copy inside a site builder. Reply with ' +
              'ONLY the final text for the element — no quotes, preamble, ' +
              'or markdown. Keep roughly the same length and role as the ' +
              'current text unless the instruction says otherwise.',
        messages: [
          {
            role: 'user',
            content:
              mode === 'blog'
                ? [
                    title && `Title: ${title}`,
                    excerpt && `Excerpt: ${excerpt}`,
                    text && `Current body:\n${text}`,
                    `Instruction: ${instruction}`,
                  ]
                    .filter(Boolean)
                    .join('\n\n')
                : text
                  ? `Current element text:\n${text}\n\nInstruction: ${instruction}`
                  : `Write website element text. Instruction: ${instruction}`,
          },
        ],
      }),
    })
    const payload = await response.json()
    if (!response.ok) {
      console.error(payload)
      return res
        .status(502)
        .json({ error: payload?.error?.message ?? 'AI request failed' })
    }
    const output = (payload?.content ?? [])
      .filter((block: any) => block?.type === 'text')
      .map((block: any) => block.text)
      .join('')
      .trim()
    if (!output) return res.status(502).json({ error: 'Empty AI response' })
    return res.status(200).json({ text: output })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Assist failed' })
  }
}
