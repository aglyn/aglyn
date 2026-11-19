package com.aglyn.screens

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.ui.space
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * A SET OF FIELDS ASKED AGAIN FOR EACH ONE OF SEVERAL (`kind: "group"`): the minors a parent signs for, each with a name
 * and a date of birth, as the console's waiver forms ask (AGL-4042). `fields` are the set's own text-like fields (text,
 * email, a date); `min` sets start on the form (one, where the console starts with one), `max` caps them (a waiver's 10
 * minors), `itemLabel` heads each set (a template, `item.n` its number from 1), `addLabel` adds one and `removeLabel`
 * removes one while more than `min` are left. Its value is the list of sets, each `{ key: value }`, as the console sends
 * them: what was typed, trimmed, and "" for a field left empty.
 */
internal object FieldGroups {
  /** The sets as typed, kept as JSON text while they are edited. */
  fun items(value: String): List<Map<String, String>> {
    val parsed = runCatching { Json.parseToJsonElement(value) as? JsonArray }.getOrNull() ?: return emptyList()
    return parsed.map { set -> (set as? JsonObject)?.mapValues { (_, typed) -> ScreenValues.text(typed) } ?: emptyMap() }
  }

  fun encode(items: List<Map<String, String>>): String =
    JsonArray(items.map { set -> JsonObject(set.mapValues { JsonPrimitive(it.value) }) }).toString()

  /** What the field starts with: the list its `initial` names, else `min` empty sets. */
  fun initial(field: FieldSpec, resolved: JsonElement): String {
    if (resolved is JsonArray) return encode(resolved.map { set -> (set as? JsonObject)?.mapValues { ScreenValues.text(it.value) } ?: emptyMap() })
    return encode(List((field.min ?: 0.0).toInt().coerceAtLeast(0)) { emptyMap() })
  }

  /** The sets' own fields. */
  fun fields(field: FieldSpec, context: JsonElement): List<FieldSpec> = FieldSpec.parseAll(field.config.arr("fields"), context)

  /** What the form sends: every set with each of its fields as that field sends it, "" for one left empty. */
  fun json(field: FieldSpec, value: String, context: JsonElement): JsonElement {
    val fields = fields(field, context)
    return JsonArray(
      items(value).map { set ->
        JsonObject(fields.associate { sub -> sub.key to fieldJson(sub, FieldValue.Text(set[sub.key].orEmpty())).let { if (it == JsonNull) JsonPrimitive("") else it } })
      },
    )
  }
}

@Composable
internal fun GroupFieldInput(field: FieldSpec, context: JsonElement, label: String, value: String, onChange: (String) -> Unit) {
  val items = remember(value) { FieldGroups.items(value) }
  val fields = FieldGroups.fields(field, context)
  val low = (field.min ?: 0.0).toInt()
  val high = (field.max ?: 50.0).toInt()
  val itemLabel = field.config.str("itemLabel")
  val colors = MaterialTheme.colorScheme
  val shape = MaterialTheme.shapes.small
  Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    if (label.isNotEmpty()) Text(label, style = MaterialTheme.typography.titleSmall)
    items.forEachIndexed { index, set ->
      val scope = ScreenContext.withItem(context, JsonObject(mapOf("n" to JsonPrimitive(index + 1))))
      Column(
        Modifier.fillMaxWidth().border(1.dp, colors.outlineVariant, shape).padding(space(2f)).testTag("group-${field.key}-$index"),
        verticalArrangement = Arrangement.spacedBy(space(1f)),
      ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
          Text(itemLabel?.let { ScreenValues.render(it, scope) }.orEmpty(), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
          if (items.size > low) {
            TextButton(
              onClick = { onChange(FieldGroups.encode(items.filterIndexed { at, _ -> at != index })) },
              modifier = Modifier.testTag("group-remove-${field.key}-$index"),
            ) { Text(field.config.str("removeLabel")?.let { ScreenValues.render(it, scope) } ?: "Remove") }
          }
        }
        for (sub in fields) {
          FieldInput(sub, scope, FieldValue.Text(set[sub.key].orEmpty())) { changed ->
            val typed = when (changed) {
              is FieldValue.Text -> changed.value
              is FieldValue.File -> changed.text
              is FieldValue.Flag -> changed.value.toString()
            }
            onChange(FieldGroups.encode(items.mapIndexed { at, one -> if (at == index) one + (sub.key to typed) else one }))
          }
        }
      }
    }
    if (items.size < high) {
      TextButton(onClick = { onChange(FieldGroups.encode(items + listOf(emptyMap()))) }, modifier = Modifier.testTag("group-add-${field.key}")) {
        Text(field.config.str("addLabel")?.let { ScreenValues.render(it, context) } ?: "Add")
      }
    }
  }
}
