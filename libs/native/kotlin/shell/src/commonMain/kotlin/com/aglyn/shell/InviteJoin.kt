package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aglyn.core.AuthState
import com.aglyn.core.InviteJoinStatus
import com.aglyn.core.PendingInvite
import com.aglyn.ui.SectionCard
import com.aglyn.ui.space

/**
 * Joins every invitation waiting for the signed-in person, as the console does on every load (AGL-4023): once their address
 * is confirmed (the server lists none before), never during a support session. A workspace joined while none is open opens.
 */
@Composable
internal fun InviteJoinEffect(services: ShellServices) {
  val auth by services.auth.state.collectAsState()
  val impersonation by services.auth.impersonation.collectAsState()
  val user = (auth as? AuthState.SignedIn)?.user
  LaunchedEffect(user?.uid, user?.emailVerified, impersonation) {
    val uid = user?.uid ?: return@LaunchedEffect
    if (!user.emailVerified) return@LaunchedEffect
    val joined = services.inviteJoin.run(uid, impersonating = impersonation != null)
    val first = joined.firstOrNull() ?: return@LaunchedEffect
    if (services.workspace.state.value.org == null) services.workspace.selectOrg(first)
  }
}

/**
 * What an invitee sees of an invitation (AGL-4023): it joins on its own, so there is never an Accept or a Decline. While it
 * joins, "Joining Acme…"; when the server has not let it finish, the console's neutral "almost ready"
 * (`WorkspaceAccessPending`), with no reason and nothing to choose: the inviter has been told and fixes it.
 */
@Composable
internal fun InviteJoinStatusText(invite: PendingInvite, joining: Boolean) {
  val name = invite.orgName ?: "this workspace"
  Column(Modifier.fillMaxWidth().testTag("invite-status-${invite.id}"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    if (joining) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        Text("Joining $name…", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
      }
    } else {
      Text("Your access to $name is almost ready", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
      Text("You have been invited, and nothing is needed from you.", style = MaterialTheme.typography.bodyMedium)
      Text(
        "$name's admins have been asked to finish setting up your access. It opens on its own once they have.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}

/** The invitations still on their way for the signed-in person (joining, or almost ready), as cards. */
@Composable
internal fun InviteJoinList(services: ShellServices) {
  val state by services.inviteJoin.state.collectAsState()
  val shown = state.joining + state.waiting
  if (shown.isEmpty()) return
  Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
    for (invite in shown) {
      SectionCard(null) { InviteJoinStatusText(invite, state.statuses[invite.id] == InviteJoinStatus.JOINING) }
    }
  }
}
