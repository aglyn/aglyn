package com.aglyn.plugins.crm

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.firestoreNow
import com.aglyn.core.listquery.nameSearchTokens
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.Busy
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.FieldEditor
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldOption
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.space
import kotlinx.coroutines.launch

/*
 * THE CRM'S FIELDS AND SETTINGS.
 *
 * Fields: each object's custom fields (`contactFields`), added, renamed,
 * retired, restored and deleted as the console's Fields section writes
 * them (the org-wide scope, the list fields `crmFieldListFields` stamps),
 * and each picklist's values. Settings: what the org document's `crm` map
 * holds (who sees new records, companies made from work addresses, this
 * site's default owner, the round-robin pool), written as the console's
 * settings cards write them.
 */

private val FIELD_KEY = Regex("^[a-z][a-z0-9_]{0,39}$")
private val FIELD_TYPES = listOf("text" to "Text", "number" to "Number", "date" to "Date", "select" to "Choice", "checkbox" to "Checkbox", "url" to "Web address")

/** A label as a field key, the way the console's drawer suggests one. */
fun fieldKeyOf(label: String): String {
  val key = label.lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_')
  val lead = if (key.firstOrNull()?.isLetter() == true) key else "f_$key"
  return lead.take(40).trimEnd('_')
}

/** `crmFieldListFields`: the Fields table's query fields. */
fun fieldListFields(key: String, label: String, required: Boolean, obj: String): Map<String, Any?> = mapOf(
  "object" to obj,
  "required" to required,
  "searchTokens" to nameSearchTokens(listOf(label, key, key.replace(Regex("[_.-]+"), " ")).joinToString(" ")),
)

@Composable
fun FieldsSection(context: NativePluginContext, scope: CrmScope, api: CrmApi, reference: CrmReference) {
  val coroutines = rememberCoroutineScope()
  var obj by rememberSaveable { mutableStateOf("contact") }
  var editing by remember { mutableStateOf<CustomFieldDefinition?>(null) }
  var creating by remember { mutableStateOf(false) }
  var notice by remember { mutableStateOf<String?>(null) }
  val definitions = reference.customFields.filter { it.obj == obj }.sortedBy { it.order }
  val path = { id: String -> "${crmPath(scope.orgId, "contactFields")}/$id" }
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 920.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("crm-fields"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      ChoiceChipRow(Contracts.crmFieldObjectLabels.map { ChipOption(it.key, it.value) }, obj, { obj = it })
      notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } }) }
      SectionCard("Custom fields", Modifier.fillMaxWidth(), action = if (scope.canWrite) ({
        FilledTonalButton(onClick = { creating = true }, modifier = Modifier.testTag("crm-new-field")) {
          Icon(AglynIcons.named("add"), contentDescription = null)
          Text("New field", Modifier.padding(start = space(0.5f)))
        }
      }) else null) {
        if (definitions.isEmpty()) Text("No custom fields on ${Contracts.crmFieldObjectLabels[obj]?.lowercase() ?: obj} yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        definitions.forEach { def ->
          AglynListItem(
            title = def.label,
            supporting = listOf(def.key, FIELD_TYPES.firstOrNull { it.first == def.type }?.second ?: def.type, if (def.required) "Required" else null).filterNotNull().joinToString(" · "),
            icon = AglynIcons.named("tune"),
            trailing = { if (def.retired) StatusChip("Retired") },
            onClick = if (scope.canWrite) ({ editing = def }) else null,
            modifier = Modifier.testTag("field-${def.key}"),
          )
        }
      }
      SectionCard("Picklists", Modifier.fillMaxWidth()) {
        Contracts.nativeCrmPicklists.filter { it.`object` == obj || (obj == "deal" && it.`object` == "task") }.forEach { picklist ->
          AglynListItem(
            title = picklist.label,
            supporting = reference.picklists.labels(picklist.id).joinToString(", "),
            icon = AglynIcons.named("list"),
          )
        }
      }
    }
  }
  val busy = remember(editing, creating) { Busy() }
  if (creating) {
    var label by remember { mutableStateOf("") }
    var type by remember { mutableStateOf("text") }
    var options by remember { mutableStateOf("") }
    var required by remember { mutableStateOf(false) }
    val key = fieldKeyOf(label)
    val taken = reference.customFields.any { it.key == key && it.obj == obj }
    ActionDialog(
      title = "New ${Contracts.crmFieldObjectLabels[obj]?.lowercase()?.removeSuffix("s") ?: obj} field",
      icon = "tune",
      confirmLabel = "Add field",
      confirmEnabled = label.isNotBlank() && FIELD_KEY.matches(key) && !taken && (type != "select" || options.isNotBlank()),
      busy = busy.busy,
      error = busy.error ?: if (taken) "A field with the key $key exists." else null,
      onDismiss = { creating = false },
      onConfirm = {
        busy.run(coroutines, { creating = false; notice = "Field \"$label\" added." }) {
          val now = firestoreNow()
          val order = (reference.customFields.filter { it.obj == obj }.maxOfOrNull { it.order } ?: -1L) + 1
          context.writer.merge(
            path(newRecordId()),
            linkedMapOf<String, Any?>(
              "key" to key,
              "label" to label.trim(),
              "type" to type,
              "required" to required,
              "order" to order,
              "retiredAt" to null,
              "hostId" to scope.hostId,
              "visibleTo" to listOf(ORG_SCOPE_TOKEN),
              "createdAt" to now,
              "updatedAt" to now,
            ).apply {
              if (type == "select") put("options", options.split(',').map { it.trim() }.filter { it.isNotEmpty() })
              putAll(fieldListFields(key, label.trim(), required, obj))
            },
          )
        }
      },
    ) {
      OutlinedTextField(label, { label = it.take(60) }, label = { Text("Label") }, singleLine = true, supportingText = { Text("Key: $key") }, modifier = Modifier.fillMaxWidth().testTag("field-label"))
      FieldEditor(FieldSpec("type", "Type", FieldKind.SELECT, required = true, options = FIELD_TYPES.map { FieldOption(it.first, it.second) }, emptyLabel = null), type, { type = it })
      if (type == "select") OutlinedTextField(options, { options = it }, label = { Text("Choices, separated by commas") }, modifier = Modifier.fillMaxWidth())
      SwitchRow("Required", required, { required = it })
    }
  }
  editing?.let { def ->
    var label by remember(def.id) { mutableStateOf(def.label) }
    var options by remember(def.id) { mutableStateOf(def.options.joinToString(", ")) }
    var required by remember(def.id) { mutableStateOf(def.required) }
    var confirmDelete by remember(def.id) { mutableStateOf(false) }
    ActionDialog(
      title = def.label,
      body = "Key ${def.key} · ${FIELD_TYPES.firstOrNull { it.first == def.type }?.second ?: def.type}. The key and the type stay as they are.",
      icon = "tune",
      confirmLabel = "Save",
      confirmEnabled = label.isNotBlank(),
      busy = busy.busy,
      error = busy.error,
      onDismiss = { editing = null },
      onConfirm = {
        busy.run(coroutines, { editing = null; notice = "Field saved." }) {
          context.writer.merge(
            path(def.id),
            linkedMapOf<String, Any?>("label" to label.trim(), "updatedAt" to firestoreNow()).apply {
              if (def.type == "select") put("options", options.split(',').map { it.trim() }.filter { it.isNotEmpty() })
              putAll(fieldListFields(def.key, label.trim(), required, def.obj))
            },
          )
        }
      },
    ) {
      OutlinedTextField(label, { label = it.take(60) }, label = { Text("Label") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      if (def.type == "select") OutlinedTextField(options, { options = it }, label = { Text("Choices, separated by commas") }, modifier = Modifier.fillMaxWidth())
      SwitchRow("Required", required, { required = it })
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        TextButton(onClick = {
          busy.run(coroutines, { editing = null; notice = if (def.retired) "Field restored." else "Field retired." }) {
            context.writer.merge(path(def.id), mapOf("retiredAt" to if (def.retired) null else com.aglyn.core.nowMillis(), "updatedAt" to firestoreNow()))
          }
        }) { Text(if (def.retired) "Restore" else "Retire") }
        if (def.retired) {
          TextButton(onClick = { confirmDelete = true }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
        }
      }
      if (confirmDelete) {
        NoticeBanner("Delete ${def.label} for good? Values records hold stay, unlabeled.", StatusTone.WARNING, action = {
          TextButton(onClick = { busy.run(coroutines, { editing = null; notice = "Field deleted." }) { context.writer.delete(path(def.id)) } }) { Text("Delete") }
        })
      }
    }
  }
}

/** The CRM's settings, from the org document's `crm` map. */
@Composable
fun SettingsSection(context: NativePluginContext, scope: CrmScope, reference: CrmReference) {
  val coroutines = rememberCoroutineScope()
  val crm = scope.org["crm"] as? Map<*, *> ?: emptyMap<String, Any?>()
  var error by remember { mutableStateOf<String?>(null) }
  fun write(changes: Map<String, Any?>) {
    error = null
    coroutines.launch {
      try {
        context.writer.merge("orgs/${scope.orgId}", mapOf("crm" to changes))
      } catch (failure: Throwable) {
        if (failure is kotlinx.coroutines.CancellationException) throw failure
        error = problemText(failure)
      }
    }
  }
  val hostSettings = ((crm["hosts"] as? Map<*, *>)?.get(scope.hostId) as? Map<*, *>)
  val roundRobin = ((crm["roundRobin"] as? Map<*, *>)?.get("memberUids") as? List<*>).orEmpty().filterIsInstance<String>()
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 920.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("crm-settings"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      error?.let { NoticeBanner(it, StatusTone.ERROR) }
      if (!scope.canManage) NoticeBanner("Only the workspace's owners and admins change these.", StatusTone.INFO)
      SectionCard("Who sees new records", Modifier.fillMaxWidth()) {
        ChoiceChipRow(
          listOf(ChipOption("host", "The site that made them"), ChipOption("org", "Every site in the workspace")),
          crmDefaultScopeOf(scope.org) ?: "host",
          { if (scope.canManage) write(mapOf("defaultRecordScope" to it)) },
          wrap = true,
        )
      }
      SectionCard("Companies", Modifier.fillMaxWidth()) {
        SwitchRow(
          "Make a company from a work address",
          crm["autoCreateCompanies"] == true,
          { write(mapOf("autoCreateCompanies" to it)) },
          supporting = "When someone writes in from a business domain no company has yet.",
          enabled = scope.canManage,
        )
      }
      SectionCard("Default owner for this site", Modifier.fillMaxWidth()) {
        FieldEditor(
          FieldSpec("defaultOwner", "Owner", FieldKind.SELECT, options = reference.members.map { FieldOption(it.uid, it.label) }, emptyLabel = "Nobody"),
          hostSettings?.get("defaultOwnerUid") as? String ?: "",
          { uid -> if (scope.canManage) write(mapOf("hosts" to mapOf(scope.hostId to mapOf("defaultOwnerUid" to (uid.ifEmpty { null } ?: FirestoreDelete))))) },
        )
      }
      SectionCard("Round robin", Modifier.fillMaxWidth()) {
        Text("New records without a rule's owner go to these people in turn.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        reference.members.forEach { member ->
          SwitchRow(
            member.label,
            member.uid in roundRobin,
            { on -> write(mapOf("roundRobin" to mapOf("memberUids" to if (on) roundRobin + member.uid else roundRobin - member.uid))) },
            supporting = member.email,
            enabled = scope.canManage,
          )
        }
      }
    }
  }
}
