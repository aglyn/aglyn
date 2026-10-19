package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import com.aglyn.core.SignUpRules
import com.aglyn.core.answer
import com.aglyn.core.pendingInvites
import com.aglyn.core.WorkspaceName
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.launch

/**
 * What an account with no workspace sees (the console's workspace chooser with nothing in it): the workspace its sign-up asked
 * for being created, the notice when that failed with the name offered back, and creating one.
 */
@Composable
internal fun FirstRunContent(services: ShellServices) {
  val flow = services.authFlow
  var creating by remember { mutableStateOf(false) }
  var name by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  var invites by remember { mutableStateOf<List<com.aglyn.core.PendingInvite>>(emptyList()) }
  var answering by remember { mutableStateOf<String?>(null) }
  var inviteError by remember { mutableStateOf<String?>(null) }
  androidx.compose.runtime.LaunchedEffect(Unit) { invites = services.signUp.pendingInvites() }

  fun answer(invite: com.aglyn.core.PendingInvite, accept: Boolean) {
    answering = invite.id
    inviteError = null
    scope.launch {
      try {
        services.signUp.answer(invite, accept)
        invites = invites.filterNot { it.id == invite.id }
        if (accept) services.workspace.selectOrg(invite.orgId)
      } catch (failure: kotlinx.coroutines.CancellationException) {
        throw failure
      } catch (failure: Throwable) {
        inviteError = failure.message ?: if (accept) "Accepting the invite failed" else "Declining the invite failed"
      } finally {
        answering = null
      }
    }
  }

  Column(verticalArrangement = Arrangement.spacedBy(space(2f))) {
    // A pending invite is the reason this person just signed up — lead with it rather than creating a workspace (AGL-851).
    // The invite email's link opens the app here.
    if (invites.isNotEmpty() && flow.firstRun != FirstRunState.Provisioning) {
      Text("You've been invited", style = MaterialTheme.typography.titleLarge)
      Text(
        "Accept your invitation to join the workspace, or start your own instead.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      for (invite in invites) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          Text(invite.sentence, Modifier.weight(1f))
          TextButton(onClick = { answer(invite, false) }, enabled = answering == null) { Text("Decline") }
          Button(shape = com.aglyn.ui.controlShape(), onClick = { answer(invite, true) }, enabled = answering == null, modifier = Modifier.testTag("first-run-accept-${invite.id}")) {
            Text(if (answering == invite.id) "Joining…" else "Accept")
          }
        }
      }
      inviteError?.let { AuthErrorText(it) }
    }
    when (val state = flow.firstRun) {
      FirstRunState.Provisioning -> Row(
        Modifier.fillMaxWidth().padding(space(4f)),
        horizontalArrangement = Arrangement.spacedBy(space(1f), Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        CircularProgressIndicator()
        Text("Setting up your workspace…", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      is FirstRunState.Failed -> {
        NoticeBanner(
          "We couldn’t create your workspace “${state.name}” during sign-up${state.error?.let { " — $it" } ?: ""}. " +
            "Your account is ready; the workspace still needs creating.",
          StatusTone.WARNING,
          action = {
            TextButton(onClick = { name = state.name; creating = true }, modifier = Modifier.testTag("first-run-retry")) { Text("Create it now") }
          },
        )
        Empty(services) { creating = true }
      }
      FirstRunState.Idle -> Empty(services) { creating = true }
    }
  }

  if (creating) {
    ActionDialog(
      title = "Create an organization",
      confirmLabel = "Create",
      onConfirm = {
        if (SignUpRules.organization(name) != null) return@ActionDialog
        busy = true
        error = null
        scope.launch {
          val failure = services.createWorkspace(name)
          busy = false
          if (failure == null) creating = false else error = failure
        }
      },
      onDismiss = { creating = false },
      busy = busy,
      error = error,
      confirmEnabled = SignUpRules.organization(name) == null,
      dismissLabel = "Cancel",
    ) {
      AuthTextField(
        "Organization name", name, { name = it }, "first-run-organization",
        error = if (name.isNotBlank()) SignUpRules.organization(name) else null,
        supporting = WorkspaceName.helper(services.config.workspaceDomain),
      )
    }
  }
}

@Composable
private fun Empty(services: ShellServices, onCreate: () -> Unit) {
  EmptyState(
    "No workspaces yet",
    body = "A workspace is your organization: its sites, team, billing and plan live together.",
    icon = AglynIcons.named("workspaces"),
    action = { Button(shape = com.aglyn.ui.controlShape(), onClick = onCreate, modifier = Modifier.testTag("first-run-create")) { Text("Create an organization") } },
  )
}
