package com.aglyn.plugins.data

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.DatasetFieldDefinition
import com.aglyn.contracts.DatasetFieldDefinitionReference
import com.aglyn.contracts.DatasetFieldDefinitionReferenceOnDelete
import com.aglyn.contracts.DatasetFieldType
import com.aglyn.contracts.DatasetFieldValidation
import com.aglyn.contracts.DatasetModel
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.OrgAccess
import com.aglyn.pluginhost.jsNumber
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.ORG_WRITER_ROLES
import com.aglyn.pluginhost.describeScope
import com.aglyn.pluginhost.narrowsScope
import com.aglyn.pluginhost.rememberOrgAccess
import com.aglyn.pluginhost.scopeToStore
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.ChoiceField
import com.aglyn.ui.EmptyState
import com.aglyn.ui.InputChoice
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.space
import kotlinx.serialization.json.JsonPrimitive

/** A site of the workspace, for naming and picking a dataset's sharing. */
private data class SiteChoice(val id: String, val name: String)

/** One field being edited; [fieldId] null for a new one. */
private data class FieldDraft(
  val fieldId: String?,
  val definition: DatasetFieldDefinition,
  val optionsText: String,
  val idDraft: String,
  val idTouched: Boolean,
)

private sealed interface SchemaDialog {
  data class Field(val draft: FieldDraft) : SchemaDialog
  data class Remove(val fieldId: String) : SchemaDialog
  data class TypeChange(val draft: FieldDraft) : SchemaDialog
  data class Narrow(val losing: List<String>) : SchemaDialog
}

/**
 * A dataset's schema, as the Schema dialog edits it: its singular and
 * plural names, who it is shared with (an org-wide member only), and its
 * fields: add, edit (type, required, default, description, validation,
 * reference target), reorder and remove. Saving writes the model whole, as
 * the dialog does; stored records are never rewritten.
 */
@Composable
fun SchemaScreen(context: NativePluginContext, datasetId: String) {
  val orgId = context.orgId ?: return EmptyState("Pick a workspace to see its data", icon = AglynIcons.named("dataset"))
  val live by remember(orgId, datasetId, context.firestore) { context.firestore.observeDoc("${datasetsPath(orgId)}/$datasetId") }.collectAsState(Live.Loading)
  val (_, datasets) = rememberDatasets(context, orgId)
  val access = rememberOrgAccess(context, orgId)
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this dataset", body = "It may no longer be shared with you.", icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val doc = value.value ?: return EmptyState("This dataset is gone", icon = AglynIcons.named("dataset"))
      // Seeded once from the stored dataset; the save writes what is edited here.
      val dataset = remember(doc.id) { DatasetRow.from(doc) }
      SchemaEditor(context, orgId, dataset, (datasets as? Live.Ready)?.value.orEmpty(), (access as? Live.Ready)?.value)
    }
  }
}

@Composable
private fun SchemaEditor(context: NativePluginContext, orgId: String, dataset: DatasetRow, datasets: List<DatasetRow>, access: OrgAccess?) {
  val scope = rememberCoroutineScope()
  val api = remember(orgId, context.api, context.writer) { DataApi(context.api, context.writer, orgId) }
  val runner = remember(dataset.id) { ActionRunner(scope, roleHint = "an owner, admin or editor") }
  val canWrite = context.orgRole in ORG_WRITER_ROLES
  var model by remember(dataset.id) { mutableStateOf(dataset.model) }
  var singular by remember(dataset.id) { mutableStateOf(dataset.singular) }
  var plural by remember(dataset.id) { mutableStateOf(dataset.plural) }
  var visibleTo by remember(dataset.id) { mutableStateOf(dataset.visibleTo.orEmpty()) }
  var dialog by remember { mutableStateOf<SchemaDialog?>(null) }
  var records by remember(dataset.id) { mutableStateOf(0L) }
  LaunchedEffect(dataset.id) { records = runCatching { context.firestore.count(FirestoreQuery(recordsPath(orgId, dataset.id))) }.getOrNull() ?: 0L }
  val sites by remember(orgId, context.uid, context.firestore) {
    context.firestore.observe(FirestoreQuery("users/${context.uid}/hostMemberships", filters = listOf(FirestoreFilter("orgId", FilterOp.EQ, orgId)), limit = 200))
  }.collectAsState(Live.Loading)
  val siteList = ((sites as? Live.Ready)?.value).orEmpty().map { SiteChoice(it.id, it.string("displayName") ?: it.string("subdomain") ?: it.id) }
  val orgWide = access?.orgWide == true
  val previousScope = dataset.visibleTo.orEmpty()
  val scopeChanged = previousScope.sorted() != visibleTo.sorted()

  fun save() {
    if (model.order.isNullOrEmpty()) {
      runner.error = "A collection needs at least one field"
      return
    }
    val scopeWrite = if (orgWide && scopeChanged) scopeToStore(visibleTo) else null
    if (scopeWrite?.second != null) {
      runner.error = scopeWrite.second
      return
    }
    runner.run("Schema saved.", onDone = { context.back() }) {
      api.saveSchema(dataset, model, singular, plural, scopeWrite?.first)
    }
  }

  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).widthIn(max = 880.dp).testTag("schema-editor"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    Text("Schema — ${dataset.name}", style = MaterialTheme.typography.headlineSmall)
    if (dialog == null) {
      runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
    }
    if (!canWrite) NoticeBanner("Changing a schema needs the editor role.", StatusTone.WARNING)
    SectionCard("Names") {
      OutlinedTextField(singular, { singular = it }, label = { Text("Singular name") }, supportingText = { Text("e.g. Product") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      OutlinedTextField(plural, { plural = it }, label = { Text("Plural name") }, supportingText = { Text("e.g. Products (shown as the title)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    }
    SectionCard("Shared with") {
      when {
        access == null -> Text("Checking your access…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        !orgWide -> Text(describeScope(dataset.visibleTo, siteList.associate { it.id to it.name }) + ". Only an owner, an admin or a member with every site can change this.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        else -> {
          val all = OrgAccess.ORG_SCOPE_TOKEN in visibleTo
          if (dataset.visibleTo == null) NoticeBanner("Not shared with any site: no page can show it until you choose.", StatusTone.WARNING)
          ChoiceChipRow(
            listOf(ChipOption("org", "All sites"), ChipOption("hosts", "Selected sites…")),
            if (all) "org" else if (visibleTo.isNotEmpty() || dataset.visibleTo != null) "hosts" else null,
            { picked -> visibleTo = if (picked == "org") listOf(OrgAccess.ORG_SCOPE_TOKEN) else visibleTo.filter { it != OrgAccess.ORG_SCOPE_TOKEN } },
          )
          if (!all) {
            if (siteList.isEmpty()) Text("No sites to pick from.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            for (site in siteList) {
              val token = OrgAccess.hostScopeToken(site.id)
              Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(token in visibleTo, { on -> visibleTo = if (on) visibleTo + token else visibleTo - token }, Modifier.testTag("scope-${site.id}"))
                Text(site.name)
              }
            }
          }
        }
      }
    }
    SectionCard("Fields", action = {
      TextButton(onClick = { dialog = SchemaDialog.Field(FieldDraft(null, DatasetFieldDefinition(name = "", type = DatasetFieldType.TEXT), "", "", false)) }, enabled = canWrite, modifier = Modifier.testTag("add-field")) {
        Text("Add field")
      }
    }) {
      val fields = model.orderedFields()
      if (fields.isEmpty()) Text("A collection needs at least one field.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      fields.forEachIndexed { index, (id, field) ->
        if (index > 0) HorizontalDivider()
        AglynListItem(
          title = field.label(id),
          supporting = fieldSummary(id, field, datasets),
          icon = AglynIcons.named(fieldIcon(field)),
          trailing = {
            Row(verticalAlignment = Alignment.CenterVertically) {
              if (field.required == true) StatusChip("Required", StatusTone.INFO)
              IconButton(onClick = { model = moveField(model, id, -1) }, enabled = canWrite && index > 0) { Icon(Icons.Outlined.ArrowUpward, contentDescription = "Move ${field.label(id)} up") }
              IconButton(onClick = { model = moveField(model, id, 1) }, enabled = canWrite && index < fields.size - 1) { Icon(Icons.Outlined.ArrowDownward, contentDescription = "Move ${field.label(id)} down") }
              OverflowMenu(
                listOf(
                  MenuAction("edit-$id", "Edit", "edit", enabled = canWrite) {
                    dialog = SchemaDialog.Field(FieldDraft(id, field, field.validation?.options.orEmpty().joinToString(", "), id, true))
                  },
                  MenuAction("remove-$id", "Remove", "delete", destructive = true, enabled = canWrite) { dialog = SchemaDialog.Remove(id) },
                ),
                contentDescription = "More for ${field.label(id)}",
              )
            }
          },
          modifier = Modifier.testTag("schema-field-$id"),
        )
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedButton(onClick = { context.back() }) { Text("Cancel") }
      Button(
        onClick = {
          if (orgWide && scopeChanged && narrowsScope(previousScope, visibleTo)) {
            val names = siteList.associate { it.id to it.name }
            val losing = siteList.map { it.id }.filter { id ->
              val token = OrgAccess.hostScopeToken(id)
              (OrgAccess.ORG_SCOPE_TOKEN in previousScope || token in previousScope) && !(OrgAccess.ORG_SCOPE_TOKEN in visibleTo || token in visibleTo)
            }.map { names[it] ?: it }
            dialog = SchemaDialog.Narrow(losing)
          } else {
            save()
          }
        },
        enabled = canWrite && !runner.busy,
        modifier = Modifier.testTag("schema-save"),
      ) { Text("Save schema") }
    }
  }

  when (val open = dialog) {
    null -> Unit
    is SchemaDialog.Field -> FieldEditor(open.draft, model, datasets, close = { dialog = null }) { draft ->
      val definition = finishDefinition(draft)
      val previous = draft.fieldId?.let { model.fields?.get(it) }
      if (draft.fieldId != null && records > 0 && previous != null && previous.type != definition.type) {
        dialog = SchemaDialog.TypeChange(draft)
      } else {
        model = putField(model, draft.fieldId ?: draft.idDraft.trim(), definition)
        dialog = null
      }
    }
    is SchemaDialog.TypeChange -> ActionDialog(
      title = "Change field type?",
      body = "$records document${if (records == 1L) "" else "s"} exist. Stored values are not rewritten — ones that no longer match " +
        "\"${typeLabel(finishDefinition(open.draft))}\" will be flagged when documents are next edited.",
      icon = "warning",
      confirmLabel = "Change type",
      onDismiss = { dialog = SchemaDialog.Field(open.draft) },
      onConfirm = {
        model = putField(model, open.draft.fieldId!!, finishDefinition(open.draft))
        dialog = null
      },
    )
    is SchemaDialog.Remove -> ActionDialog(
      title = "Remove field \"${model.fields?.get(open.fieldId)?.label(open.fieldId) ?: open.fieldId}\"?",
      body = "Existing documents keep their stored value until they are next saved (it is stripped then). Bindings using this field stop resolving.",
      icon = "delete",
      confirmLabel = "Remove",
      destructive = true,
      onDismiss = { dialog = null },
      onConfirm = {
        model = DatasetModel(fields = model.fields.orEmpty() - open.fieldId, order = model.order.orEmpty() - open.fieldId)
        dialog = null
      },
    )
    is SchemaDialog.Narrow -> ActionDialog(
      title = "Limit which sites can use this collection?",
      body = if (open.losing.isNotEmpty()) {
        "${open.losing.joinToString(", ")} will stop seeing this collection. Pages that repeat over it will render nothing. No data is deleted."
      } else {
        "No site loses access, so nothing breaks today."
      },
      icon = "lock",
      confirmLabel = "Limit access",
      onDismiss = { dialog = null },
      onConfirm = { dialog = null; save() },
    )
  }
}

private fun moveField(model: DatasetModel, fieldId: String, delta: Int): DatasetModel {
  val order = model.order.orEmpty().toMutableList()
  val index = order.indexOf(fieldId)
  val target = index + delta
  if (index < 0 || target < 0 || target >= order.size) return model
  order.removeAt(index)
  order.add(target, fieldId)
  return model.copy(order = order)
}

private fun putField(model: DatasetModel, fieldId: String, definition: DatasetFieldDefinition): DatasetModel = DatasetModel(
  fields = model.fields.orEmpty() + (fieldId to definition),
  order = model.order.orEmpty().let { if (fieldId in it) it else it + fieldId },
)

/** The definition a draft saves (`handleFieldSave`): trimmed, empty parts dropped, the options from their text. */
private fun finishDefinition(draft: FieldDraft): DatasetFieldDefinition {
  val definition = draft.definition
  val options = draft.optionsText.split(',').map { it.trim() }.filter { it.isNotEmpty() }
  val validation = (definition.validation ?: DatasetFieldValidation()).copy(options = options.ifEmpty { null })
  val empty = validation.options == null && validation.regex == null && validation.min == null && validation.max == null && validation.required == null
  return definition.copy(
    name = definition.name.orEmpty().trim(),
    description = definition.description?.trim()?.ifEmpty { null },
    validation = if (empty) null else validation,
  )
}

private val ON_DELETE_CHOICES = listOf(
  InputChoice(DatasetFieldDefinitionReferenceOnDelete.SET_NULL.raw, "Clear the reference"),
  InputChoice(DatasetFieldDefinitionReferenceOnDelete.RESTRICT.raw, "Block the delete"),
)

@Composable
private fun FieldEditor(
  start: FieldDraft,
  model: DatasetModel,
  datasets: List<DatasetRow>,
  close: () -> Unit,
  onDone: (FieldDraft) -> Unit,
) {
  var draft by remember(start) { mutableStateOf(start) }
  val definition = draft.definition
  val isNew = draft.fieldId == null
  val taken = model.order.orEmpty()
  val idError = if (isNew) validateDatasetFieldId(draft.idDraft, taken) else null
  fun update(next: DatasetFieldDefinition) { draft = draft.copy(definition = next) }
  fun validation(change: (DatasetFieldValidation) -> DatasetFieldValidation) = update(definition.copy(validation = change(definition.validation ?: DatasetFieldValidation())))
  val authorable = Contracts.datasetAuthorableFieldTypes
  val types = if (!isNew && (definition.type ?: DatasetFieldType.TEXT) !in authorable) Contracts.datasetFieldTypes else authorable
  ActionDialog(
    title = if (isNew) "New field" else "Edit field",
    icon = "edit",
    confirmLabel = "Done",
    confirmEnabled = definition.name.orEmpty().isNotBlank() && idError == null,
    onDismiss = close,
    onConfirm = { onDone(draft) },
    modifier = Modifier.testTag("field-editor"),
  ) {
    Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedTextField(
        definition.name.orEmpty(),
        { name ->
          draft = draft.copy(
            definition = definition.copy(name = name),
            idDraft = if (isNew && !draft.idTouched) defaultDatasetFieldId(name, taken) else draft.idDraft,
          )
        },
        label = { Text("Display name") },
        supportingText = { Text("Shown to people editing records and wherever the field appears") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("field-name"),
      )
      OutlinedTextField(
        draft.idDraft,
        { draft = draft.copy(idDraft = it.filter { ch -> ch.isLetterOrDigit() || ch == '_' }, idTouched = true) },
        label = { Text("Reference ID") },
        enabled = isNew,
        isError = idError != null && draft.idDraft.isNotEmpty(),
        supportingText = { Text(idError?.takeIf { draft.idDraft.isNotEmpty() } ?: if (isNew) "Bindings use {{item.${draft.idDraft.ifEmpty { "id" }}}}; it cannot change later" else "Fixed once a field exists") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
      )
      OutlinedTextField(
        definition.description.orEmpty(),
        { update(definition.copy(description = it)) },
        label = { Text("Description") },
        supportingText = { Text("What this field is for — shown as a hint wherever the field appears") },
        modifier = Modifier.fillMaxWidth(),
      )
      if (definition.customType != null) {
        NoticeBanner("A ${definition.customType} field: its type is set by the plugin that declares it.", StatusTone.NEUTRAL)
      } else {
        ChoiceField(
          "Type",
          definition.type?.raw ?: "text",
          types.map { InputChoice(it.raw, Contracts.datasetFieldTypeLabels[it.raw] ?: it.raw) },
          { raw -> DatasetFieldType.entries.firstOrNull { it.raw == raw }?.let { update(definition.copy(type = it)) } },
          allowEmpty = false,
        )
      }
      if (definition.type == DatasetFieldType.REFERENCE) {
        val reference = definition.reference ?: DatasetFieldDefinitionReference(datasetId = "")
        val target = datasets.firstOrNull { it.id == reference.datasetId }
        ChoiceField(
          "Target collection",
          reference.datasetId,
          datasets.map { InputChoice(it.id, it.name) },
          { update(definition.copy(reference = reference.copy(datasetId = it, displayFieldId = null))) },
          allowEmpty = false,
        )
        if (target != null) {
          ChoiceField(
            "Display field",
            reference.displayFieldId.orEmpty(),
            target.model.orderedFields().map { (id, field) -> InputChoice(id, field.label(id)) },
            { update(definition.copy(reference = reference.copy(displayFieldId = it.ifEmpty { null }))) },
            supporting = "Shown in pickers and grid cells",
            emptyLabel = "The first field",
          )
        }
        ChoiceField(
          "When a referenced document is deleted",
          (reference.onDelete ?: DatasetFieldDefinitionReferenceOnDelete.SET_NULL).raw,
          ON_DELETE_CHOICES,
          { raw -> update(definition.copy(reference = reference.copy(onDelete = DatasetFieldDefinitionReferenceOnDelete.entries.firstOrNull { it.raw == raw }))) },
          allowEmpty = false,
        )
        SwitchRow("Allow multiple (many-to-many)", reference.multiple == true, { update(definition.copy(reference = reference.copy(multiple = it))) })
      }
      SwitchRow("Required", definition.required == true, { update(definition.copy(required = if (it) true else null)) })
      OutlinedTextField(
        (definition.default as? JsonPrimitive)?.content.orEmpty(),
        { typed -> update(definition.copy(default = typed.ifEmpty { null }?.let { JsonPrimitive(it) })) },
        label = { Text("Default value") },
        supportingText = { Text("Pre-filled when creating documents") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
      )
      if (definition.type == DatasetFieldType.TEXT) {
        OutlinedTextField(
          definition.validation?.regex.orEmpty(),
          { text -> validation { it.copy(regex = text.ifEmpty { null }) } },
          label = { Text("Pattern (regex)") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
          draft.optionsText,
          { draft = draft.copy(optionsText = it) },
          label = { Text("Options") },
          supportingText = { Text("Comma-separated enum, e.g. basic, plus") },
          modifier = Modifier.fillMaxWidth().testTag("field-options"),
        )
      }
      if (definition.type in setOf(DatasetFieldType.INT32, DatasetFieldType.INT64, DatasetFieldType.FLOAT, DatasetFieldType.TIMESTAMP, DatasetFieldType.TEXT)) {
        val text = definition.type == DatasetFieldType.TEXT
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          for (bound in listOf("min", "max")) {
            val current = if (bound == "min") definition.validation?.min else definition.validation?.max
            OutlinedTextField(
              current?.let(::jsNumber).orEmpty(),
              { typed ->
                val number = typed.trim().toDoubleOrNull()
                validation { if (bound == "min") it.copy(min = number) else it.copy(max = number) }
              },
              label = { Text(if (text) "${if (bound == "min") "Min" else "Max"} length" else if (bound == "min") "Min" else "Max") },
              singleLine = true,
              keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
              modifier = Modifier.weight(1f),
            )
          }
        }
      }
    }
  }
}
