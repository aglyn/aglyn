package com.aglyn.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/*
 * A record's fields as a form, and as read-only rows: one description of a
 * field (its key, label, kind and choices) drives both, so an edit sheet and
 * the detail pane it edits never disagree about what a field is.
 *
 * Values travel as strings, the way a text field holds them: a date is
 * `yyyy-MM-dd`, a switch is `true` / `false`, a choice is its stored value,
 * a choice of several is its values joined with `,`. The plugin turns them
 * into its own stored shape.
 */

enum class FieldKind { TEXT, MULTILINE, EMAIL, PHONE, URL, NUMBER, MONEY, DATE, SELECT, MULTI_SELECT, TOGGLE }

data class FieldOption(val value: String, val label: String)

data class FieldSpec(
  val key: String,
  val label: String,
  val kind: FieldKind = FieldKind.TEXT,
  val required: Boolean = false,
  val options: List<FieldOption> = emptyList(),
  val help: String? = null,
  /** A select with no pick reads as this ("No owner"); null means it needs one. */
  val emptyLabel: String? = "None",
)

/** What a filled-in form says is wrong with it, by field key; empty when it can be saved. */
fun fieldProblems(specs: List<FieldSpec>, values: Map<String, String>): Map<String, String> = buildMap {
  for (spec in specs) {
    val value = values[spec.key].orEmpty().trim()
    when {
      spec.required && value.isEmpty() -> put(spec.key, "${spec.label} is required")
      value.isEmpty() -> Unit
      spec.kind == FieldKind.EMAIL && !Regex("""^[^\s@]+@[^\s@]+\.[^\s@]+$""").matches(value) -> put(spec.key, "Enter an email address")
      spec.kind == FieldKind.PHONE && !Regex("""^\+?[\d\s().-]{5,}$""").matches(value) -> put(spec.key, "Enter a phone number")
      spec.kind == FieldKind.URL && !Regex("""^(https?://)?[^\s.]+\.[^\s]+$""").matches(value) -> put(spec.key, "Enter a web address")
      spec.kind == FieldKind.NUMBER && value.toDoubleOrNull() == null -> put(spec.key, "Enter a number")
      spec.kind == FieldKind.MONEY && value.removePrefix("$").replace(",", "").toDoubleOrNull() == null -> put(spec.key, "Enter an amount")
      spec.kind == FieldKind.DATE && !Regex("""^\d{4}-\d{2}-\d{2}$""").matches(value) -> put(spec.key, "Pick a date")
    }
  }
}

/** How a stored value reads in a detail pane: a choice by its label, a switch as Yes/No. */
fun fieldDisplay(spec: FieldSpec, value: String?): String? {
  val raw = value?.trim().orEmpty()
  if (raw.isEmpty()) return null
  return when (spec.kind) {
    FieldKind.SELECT -> spec.options.firstOrNull { it.value == raw }?.label ?: raw
    FieldKind.MULTI_SELECT -> raw.split(',').map { it.trim() }.filter { it.isNotEmpty() }
      .joinToString(", ") { part -> spec.options.firstOrNull { it.value == part }?.label ?: part }
    FieldKind.TOGGLE -> if (raw == "true") "Yes" else "No"
    FieldKind.MONEY -> raw.removePrefix("$").toDoubleOrNull()?.let { "$" + formatAmount(it) } ?: raw
    else -> raw
  }
}

private fun formatAmount(value: Double): String {
  val cents = kotlin.math.round(value * 100).toLong()
  val whole = (cents / 100).toString().reversed().chunked(3).joinToString(",").reversed()
  val fraction = (kotlin.math.abs(cents) % 100).toString().padStart(2, '0')
  return if (fraction == "00") whole else "$whole.$fraction"
}

/** Every field of [specs] as one editable column. [errors] is shown under each field once it has been touched or saved. */
@Composable
fun FieldForm(
  specs: List<FieldSpec>,
  values: Map<String, String>,
  onChange: (key: String, value: String) -> Unit,
  modifier: Modifier = Modifier,
  errors: Map<String, String> = emptyMap(),
  enabled: Boolean = true,
) {
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    for (spec in specs) {
      FieldEditor(spec, values[spec.key].orEmpty(), { onChange(spec.key, it) }, error = errors[spec.key], enabled = enabled)
    }
  }
}

/** One field, editable, in the control its kind calls for. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FieldEditor(
  spec: FieldSpec,
  value: String,
  onChange: (String) -> Unit,
  modifier: Modifier = Modifier,
  error: String? = null,
  enabled: Boolean = true,
) {
  val label = if (spec.required) "${spec.label} *" else spec.label
  val tag = Modifier.testTag("field-${spec.key}")
  when (spec.kind) {
    FieldKind.TOGGLE -> SwitchRow(spec.label, value == "true", { onChange(it.toString()) }, modifier.then(tag), supporting = spec.help, enabled = enabled)
    FieldKind.SELECT, FieldKind.MULTI_SELECT -> ChoiceField(spec, label, value, onChange, modifier.then(tag), error, enabled)
    FieldKind.DATE -> DateField(spec, label, value, onChange, modifier.then(tag), error, enabled)
    else -> OutlinedTextField(
      value = value,
      onValueChange = onChange,
      modifier = modifier.fillMaxWidth().then(tag).then(if (spec.kind == FieldKind.MULTILINE) Modifier.heightIn(min = 120.dp) else Modifier),
      label = { Text(label) },
      enabled = enabled,
      singleLine = spec.kind != FieldKind.MULTILINE,
      minLines = if (spec.kind == FieldKind.MULTILINE) 3 else 1,
      isError = error != null,
      prefix = if (spec.kind == FieldKind.MONEY) ({ Text("$") }) else null,
      supportingText = (error ?: spec.help)?.let { { Text(it) } },
      keyboardOptions = KeyboardOptions(
        keyboardType = when (spec.kind) {
          FieldKind.EMAIL -> KeyboardType.Email
          FieldKind.PHONE -> KeyboardType.Phone
          FieldKind.URL -> KeyboardType.Uri
          FieldKind.NUMBER -> KeyboardType.Number
          FieldKind.MONEY -> KeyboardType.Decimal
          else -> KeyboardType.Text
        },
      ),
    )
  }
}


/** A read-only field that opens its choices in a menu; a multi-choice keeps the menu open and ticks each pick. */
@Composable
private fun ChoiceField(
  spec: FieldSpec,
  label: String,
  value: String,
  onChange: (String) -> Unit,
  modifier: Modifier,
  error: String?,
  enabled: Boolean,
) {
  var open by remember { mutableStateOf(false) }
  val multi = spec.kind == FieldKind.MULTI_SELECT
  val picked = if (multi) value.split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet() else setOf(value)
  Box(modifier.fillMaxWidth()) {
    OutlinedTextField(
      value = fieldDisplay(spec, value) ?: (spec.emptyLabel ?: ""),
      onValueChange = {},
      readOnly = true,
      enabled = enabled,
      label = { Text(label) },
      isError = error != null,
      supportingText = (error ?: spec.help)?.let { { Text(it) } },
      trailingIcon = { Icon(AglynIcons.named("expand_more"), contentDescription = null) },
      singleLine = true,
      modifier = Modifier.fillMaxWidth(),
    )
    // The field itself is read-only: a press anywhere on it opens the choices.
    Box(
      Modifier.matchParentSize()
        .clickable(enabled = enabled, interactionSource = remember { MutableInteractionSource() }, indication = null) { open = true }
        .semantics { contentDescription = "${spec.label}: ${fieldDisplay(spec, value) ?: spec.emptyLabel ?: "none"}" },
    )
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      if (!multi && spec.emptyLabel != null && !spec.required) {
        DropdownMenuItem(text = { Text(spec.emptyLabel) }, onClick = { onChange(""); open = false })
      }
      for (option in spec.options) {
        val on = option.value in picked
        DropdownMenuItem(
          text = { Text(option.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
          leadingIcon = if (multi || on) ({ if (on) Icon(AglynIcons.named("check"), null) }) else null,
          onClick = {
            if (multi) {
              onChange((if (on) picked - option.value else picked + option.value).joinToString(","))
            } else {
              onChange(option.value)
              open = false
            }
          },
          modifier = Modifier.testTag("option-${spec.key}-${option.value}"),
        )
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateField(
  spec: FieldSpec,
  label: String,
  value: String,
  onChange: (String) -> Unit,
  modifier: Modifier,
  error: String?,
  enabled: Boolean,
) {
  var open by remember { mutableStateOf(false) }
  Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    OutlinedTextField(
      value = value,
      onValueChange = onChange,
      enabled = enabled,
      label = { Text(label) },
      placeholder = { Text("YYYY-MM-DD") },
      isError = error != null,
      supportingText = (error ?: spec.help)?.let { { Text(it) } },
      singleLine = true,
      trailingIcon = {
        Row {
          if (value.isNotEmpty() && !spec.required) {
            IconButton(onClick = { onChange("") }, enabled = enabled) { Icon(AglynIcons.named("close"), contentDescription = "Clear ${spec.label}") }
          }
          IconButton(onClick = { open = true }, enabled = enabled) { Icon(AglynIcons.named("event"), contentDescription = "Pick ${spec.label}") }
        }
      },
      modifier = Modifier.weight(1f),
    )
  }
  if (open) {
    val state = rememberDatePickerState(initialSelectedDateMillis = isoDayMillis(value))
    DatePickerDialog(
      onDismissRequest = { open = false },
      confirmButton = {
        TextButton(onClick = {
          state.selectedDateMillis?.let { onChange(isoDayOf(it)) }
          open = false
        }) { Text("Done") }
      },
      dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
    ) { DatePicker(state) }
  }
}

/** `yyyy-MM-dd` as UTC midnight in epoch ms (the date picker's own day), or null. */
fun isoDayMillis(day: String): Long? {
  val match = Regex("""^(\d{4})-(\d{2})-(\d{2})$""").matchEntire(day.trim()) ?: return null
  val (y, m, d) = match.destructured
  return daysFromCivil(y.toInt(), m.toInt(), d.toInt()) * 86_400_000L
}

/** A UTC epoch-ms instant as its `yyyy-MM-dd` day. */
fun isoDayOf(millis: Long): String {
  val days = millis.floorDiv(86_400_000L)
  val (y, m, d) = civilFromDays(days)
  return "${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}"
}

// Howard Hinnant's civil-day algorithms: proleptic Gregorian, no time zone.
private fun daysFromCivil(year: Int, month: Int, day: Int): Long {
  val y = (if (month <= 2) year - 1 else year).toLong()
  val era = y.floorDiv(400L)
  val yoe = y - era * 400
  val mp = (month + 9) % 12
  val doy = (153 * mp + 2) / 5 + day - 1
  val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
  return era * 146097 + doe - 719468
}

private fun civilFromDays(days: Long): Triple<Int, Int, Int> {
  val z = days + 719468
  val era = z.floorDiv(146097L)
  val doe = z - era * 146097
  val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
  val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  val mp = (5 * doy + 2) / 153
  val d = (doy - (153 * mp + 2) / 5 + 1).toInt()
  val m = (if (mp < 10) mp + 3 else mp - 9).toInt()
  val y = (yoe + era * 400 + if (m <= 2) 1 else 0).toInt()
  return Triple(y, m, d)
}

/** One read-only property: its label above or beside its value. Absent values read as an em dash. */
@Composable
fun PropertyRow(label: String, value: String?, modifier: Modifier = Modifier, trailing: (@Composable () -> Unit)? = null) {
  Row(
    modifier.fillMaxWidth().padding(vertical = space(0.5f)).semantics(mergeDescendants = true) {},
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(1.5f)),
  ) {
    Column(Modifier.weight(1f)) {
      Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Text(value?.takeIf { it.isNotBlank() } ?: "—", style = MaterialTheme.typography.bodyLarge)
    }
    trailing?.invoke()
  }
}

/** Every field of [specs] as read-only rows, in order, from [values]. */
@Composable
fun PropertyList(specs: List<FieldSpec>, values: Map<String, String>, modifier: Modifier = Modifier) {
  Column(modifier.fillMaxWidth()) {
    for (spec in specs) PropertyRow(spec.label, fieldDisplay(spec, values[spec.key]), Modifier.testTag("property-${spec.key}"))
  }
}
