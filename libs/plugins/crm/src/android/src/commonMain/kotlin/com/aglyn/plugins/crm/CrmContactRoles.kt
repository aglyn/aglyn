package com.aglyn.plugins.crm

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.aglyn.contracts.Contracts
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.listquery.nameSearchKey
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.Busy
import com.aglyn.ui.ChoiceDialog
import com.aglyn.ui.FieldEditor
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldOption
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.MenuAction
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectOption
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.sheetDialogProperties
import com.aglyn.ui.space

/*
 * THE PEOPLE ON A DEAL OR A COMPANY, AND THE PART EACH PLAYS: Salesforce's
 * Contact Roles, as the console's Contact roles card keeps them
 * (`deal-contact-roles.ts` and the roles rules of `crm.ts`; the Apple
 * plugin's `CrmContactRoles.swift`). A deal names its Primary twice over, in
 * `contactRoles` and as `contactId`; a company holds it on the row. Every
 * edit writes the whole list beside the ids and keys a merge, a delete, an
 * erasure and a rename of a role find the record by. Each rule is replayed
 * against the console's own answers.
 */

/** One contact on a deal or a company (`CrmDealContactRole`). */
data class CrmContactRole(val contactId: String, val role: String?, val primary: Boolean) {
  /** The row as a record stores it. */
  val stored: Map<String, Any?> get() = buildMap {
    put("contactId", contactId)
    role?.let { put("role", it) }
    put("primary", primary)
  }
}

/** The most contacts one record names (`DEAL_CONTACT_ROLES_MAX`). */
const val CRM_CONTACT_ROLES_MAX = 50

/** The org's list of roles, kept on the Deals tab of Fields. */
const val CRM_CONTACT_ROLE_PICKLIST = "opportunityContactRole"

private val SPACES = Regex("\\s+")

/** A label as a list stores it (`normalizePicklistLabel`): trimmed, single-spaced, capped. */
fun normalizePicklistLabel(value: String?): String = value.orEmpty().trim().replace(SPACES, " ").take(120)

/** A role's key, as a rename finds the records holding it (`crmPicklistKey`); null for none. */
fun crmPicklistKey(label: String?): String? = nameSearchKey(normalizePicklistLabel(label)).ifEmpty { null }

/**
 * Stored roles, read defensively (`readDealContactRoles`): a row with no usable contact is dropped, a contact named twice keeps
 * its first row, only the first Primary stays Primary, and the list stops at fifty.
 */
fun readContactRoles(raw: Any?): List<CrmContactRole> {
  val rows = raw as? List<*> ?: return emptyList()
  val roles = mutableListOf<CrmContactRole>()
  val seen = mutableSetOf<String>()
  var primaryTaken = false
  for (entry in rows) {
    val row = entry as? Map<*, *> ?: continue
    val id = (row["contactId"] as? String)?.trim().orEmpty()
    if (id.isEmpty() || id.length > 200 || '/' in id || id in seen) continue
    seen += id
    val role = (row["role"] as? String)?.let(::normalizePicklistLabel).orEmpty()
    val primary = row["primary"] == true && !primaryTaken
    if (primary) primaryTaken = true
    roles += CrmContactRole(id, role.ifEmpty { null }, primary)
    if (roles.size >= CRM_CONTACT_ROLES_MAX) break
  }
  return roles
}

/** [roles] with [contactId] as the one Primary, added first with no role when the list does not name them; null for none. */
fun contactRolesWithPrimary(roles: List<CrmContactRole>, contactId: String?): List<CrmContactRole> {
  val id = contactId?.trim().orEmpty()
  val next = roles.map { it.copy(primary = id.isNotEmpty() && it.contactId == id) }.toMutableList()
  if (id.isNotEmpty() && next.none { it.contactId == id }) next.add(0, CrmContactRole(id, null, true))
  return next.take(CRM_CONTACT_ROLES_MAX)
}

/** The roles a deal holds, in step with its `contactId` (`dealContactRolesOf`): a deal written before roles reads as its one contact. */
fun dealContactRolesOf(deal: Map<String, Any?>): List<CrmContactRole> = contactRolesWithPrimary(readContactRoles(deal["contactRoles"]), deal["contactId"] as? String)

/** The roles a company holds, as stored (`companyContactRolesOf`): its Primary is on the row. */
fun companyContactRolesOf(company: Map<String, Any?>): List<CrmContactRole> = readContactRoles(company["contactRoles"])

fun contactRolesPrimary(roles: List<CrmContactRole>): String? = roles.firstOrNull { it.primary }?.contactId

/** [roles] without one contact (`dealContactRolesWithout`). */
fun contactRolesWithout(roles: List<CrmContactRole>, contactId: String) = roles.filter { it.contactId != contactId }

/** Why a contact cannot be added, or null when it can (`dealContactRoleAddProblem`). */
fun contactRoleAddProblem(roles: List<CrmContactRole>, contactId: String, noun: String): String? = when {
  contactId.isEmpty() -> "Pick a contact."
  roles.any { it.contactId == contactId } -> "That contact is already on this $noun."
  roles.size >= CRM_CONTACT_ROLES_MAX -> "A $noun names at most $CRM_CONTACT_ROLES_MAX contacts."
  else -> null
}

/** [roles] with one contact added, as the Primary when asked (`dealContactRolesAdded`). */
fun contactRolesAdded(roles: List<CrmContactRole>, contactId: String, role: String?, primary: Boolean): List<CrmContactRole> =
  roles.map { if (primary) it.copy(primary = false) else it } + CrmContactRole(contactId, role?.ifEmpty { null }, primary)

/** [roles] with one contact's role set, "" for none (`dealContactRolesWithRole`). */
fun contactRolesWithRole(roles: List<CrmContactRole>, contactId: String, role: String): List<CrmContactRole> =
  roles.map { if (it.contactId == contactId) it.copy(role = role.ifEmpty { null }) else it }

/** A save refused, in the console's words. */
class CrmContactRoleRefusal(override val message: String) : Exception(message)

/**
 * Each role judged against the org's list (`judgeDealContactRoles`): an active value stored as the list spells it, a blank
 * cleared, and the role a contact already holds kept; anything else refused, naming what the list allows.
 */
fun judgeContactRoles(values: List<Pair<String, Boolean>>, roles: List<CrmContactRole>, current: List<CrmContactRole>): Result<List<CrmContactRole>> {
  fun key(label: String) = normalizePicklistLabel(label).lowercase()
  val judged = mutableListOf<CrmContactRole>()
  for (row in roles) {
    val label = normalizePicklistLabel(row.role)
    val stored = if (label.isEmpty()) {
      null
    } else {
      val held = normalizePicklistLabel(current.firstOrNull { it.contactId == row.contactId }?.role)
      val match = values.firstOrNull { key(it.first) == key(label) }
      when {
        held.isNotEmpty() && key(held) == key(label) -> held
        match != null && match.second -> match.first
        else -> return Result.failure(CrmContactRoleRefusal(contactRoleRefusal(values)))
      }
    }
    judged += CrmContactRole(row.contactId, stored, row.primary)
  }
  return Result.success(judged)
}

/** The sentence a role outside the list is refused with (`crmPicklistRefusal`). */
fun contactRoleRefusal(values: List<Pair<String, Boolean>>): String {
  val active = values.filter { it.second }.map { it.first }
  if (active.isEmpty()) return "This organization has no active contact roles. Add one under CRM › Fields › Deals."
  val more = if (active.size > 20) ", and ${active.size - 20} more" else ""
  return "Contact role must be one of: ${active.take(20).joinToString(", ")}$more."
}

/**
 * What a save of a deal's roles writes (`dealContactRolesSave`): the judged list, its Primary as `contactId` (null to delete),
 * and whether the Primary changed, which is when the name copied beside `contactId` moves with it.
 */
data class CrmDealRolesWrite(val contactRoles: List<CrmContactRole>, val contactId: String?, val primaryChanged: Boolean)

fun dealContactRolesSave(deal: Map<String, Any?>, next: List<CrmContactRole>, values: List<Pair<String, Boolean>>): Result<CrmDealRolesWrite> =
  judgeContactRoles(values, next, dealContactRolesOf(deal)).map { judged ->
    val roles = readContactRoles(judged.map { it.stored })
    val primary = contactRolesPrimary(roles)
    CrmDealRolesWrite(roles, primary, primary != (deal["contactId"] as? String)?.ifEmpty { null })
  }

/** What a save of a company's roles writes (`companyContactRolesSave`): the judged list; its ids and keys come from [contactRoleListFields]. */
fun companyContactRolesSave(company: Map<String, Any?>, next: List<CrmContactRole>, values: List<Pair<String, Boolean>>): Result<List<CrmContactRole>> =
  judgeContactRoles(values, next, companyContactRolesOf(company))

/** The arrays a record's roles are found by (`crmDealContactRoleListFields`). */
data class CrmContactRoleListFields(val ids: List<String>, val scoped: List<String>, val keys: List<String>)

/**
 * Every contact on a record, the same ids behind each of the record's scope tokens (`scopedSearchTokens`), and the keys of the
 * roles they hold.
 */
fun contactRoleListFields(roles: List<CrmContactRole>, visibleTo: Any?): CrmContactRoleListFields {
  val ids = roles.map { it.contactId }
  val keys = roles.mapNotNull { crmPicklistKey(it.role) }.distinct()
  val scopes = (visibleTo as? List<*>).orEmpty().filterIsInstance<String>().filter { it.isNotEmpty() }.distinct()
  val words = ids.filter { it.isNotEmpty() }.distinct()
  return CrmContactRoleListFields(ids, scopes.flatMap { scope -> words.map { "$scope${Contracts.scopedSearchJoin}$it" } }, keys)
}

/*---------- the card ----------*/

/**
 * A record's Contact roles (the console's card, on a deal and on a company): who is on it, the part each plays, and which one is
 * Primary. Add contact sits in the card's header; each row's ⋮ sets its role, makes it Primary or removes it.
 */
@Composable
internal fun ContactRolesCard(
  context: NativePluginContext,
  kind: CrmKind,
  id: String,
  data: Map<String, Any?>,
  scope: CrmScope,
  api: CrmApi,
  reference: CrmReference,
  onNotice: (String) -> Unit,
) {
  val coroutines = rememberCoroutineScope()
  val busy = remember(id) { Busy() }
  var adding by remember(id) { mutableStateOf(false) }
  var choosingRole by remember(id) { mutableStateOf<CrmContactRole?>(null) }
  val noun = kind.singular.lowercase()
  val roles = if (kind == CrmKind.DEAL) dealContactRolesOf(data) else companyContactRolesOf(data)
  val values = reference.picklists.values(CRM_CONTACT_ROLE_PICKLIST)
  fun name(contactId: String) = reference.contactLabel(contactId) ?: "Contact"
  fun change(next: List<CrmContactRole>, done: String) {
    busy.run(coroutines, { onNotice(done) }) { write(kind, id, data, next, values, api, reference) }
  }
  SectionCard(
    "Contact roles",
    Modifier.fillMaxWidth().testTag("crm-roles"),
    action = if (scope.canWrite) ({
      TextButton(onClick = { adding = true }, enabled = !busy.busy, modifier = Modifier.testTag("crm-roles-add")) {
        Icon(AglynIcons.named("person_add"), contentDescription = null, modifier = Modifier.padding(end = space(0.5f)))
        Text("Add contact")
      }
    }) else null,
  ) {
    busy.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
    if (roles.isEmpty()) {
      Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        Text("No contacts on this $noun", style = MaterialTheme.typography.bodyLarge)
        Text(
          if (kind == CrmKind.DEAL) "Name the people on the deal and the part each plays — one of them Primary."
          else "Name who at the company plays which part, one of them Primary.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
    roles.forEach { row ->
      val label = name(row.contactId)
      AglynListItem(
        label,
        supporting = row.role,
        icon = AglynIcons.named(CrmKind.CONTACT.icon),
        modifier = Modifier.testTag("crm-role-${row.contactId}"),
        trailing = {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
            if (row.primary) StatusChip("Primary", StatusTone.INFO)
            OverflowMenu(
              buildList {
                add(MenuAction("open", "Open contact", CrmKind.CONTACT.icon) { context.navigate(CrmKind.CONTACT.detailScreen, mapOf(CrmKind.CONTACT.param to row.contactId)) })
                if (scope.canWrite) {
                  add(MenuAction("role", "Role", "label", enabled = !busy.busy) { choosingRole = row })
                  if (!row.primary) add(MenuAction("primary", "Make primary", "star", enabled = !busy.busy) { change(contactRolesWithPrimary(roles, row.contactId), "Primary contact set.") })
                  add(MenuAction("remove", "Remove from this $noun", "person_remove", destructive = true, enabled = !busy.busy) { change(contactRolesWithout(roles, row.contactId), "Contact removed.") })
                }
              },
              modifier = Modifier.testTag("crm-roles-actions-${row.contactId}"),
              contentDescription = "$label actions",
            )
          }
        },
      )
    }
  }
  choosingRole?.let { row ->
    val labels = reference.picklists.labels(CRM_CONTACT_ROLE_PICKLIST)
    val held = row.role?.takeIf { role -> labels.none { it.equals(role, ignoreCase = true) } }
    ChoiceDialog(
      title = "Role",
      options = listOf(SelectOption("", "None")) + (labels + listOfNotNull(held)).map { SelectOption(it, it) },
      onPick = { role ->
        choosingRole = null
        change(contactRolesWithRole(roles, row.contactId, role), "Role saved.")
      },
      onDismiss = { choosingRole = null },
    )
  }
  if (adding) {
    val dialogBusy = remember { Busy() }
    AddContactRoleDialog(noun, roles, reference, dialogBusy, onDismiss = { adding = false }) { contactId, role, primary ->
      dialogBusy.run(coroutines, { adding = false; onNotice("Contact added.") }) {
        write(kind, id, data, contactRolesAdded(roles, contactId, role, primary), values, api, reference)
      }
    }
  }
}

private suspend fun write(kind: CrmKind, id: String, data: Map<String, Any?>, next: List<CrmContactRole>, values: List<Pair<String, Boolean>>, api: CrmApi, reference: CrmReference) {
  if (kind == CrmKind.DEAL) api.saveDealContactRoles(id, data, next, values) { reference.contactLabel(it) }
  else api.saveCompanyContactRoles(id, data, next, values)
}

/**
 * Pick a contact, the part they play, and whether they are the Primary (the console's add dialog). The first contact on a record
 * is always its Primary.
 */
@Composable
private fun AddContactRoleDialog(
  noun: String,
  roles: List<CrmContactRole>,
  reference: CrmReference,
  busy: Busy,
  onDismiss: () -> Unit,
  onAdd: (contactId: String, role: String?, primary: Boolean) -> Unit,
) {
  var contactId by remember { mutableStateOf<String?>(null) }
  var role by remember { mutableStateOf("") }
  var primary by remember { mutableStateOf(false) }
  val problem = contactId?.let { contactRoleAddProblem(roles, it, noun) }
  ActionDialog(
    title = "Add a contact to this $noun",
    confirmLabel = "Add",
    confirmEnabled = contactId != null && problem == null,
    busy = busy.busy,
    error = busy.error,
    onDismiss = onDismiss,
    onConfirm = { contactId?.let { onAdd(it, role.ifEmpty { null }, primary || roles.isEmpty()) } },
    modifier = Modifier.testTag("crm-roles-add-dialog"),
  ) {
    CrmPickerField(
      "Contact",
      crmNameOptions(emptyList(), reference.contacts),
      contactId,
      selectedLabel = contactId?.let { reference.contactLabel(it) },
      noneLabel = "Choose",
      supporting = problem,
      isError = problem != null,
      modifier = Modifier.testTag("crm-roles-contact"),
    ) { contactId = it }
    FieldEditor(
      FieldSpec("role", "Role", FieldKind.SELECT, options = reference.picklists.options(CRM_CONTACT_ROLE_PICKLIST), emptyLabel = "None"),
      role,
      { role = it },
      Modifier.testTag("crm-roles-role"),
    )
    CheckboxRow("Primary contact", primary || roles.isEmpty(), { primary = it }, enabled = roles.isNotEmpty(), modifier = Modifier.testTag("crm-roles-primary"))
  }
}

/** A checkbox with its sentence beside it, the whole row the target (the console's MUI checkbox row). */
@Composable
internal fun CheckboxRow(label: String, checked: Boolean, onChecked: (Boolean) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
  Row(
    modifier.fillMaxWidth().heightIn(min = 48.dp)
      .clickable(enabled = enabled, role = Role.Checkbox, interactionSource = remember { MutableInteractionSource() }, indication = null) { onChecked(!checked) }
      .semantics(mergeDescendants = true) {},
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Checkbox(checked, onCheckedChange = null, enabled = enabled)
    Text(
      label,
      Modifier.padding(start = space(1f)),
      style = MaterialTheme.typography.bodyLarge,
      color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }
}

/*---------- the record pickers ----------*/

/**
 * A record field, picked from a dialog that searches and groups its rows (the console's record pickers), with [noneLabel]
 * first. The field reads as its pick, or [selectedLabel] while the options do not hold it.
 */
@Composable
internal fun CrmPickerField(
  label: String,
  options: List<CrmPickOption>,
  selected: String?,
  modifier: Modifier = Modifier,
  selectedLabel: String? = null,
  noneLabel: String = "None",
  supporting: String? = null,
  isError: Boolean = false,
  enabled: Boolean = true,
  onPick: (String?) -> Unit,
) {
  var open by remember { mutableStateOf(false) }
  val shown = selected?.let { key -> options.firstOrNull { it.key == key }?.label ?: selectedLabel ?: label } ?: noneLabel
  Box(modifier.fillMaxWidth()) {
    OutlinedTextField(
      value = shown,
      onValueChange = {},
      readOnly = true,
      enabled = enabled,
      label = { Text(label) },
      isError = isError,
      supportingText = supporting?.let { { Text(it) } },
      trailingIcon = { Icon(AglynIcons.named("expand_more"), contentDescription = null) },
      singleLine = true,
      modifier = Modifier.fillMaxWidth(),
    )
    // The field itself is read-only: a press anywhere on it opens the choices.
    Box(
      Modifier.matchParentSize()
        .clickable(enabled = enabled, interactionSource = remember { MutableInteractionSource() }, indication = null) { open = true }
        .semantics { contentDescription = "$label: $shown" },
    )
  }
  if (open) {
    CrmPickerDialog(label, options, selected, noneLabel, onDismiss = { open = false }) { key ->
      open = false
      onPick(key)
    }
  }
}

@Composable
private fun CrmPickerDialog(title: String, options: List<CrmPickOption>, selected: String?, noneLabel: String, onDismiss: () -> Unit, onPick: (String?) -> Unit) {
  var query by remember { mutableStateOf("") }
  val words = query.trim()
  val shown = if (words.isEmpty()) options else options.filter { it.label.contains(words, ignoreCase = true) }
  Dialog(onDismissRequest = onDismiss, properties = sheetDialogProperties()) {
    Surface(Modifier.fillMaxWidth(0.94f).heightIn(max = 620.dp).testTag("crm-picker"), shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surface) {
      Column(Modifier.padding(vertical = space(2f))) {
        Text(title, Modifier.padding(horizontal = space(3f)).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
        SearchField(query, { query = it }, placeholder = "Search", modifier = Modifier.padding(horizontal = space(2f), vertical = space(1f)))
        LazyColumn(Modifier.weight(1f, fill = false)) {
          if (words.isEmpty()) item { PickerRow(noneLabel, selected == null, "crm-picker-none") { onPick(null) } }
          var group: String? = null
          shown.forEach { option ->
            if (option.group != group) {
              group = option.group
              if (option.group.isNotEmpty()) {
                item(key = "group-${option.group}") {
                  Text(
                    option.group,
                    Modifier.padding(start = space(3f), end = space(3f), top = space(1.5f), bottom = space(0.5f)).semantics { heading() },
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                  )
                }
              }
            }
            item(key = option.key) { PickerRow(option.label, option.key == selected, "crm-picker-${option.key}") { onPick(option.key) } }
          }
          if (shown.isEmpty() && words.isNotEmpty()) item { Text("No options", Modifier.padding(horizontal = space(3f), vertical = space(1.5f)), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        HorizontalDivider()
        Row(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)), horizontalArrangement = Arrangement.End) {
          TextButton(onClick = onDismiss) { Text("Cancel") }
        }
      }
    }
  }
}

@Composable
private fun PickerRow(label: String, picked: Boolean, tag: String, onClick: () -> Unit) {
  Row(
    Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(onClick = onClick).padding(horizontal = space(3f)).testTag(tag),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    if (picked) Icon(AglynIcons.named("check"), contentDescription = "Picked", tint = MaterialTheme.colorScheme.primary)
  }
}
