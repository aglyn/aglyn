// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site.pages

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.zIndex
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.jsonBody
import com.aglyn.ui.PersonAvatar
import com.aglyn.ui.workspaceInitials
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Who else is in a document right now (the console's `usePresenceSummary` and `DocumentPresenceChips`, AGL-2486):
// `POST /api/presence/summary {hostId}` answers who is in each of a site's documents, rolled up across versions, and a
// row shows their faces beside its name so a reader sees who is already in a page before opening it in the Besigner.
// A snapshot read every 30 seconds while the list is on screen, never a subscription per row. It fails to nothing: a
// refusal or an error is an empty summary, because this decorates a list and must never make one look broken. The
// Apple kit's DocumentPresence.swift.

/** One person in a document: the smallest useful identity (`PresentPerson`). */
data class PresentPerson(val uid: String, val displayName: String, val photoUrl: String? = null)

/** `{ docType: { docId: [person] } }`. */
data class PresenceSummary(val byType: Map<String, Map<String, List<PresentPerson>>> = emptyMap()) {
  /** Who is in one document, across its versions; empty when nobody is. */
  fun people(docType: String, docId: String): List<PresentPerson> = byType[docType]?.get(docId).orEmpty()

  companion object {
    fun from(json: Any?): PresenceSummary {
      val types = json as? JsonObject ?: return PresenceSummary()
      val byType = types.mapNotNull { (type, docs) ->
        val byDoc = (docs as? JsonObject)?.mapNotNull { (doc, people) ->
          val found = (people as? JsonArray)?.mapNotNull { person ->
            val obj = person as? JsonObject ?: return@mapNotNull null
            val uid = obj.str("uid") ?: return@mapNotNull null
            val name = obj.str("displayName")?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            PresentPerson(uid, name, obj.str("photoURL"))
          }.orEmpty()
          if (found.isEmpty()) null else doc to found
        }?.toMap().orEmpty()
        if (byDoc.isEmpty()) null else type to byDoc
      }.toMap()
      return PresenceSummary(byType)
    }
  }
}

private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

/** How often a visible list asks again (`PRESENCE_SUMMARY_POLL_MS`). */
const val PRESENCE_SUMMARY_POLL_MS = 30_000L

/** The summary for a site, or an empty one for any refusal or failure. */
suspend fun fetchPresenceSummary(api: ConsoleApiClient, hostId: String): PresenceSummary = try {
  PresenceSummary.from((api.request("/api/presence/summary", ApiMethod.POST, jsonBody("hostId" to hostId)) as? JsonObject)?.get("summary"))
} catch (error: CancellationException) {
  throw error
} catch (error: Exception) {
  PresenceSummary()
}

/**
 * What the chips say (`presenceChipTooltip`, the document scope): hedged, because the roll-up cannot say WHICH version,
 * and a row that implied "the one you are about to open" would mislead.
 */
fun presenceChipSentence(names: List<String>): String {
  val last = names.lastOrNull() ?: return ""
  val who = if (names.size == 1) "$last is" else "${names.dropLast(1).joinToString(", ")} and $last are"
  return "$who in this document right now — possibly in a different version."
}

private const val MAX_PRESENCE_CHIPS = 3

/** The faces of who is in a document, overlapped, at most three and "+N" past that (`DocumentPresenceChips`). */
@Composable
fun DocumentPresenceChips(people: List<PresentPerson>, size: Dp = 20.dp) {
  if (people.isEmpty()) return
  val shown = people.take(MAX_PRESENCE_CHIPS)
  val sentence = presenceChipSentence(people.map { it.displayName })
  Row(
    Modifier.testTag("document-presence").clearAndSetSemantics { contentDescription = sentence },
    verticalAlignment = Alignment.CenterVertically,
  ) {
    // Overlapped like the console's stack: each face a quarter under the one before it, the earlier on top.
    shown.forEachIndexed { index, person ->
      PersonAvatar(
        workspaceInitials(person.displayName),
        person.photoUrl,
        size,
        Modifier.offset(x = -(size / 4) * index).zIndex((shown.size - index).toFloat()).border(1.5.dp, MaterialTheme.colorScheme.surface, CircleShape),
      )
    }
    if (people.size > shown.size) {
      Text(
        "+${people.size - shown.size}",
        Modifier.offset(x = -(size / 4) * (shown.size - 1)).padding(start = 4.dp),
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}
