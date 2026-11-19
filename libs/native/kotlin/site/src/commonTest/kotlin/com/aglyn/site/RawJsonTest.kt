// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site

import com.aglyn.core.FirestoreTimestamp
import kotlin.test.Test
import kotlin.test.assertEquals

class RawJsonTest {
  @Test
  fun showsTheDocumentAsTheConsoleDoes() {
    val json = firestoreRawJson(
      "page-about",
      mapOf(
        "name" to "About", "visibility" to 2L, "preview" to true, "updatedAt" to FirestoreTimestamp(1_700_000_000, 500_000_000),
        "seo" to mapOf("title" to "About us", "path" to "/about"), "tags" to listOf("a", "b"), "removed" to null, "ratio" to 0.5,
      ),
    )
    assertEquals(
      """
      {
        "${'$'}id": "page-about",
        "name": "About",
        "preview": true,
        "ratio": 0.5,
        "removed": null,
        "seo": {
          "path": "/about",
          "title": "About us"
        },
        "tags": [
          "a",
          "b"
        ],
        "updatedAt": {
          "nanoseconds": 500000000,
          "seconds": 1700000000
        },
        "visibility": 2
      }
      """.trimIndent(),
      json,
    )
  }
}
