package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import com.aglyn.contracts.ModifierSelection
import com.aglyn.contracts.ProductModifierGroup

/**
 * One write-in at the register or the kiosk (the gear set builder), as the console's `ProductWriteInField`: a text field
 * named after the group, with the merchant's note, what a filled answer adds and a count of characters under it, or
 * what is wrong with what was typed. Digits only opens the number pad; the field stops at the group's length.
 */
@Composable
internal fun WriteInField(
  group: ProductModifierGroup,
  groups: List<ProductModifierGroup>,
  variantId: String?,
  picks: List<ModifierSelection>,
  money: (Long) -> String,
  tag: String,
  onChange: (List<ModifierSelection>) -> Unit,
) {
  val option = group.options.firstOrNull()
  val text = writeInAnswer(picks, group)
  val limit = group.writeInMaxLength()
  val problem = writeInProblem(group, text)
  val cents = option?.let { modifierOptionPriceCents(it, variantId) } ?: 0L
  val hint = listOfNotNull(
    option?.note?.takeIf { it.isNotBlank() },
    if (cents > 0) "Adds ${money(cents)}" else null,
    "${writeInLength(text)}/$limit",
  ).joinToString(" · ")
  OutlinedTextField(
    value = text,
    onValueChange = { onChange(withWriteInAnswer(groups, picks, group, writeInInput(it, limit))) },
    label = { Text(if (group.required()) "${group.name} *" else group.name) },
    singleLine = true,
    isError = problem != null,
    supportingText = { Text(problem ?: hint) },
    keyboardOptions = KeyboardOptions(keyboardType = if (group.digitsOnly == true) KeyboardType.Number else KeyboardType.Text, imeAction = ImeAction.Next),
    modifier = Modifier.fillMaxWidth().testTag(tag),
  )
}
