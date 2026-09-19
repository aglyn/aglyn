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

import { EMPTY_PAYLOAD_SHA256, encodeRfc3986, signSigV4 } from './sigv4'

/**
 * SigV4 against the worked examples in the S3 documentation ("Signature
 * Calculations for the Authorization Header: Transferring Payload in a Single
 * Chunk"): their example credentials, clock and requests, and the signatures
 * the documentation prints. A signer that agrees with both is computing the
 * canonical request, the string to sign and the derived key as S3 does.
 */

const DOCUMENTATION_CREDENTIALS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}
const DOCUMENTATION_CLOCK = new Date('2013-05-24T00:00:00Z')

describe('SigV4 (AGL-2824)', () => {
  it('matches the documented GET Object signature, with a signed Range header', async () => {
    const headers = await signSigV4(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
        headers: { range: 'bytes=0-9' },
        payloadHash: EMPTY_PAYLOAD_SHA256,
        region: 'us-east-1',
        service: 's3',
        now: DOCUMENTATION_CLOCK,
      },
      DOCUMENTATION_CREDENTIALS,
    )
    expect(headers).toEqual({
      authorization:
        'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
      'x-amz-date': '20130524T000000Z',
      'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256,
    })
  })

  it('matches the documented list signature, with its query canonicalized', async () => {
    const headers = await signSigV4(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J'),
        payloadHash: EMPTY_PAYLOAD_SHA256,
        region: 'us-east-1',
        service: 's3',
        now: DOCUMENTATION_CLOCK,
      },
      DOCUMENTATION_CREDENTIALS,
    )
    expect(headers['authorization']).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
        'Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7',
    )
  })

  it('signs the same request the same way whatever order its query was written in', async () => {
    const sign = (url: string) =>
      signSigV4(
        {
          method: 'GET',
          url: new URL(url),
          payloadHash: EMPTY_PAYLOAD_SHA256,
          region: 'us-east-1',
          service: 's3',
          now: DOCUMENTATION_CLOCK,
        },
        DOCUMENTATION_CREDENTIALS,
      )
    expect(await sign('https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2')).toEqual(
      await sign('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J'),
    )
  })

  it('encodes strictly, including the characters encodeURIComponent leaves', () => {
    expect(encodeRfc3986("a b/c!'()*~._-")).toBe('a%20b%2Fc%21%27%28%29%2A~._-')
  })
})
