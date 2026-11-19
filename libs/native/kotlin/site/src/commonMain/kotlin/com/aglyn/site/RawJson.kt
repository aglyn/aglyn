// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.Live
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.space
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// The stored document as JSON (the console's "Raw JSON" card on a page's view and an entry, AGL-2486): every field it
// holds, exactly as saved — the names a template page's entry tokens read from. Closed until asked for, and the document
// is not even read until then on a page. Read-only. The Apple kit's RawJSON.swift.

private val rawJsonFormat = Json { prettyPrint = true; prettyPrintIndent = "  " }

/**
 * A document as the console's `JSON.stringify(doc, null, 2)` shows it: `$id` beside its fields, a timestamp as
 * `{seconds, nanoseconds}` (Firestore's own `toJSON`), keys in a stable order.
 */
fun firestoreRawJson(id: String, data: Map<String, Any?>): String =
  rawJsonFormat.encodeToString(JsonElement.serializer(), rawJsonValue(data + ("\$id" to id)))

private fun rawJsonValue(value: Any?): JsonElement = when (value) {
  null -> JsonNull
  is JsonElement -> value
  is String -> JsonPrimitive(value)
  is Boolean -> JsonPrimitive(value)
  is Int, is Long, is Short, is Byte -> JsonPrimitive(value as Number)
  is Number -> value.toDouble().let { if (it.isFinite()) JsonPrimitive(if (it == kotlin.math.floor(it) && kotlin.math.abs(it) < 9e15) it.toLong() else it) else JsonNull }
  is FirestoreTimestamp -> JsonObject(sortedMapOf("nanoseconds" to JsonPrimitive(value.nanos), "seconds" to JsonPrimitive(value.seconds)))
  is Map<*, *> -> JsonObject(value.entries.associate { (k, v) -> k.toString() to rawJsonValue(v) }.toSortedMap())
  is List<*> -> JsonArray(value.map(::rawJsonValue))
  else -> JsonPrimitive(value.toString())
}

/** "Raw JSON", closed until opened: the document pretty-printed, scrolling past 360 dp. [json] is null while it is read. */
@Composable
fun RawJsonCard(json: String?, open: Boolean, onToggle: () -> Unit) {
  Column(Modifier.fillMaxWidth()) {
    Row(
      Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onToggle)
        .semantics { contentDescription = if (open) "Hide raw JSON" else "Show raw JSON" }
        .padding(vertical = space(1f)).testTag("raw-json-toggle"),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text("Raw JSON", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
      Icon(AglynIcons.named(if (open) "expand_less" else "expand_more"), contentDescription = null)
    }
    if (open) {
      if (json == null) {
        SkeletonList(rows = 2)
      } else {
        SelectionContainer {
          Text(
            json,
            Modifier.fillMaxWidth().heightIn(max = 360.dp).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).testTag("raw-json"),
            fontFamily = FontFamily.Monospace,
            fontSize = 12.sp,
          )
        }
      }
    }
  }
}

/** A page's "Raw JSON": the screen document at [path] is read only while the card is open. */
@Composable
fun LiveRawJsonCard(reader: FirestoreReader, path: String) {
  var open by remember(path) { mutableStateOf(false) }
  val live by remember(path, open, reader) { if (open) reader.observeDoc(path) else emptyFlow() }.collectAsState(Live.Loading)
  val json = (live as? Live.Ready)?.value?.let { firestoreRawJson(it.id, it.data) }
  RawJsonCard(json, open) { open = !open }
}
