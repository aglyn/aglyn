package com.aglyn.plugins.commerce.products

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.plugins.commerce.pos.POS_MAX_MODIFIER_GROUPS
import com.aglyn.plugins.commerce.pos.POS_MAX_MODIFIER_OPTIONS
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.site.media.MediaChooserDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.space

/**
 * The product editor's Add-ons (AGL-4100), as the console's editor has them: groups of choices added to the item that
 * need no stock of their own, each free or adding to the price, priced by size where the product has sizes, and shown
 * on the website or kept to the register.
 */
@Composable
internal fun AddOnsFields(context: NativePluginContext, draft: ProductDraft, change: (ProductDraft) -> Unit) {
  fun setGroups(groups: List<AddOnGroupDraft>) = change(draft.copy(addOns = groups))
  fun setGroup(index: Int, group: AddOnGroupDraft) = setGroups(draft.addOns.toMutableList().also { it[index] = group })
  Text("Add-ons", style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
  Text(
    "Add-ons are choices added to the item that don’t need their own stock, such as walls or printing on a canopy, or a milk in a latte. " +
      "Each can be free or add to the price, and can cost more on a larger size. Show a group on the website to offer it on the product’s page; " +
      "the register offers every group.",
    style = MaterialTheme.typography.bodySmall,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
  )
  draft.addOns.forEachIndexed { groupIndex, group ->
    OutlinedCard(Modifier.fillMaxWidth().testTag("addon-group-$groupIndex")) {
      Column(Modifier.padding(space(1.5f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedTextField(
          group.name, { setGroup(groupIndex, group.copy(name = it)) }, label = { Text("Group name") }, placeholder = { Text("Walls") },
          singleLine = true, modifier = Modifier.fillMaxWidth().testTag("addon-group-name-$groupIndex"),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          CountField("At least", group.min, 0, group.choices.size, if (group.required) "Required" else "Optional", Modifier.weight(1f)) {
            setGroup(groupIndex, group.copy(min = it))
          }
          CountField("At most", group.max, 1, maxOf(1, group.choices.size), null, Modifier.weight(1f)) { setGroup(groupIndex, group.copy(max = it)) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f)) {
            Text("Show on the website")
            Text(
              if (group.online == true) "Offered on the product’s page and at the register." else "Offered at the register only.",
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
          Switch(group.online == true, { setGroup(groupIndex, group.copy(online = it)) }, Modifier.testTag("addon-group-online-$groupIndex"))
        }
        group.choices.forEachIndexed { choiceIndex, choice ->
          ChoiceFields(context, draft, choice, "$groupIndex-$choiceIndex", { setGroup(groupIndex, group.copy(choices = group.choices.toMutableList().also { list -> list[choiceIndex] = it })) }) {
            setGroup(groupIndex, group.withChoiceRemoved(choiceIndex))
          }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          TextButton(
            onClick = { setGroup(groupIndex, group.withChoiceAdded()) },
            enabled = group.choices.size < POS_MAX_MODIFIER_OPTIONS,
            modifier = Modifier.testTag("addon-choice-add-$groupIndex"),
          ) { Text("Add choice") }
          TextButton(onClick = { setGroups(draft.addOns.filterIndexed { at, _ -> at != groupIndex }) }) {
            Text("Remove group", color = MaterialTheme.colorScheme.error)
          }
        }
      }
    }
  }
  OutlinedButton(
    onClick = { setGroups(draft.addOns + newAddOnGroup()) },
    enabled = draft.addOns.size < POS_MAX_MODIFIER_GROUPS,
    modifier = Modifier.testTag("addon-group-add"),
  ) {
    Icon(AglynIcons.named("add"), contentDescription = null)
    Text("New add-on group", Modifier.padding(start = space(1f)))
  }
  if (draft.addOns.isNotEmpty()) {
    checkAddOns(draft.addOns)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary, modifier = Modifier.testTag("addon-problem")) }
  }
}

/** One choice: its name and what it adds, its prices by size where the product has sizes, and remove. */
@Composable
private fun ChoiceFields(context: NativePluginContext, draft: ProductDraft, choice: AddOnChoiceDraft, tag: String, update: (AddOnChoiceDraft) -> Unit, remove: () -> Unit) {
  var byVariantOpen by rememberSaveable(choice.id) { mutableStateOf(false) }
  var cardOpen by rememberSaveable("card-" + choice.id) { mutableStateOf(false) }
  var choosing by remember { mutableStateOf(false) }
  val label = choice.name.ifBlank { "this choice" }
  Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
      OutlinedTextField(
        choice.name, { update(choice.copy(name = it)) }, label = { Text("Choice") }, singleLine = true,
        modifier = Modifier.weight(1f).testTag("addon-choice-name-$tag"),
      )
      OutlinedTextField(
        choice.price, { update(choice.copy(price = it)) }, label = { Text("Adds") }, prefix = { Text("$") }, placeholder = { Text("0.00") }, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.width(120.dp).testTag("addon-choice-price-$tag"),
      )
      val label = "Remove ${choice.name.ifBlank { "choice" }}"
      WithTooltip(label) { IconButton(onClick = remove) { Icon(AglynIcons.named("close"), contentDescription = label) } }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      if (draft.variants.size > 1) {
        TextButton(onClick = { byVariantOpen = !byVariantOpen }, modifier = Modifier.testTag("addon-choice-by-variant-$tag")) { Text(priceByLabel(draft.options)) }
      }
      TextButton(onClick = { cardOpen = !cardOpen }, modifier = Modifier.testTag("addon-choice-card-$tag")) { Text("Picture & combo") }
    }
    if (draft.variants.size > 1) {
      if (byVariantOpen) {
        Column(Modifier.padding(start = space(2f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          Text(
            "What “${choice.name.ifBlank { "this choice" }}” adds on each. Leave one blank to use the price above.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          draft.variants.forEach { variant ->
            OutlinedTextField(
              choice.byVariant[variant.id].orEmpty(), { update(choice.withVariantPrice(variant.id, it)) }, label = { Text(variant.label) }, prefix = { Text("$") },
              placeholder = { Text(choice.price.ifBlank { "0.00" }) }, singleLine = true,
              keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth(),
            )
          }
        }
      }
    }
    if (cardOpen) {
      // The choice's picture card (AGL-4205), as the console's "Picture & combo" has it.
      Column(Modifier.padding(start = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        Text(
          "What “$label” shows on its picture card. List what it includes to make it a combo: shoppers can open the list on its card.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
          if (choice.imageUrl.isNotBlank()) {
            RemoteImage(mediaPreviewUrl(choice.imageUrl, context.api.origin, context.hostId, 160), null, Modifier.size(56.dp).clip(MaterialTheme.shapes.small), icon = "image")
          }
          val verb = if (choice.imageUrl.isNotBlank()) "Change" else "Choose"
          OutlinedButton(onClick = { choosing = true }, modifier = Modifier.testTag("addon-choice-picture-$tag").semantics { contentDescription = "$verb the picture for $label" }) {
            Text(if (choice.imageUrl.isNotBlank()) "Change picture" else "Choose picture")
          }
          if (choice.imageUrl.isNotBlank()) {
            TextButton(onClick = { update(choice.copy(imageUrl = "")) }, modifier = Modifier.semantics { contentDescription = "Remove the picture for $label" }) { Text("Remove") }
          }
        }
        OutlinedTextField(
          choice.note, { update(choice.copy(note = it.take(PRODUCT_CHOICE_NOTE_MAX))) }, label = { Text("Note") }, placeholder = { Text("Blocks wind on one side") },
          singleLine = true, modifier = Modifier.fillMaxWidth().testTag("addon-choice-note-$tag"),
        )
        OutlinedTextField(
          choice.includes, { update(choice.copy(includes = it)) }, label = { Text("Combo: what it includes") },
          placeholder = { Text("Full wall ×2\nSteel weights ×4\nRoller bag") }, minLines = 2,
          supportingText = { Text("One item per line, up to $PRODUCT_COMBO_MAX_ITEMS. Leave it empty for a single choice.") },
          modifier = Modifier.fillMaxWidth().testTag("addon-choice-includes-$tag"),
        )
      }
    }
  }
  if (choosing) {
    MediaChooserDialog(context, onChoose = { chosen -> choosing = false; update(choice.copy(imageUrl = chosen.reference)) }, onDismiss = { choosing = false }, kind = "image")
  }
}

/** A small count with − and +, kept between [low] and [high], and a word under it ("Required"). */
@Composable
private fun CountField(label: String, value: Int, low: Int, high: Int, note: String?, modifier: Modifier, set: (Int) -> Unit) {
  Column(modifier) {
    Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(verticalAlignment = Alignment.CenterVertically) {
      IconButton(onClick = { set(value - 1) }, enabled = value > low) { Icon(AglynIcons.named("remove"), contentDescription = "Fewer: $label") }
      Text("$value", style = MaterialTheme.typography.titleMedium)
      IconButton(onClick = { set(value + 1) }, enabled = value < high) { Icon(AglynIcons.named("add"), contentDescription = "More: $label") }
    }
    note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
  }
}
