package com.aglyn.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

/*
 * The form inputs a settings page or a record editor is built from, beyond
 * a plain text field: a pick from a list, a color, a date (and time), and a
 * list of short words. Every one is a labelled Material 3 field that reads
 * as one control to a screen reader.
 */

/** One choice of a [SelectField]: what is stored, what is read, an optional second line, and an optional greyed-out state. */
data class SelectOption(val value: String, val label: String, val supporting: String? = null, val enabled: Boolean = true)

/**
 * One value from a fixed list, as the console's select menus pick it. A
 * [noneLabel] adds a first row that picks nothing (null).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SelectField(
  label: String,
  options: List<SelectOption>,
  selected: String?,
  onSelect: (String?) -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  noneLabel: String? = null,
  supporting: String? = null,
  isError: Boolean = false,
) {
  var open by remember { mutableStateOf(false) }
  val current = options.firstOrNull { it.value == selected }
  ExposedDropdownMenuBox(expanded = open && enabled, onExpandedChange = { if (enabled) open = it }, modifier = modifier) {
    OutlinedTextField(
      value = current?.label ?: selected?.takeIf { it.isNotEmpty() } ?: noneLabel.orEmpty(),
      onValueChange = {},
      readOnly = true,
      enabled = enabled,
      label = { Text(label) },
      supportingText = supporting?.let { { Text(it) } },
      isError = isError,
      trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
      singleLine = true,
      modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled),
    )
    ExposedDropdownMenu(expanded = open && enabled, onDismissRequest = { open = false }) {
      if (noneLabel != null) {
        DropdownMenuItem(text = { Text(noneLabel) }, onClick = { open = false; onSelect(null) }, modifier = Modifier.testTag("select-none"))
      }
      for (option in options) {
        DropdownMenuItem(
          text = {
            Column {
              Text(option.label)
              option.supporting?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
          },
          enabled = option.enabled,
          onClick = { open = false; onSelect(option.value) },
          modifier = Modifier.testTag("select-${option.value}"),
        )
      }
    }
  }
}

/** `#RRGGBB` (or `#RGB`, `#RRGGBBAA`) as a color; null when it is not one. */
fun parseHexColor(hex: String): Color? {
  val digits = hex.trim().removePrefix("#")
  val full = when (digits.length) {
    3 -> digits.map { "$it$it" }.joinToString("") + "ff"
    6 -> digits + "ff"
    8 -> digits
    else -> return null
  }
  val value = full.toLongOrNull(16) ?: return null
  val r = (value shr 24) and 0xff
  val g = (value shr 16) and 0xff
  val b = (value shr 8) and 0xff
  val a = value and 0xff
  return Color(r.toInt(), g.toInt(), b.toInt(), a.toInt())
}

/** A color typed as hex, with its swatch beside it. The field says when the words are not a color. */
@Composable
fun ColorField(label: String, value: String, onValue: (String) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, supporting: String? = null) {
  val color = parseHexColor(value)
  val invalid = value.isNotBlank() && color == null
  OutlinedTextField(
    value = value,
    onValueChange = { onValue(it.trim().take(9)) },
    enabled = enabled,
    label = { Text(label) },
    singleLine = true,
    isError = invalid,
    supportingText = (if (invalid) "Use a hex color such as #1A73E8" else supporting)?.let { { Text(it) } },
    leadingIcon = {
      Box(
        Modifier.size(24.dp)
          .semantics { contentDescription = if (color != null) "Swatch of $value" else "No color" }
          .background(color ?: Color.Transparent, RoundedCornerShape(6.dp))
          .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(6.dp)),
      )
    },
    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
    modifier = modifier.fillMaxWidth(),
  )
}

private fun two(n: Int) = n.toString().padStart(2, '0')

/** A UTC instant as `2026-10-07` (and ` 14:05` when [withTime]), in the zone [offsetMinutes] from UTC. */
fun formatDateTime(epochMillis: Long, withTime: Boolean, offsetMinutes: Int = 0): String {
  val local = epochMillis + offsetMinutes * 60_000L
  val days = (local).floorDiv(86_400_000L)
  val minutesOfDay = ((local).mod(86_400_000L) / 60_000L).toInt()
  // Civil date from days since the epoch (Howard Hinnant's algorithm).
  val z = days + 719_468
  val era = (z).floorDiv(146_097L)
  val doe = z - era * 146_097
  val yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
  val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  val mp = (5 * doy + 2) / 153
  val day = (doy - (153 * mp + 2) / 5 + 1).toInt()
  val month = (if (mp < 10) mp + 3 else mp - 9).toInt()
  val year = (yoe + era * 400 + if (month <= 2) 1 else 0).toInt()
  val date = "$year-${two(month)}-${two(day)}"
  return if (withTime) "$date ${two(minutesOfDay / 60)}:${two(minutesOfDay % 60)}" else date
}

/**
 * A date (and, with [withTime], a time of day) picked from the platform's
 * calendar and clock dialogs. [value] and the answer are epoch milliseconds;
 * the picked day and time are read in the zone [offsetMinutes] from UTC.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateTimeField(
  label: String,
  value: Long?,
  onValue: (Long?) -> Unit,
  modifier: Modifier = Modifier,
  withTime: Boolean = false,
  enabled: Boolean = true,
  offsetMinutes: Int = 0,
  supporting: String? = null,
) {
  var picking by remember { mutableStateOf(false) }
  var pickedDay by remember { mutableStateOf<Long?>(null) }
  OutlinedTextField(
    value = value?.let { formatDateTime(it, withTime, offsetMinutes) }.orEmpty(),
    onValueChange = {},
    readOnly = true,
    enabled = enabled,
    label = { Text(label) },
    supportingText = supporting?.let { { Text(it) } },
    singleLine = true,
    trailingIcon = {
      androidx.compose.foundation.layout.Row {
        if (value != null && enabled) IconButton(onClick = { onValue(null) }) { Icon(AglynIcons.named("close"), contentDescription = "Clear $label") }
        IconButton(onClick = { picking = true }, enabled = enabled, modifier = Modifier.testTag("date-pick")) { Icon(AglynIcons.named("event"), contentDescription = "Pick $label") }
      }
    },
    modifier = modifier.fillMaxWidth(),
  )
  if (picking) {
    val state = rememberDatePickerState(initialSelectedDateMillis = value?.let { it + offsetMinutes * 60_000L }?.let { it - (it).mod(86_400_000L) })
    DatePickerDialog(
      onDismissRequest = { picking = false },
      confirmButton = {
        TextButton(onClick = {
          picking = false
          val day = state.selectedDateMillis ?: return@TextButton
          if (withTime) pickedDay = day else onValue(day - offsetMinutes * 60_000L)
        }) { Text("OK") }
      },
      dismissButton = { TextButton(onClick = { picking = false }) { Text("Cancel") } },
    ) { DatePicker(state) }
  }
  pickedDay?.let { day ->
    val minutes = value?.let { ((it + offsetMinutes * 60_000L).mod(86_400_000L) / 60_000L).toInt() } ?: (9 * 60)
    val time = rememberTimePickerState(initialHour = minutes / 60, initialMinute = minutes % 60)
    AlertDialog(
      onDismissRequest = { pickedDay = null },
      title = { Text("Pick a time") },
      text = { TimePicker(time) },
      confirmButton = {
        TextButton(onClick = {
          pickedDay = null
          onValue(day + (time.hour * 60 + time.minute) * 60_000L - offsetMinutes * 60_000L)
        }) { Text("OK") }
      },
      dismissButton = { TextButton(onClick = { pickedDay = null }) { Text("Cancel") } },
    )
  }
}

/**
 * Short words as chips (tags, keywords): type one and press enter to add it,
 * the chip's close button removes it. At most [max] words of [maxLength]
 * characters, repeats ignored.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChipsField(
  label: String,
  values: List<String>,
  onValues: (List<String>) -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  max: Int = 50,
  maxLength: Int = 100,
) {
  var draft by remember { mutableStateOf("") }
  fun commit() {
    val word = draft.trim().take(maxLength)
    if (word.isNotEmpty() && word !in values && values.size < max) onValues(values + word)
    draft = ""
  }
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    OutlinedTextField(
      value = draft,
      onValueChange = { next -> if (next.endsWith(",")) { draft = next.dropLast(1); commit() } else draft = next },
      enabled = enabled && values.size < max,
      label = { Text(label) },
      singleLine = true,
      supportingText = { Text("Press enter to add · ${values.size}/$max") },
      keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
      keyboardActions = KeyboardActions(onDone = { commit() }),
      trailingIcon = {
        if (draft.isNotBlank()) IconButton(onClick = { commit() }) { Icon(AglynIcons.named("add"), contentDescription = "Add $draft") }
      },
      modifier = Modifier.fillMaxWidth().testTag("chips-input"),
    )
    if (values.isNotEmpty()) {
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        for (word in values) {
          InputChip(
            selected = false,
            onClick = {},
            enabled = enabled,
            label = { Text(word) },
            trailingIcon = {
              IconButton(onClick = { onValues(values - word) }, enabled = enabled, modifier = Modifier.size(InputChipDefaults.IconSize + 8.dp)) {
                Icon(AglynIcons.named("close"), contentDescription = "Remove $word", Modifier.size(InputChipDefaults.IconSize))
              }
            },
          )
        }
      }
    }
  }
}

/**
 * A text field with its limit: the count under it, the input stopped at
 * [max], and [error] in place of the count when there is one. [multiline]
 * grows to [minLines] and beyond.
 */
@Composable
fun CountedTextField(
  label: String,
  value: String,
  onValue: (String) -> Unit,
  modifier: Modifier = Modifier,
  max: Int? = null,
  required: Boolean = false,
  multiline: Boolean = false,
  minLines: Int = 3,
  enabled: Boolean = true,
  error: String? = null,
  supporting: String? = null,
  placeholder: String? = null,
  keyboardType: KeyboardType = KeyboardType.Text,
) {
  val missing = required && value.isBlank()
  val shown = error ?: if (missing) "Required" else null
  OutlinedTextField(
    value = value,
    onValueChange = { next -> onValue(if (max != null) next.take(max) else next) },
    enabled = enabled,
    label = { Text(if (required) "$label *" else label) },
    placeholder = placeholder?.let { { Text(it) } },
    singleLine = !multiline,
    minLines = if (multiline) minLines else 1,
    isError = shown != null,
    supportingText = {
      androidx.compose.foundation.layout.Row {
        Text(shown ?: supporting.orEmpty(), Modifier.weight(1f))
        if (max != null) Text("${value.length}/$max")
      }
    },
    keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = if (multiline) ImeAction.Default else ImeAction.Next),
    modifier = modifier.fillMaxWidth(),
  )
}

/**
 * A settings card that saves as one: its fields, then Save (and Discard)
 * once something changed. [busy] holds the buttons, [error] says why the
 * last save failed, and [notice] what the last one did.
 */
@Composable
fun FormCard(
  title: String,
  dirty: Boolean,
  onSave: () -> Unit,
  onDiscard: () -> Unit,
  modifier: Modifier = Modifier,
  description: String? = null,
  busy: Boolean = false,
  error: String? = null,
  notice: String? = null,
  canSave: Boolean = true,
  saveLabel: String = "Save",
  content: @Composable () -> Unit,
) {
  SectionCard(title, modifier) {
    if (description != null) Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    content()
    if (error != null) NoticeBanner(error, StatusTone.ERROR)
    if (notice != null && !dirty) NoticeBanner(notice, StatusTone.SUCCESS)
    androidx.compose.foundation.layout.Row(
      Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(space(1f), androidx.compose.ui.Alignment.End),
    ) {
      if (dirty) TextButton(onClick = onDiscard, enabled = !busy, modifier = Modifier.testTag("form-discard")) { Text("Discard") }
      androidx.compose.material3.Button(onClick = onSave, enabled = dirty && canSave && !busy, modifier = Modifier.testTag("form-save")) {
        if (busy) androidx.compose.material3.CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        else Text(saveLabel)
      }
    }
  }
}
