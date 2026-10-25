// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// What an invitee sees of an invitation (AGL-4023): it joins on its own, so there is never an Accept or a Decline.
/// While it joins, "Joining Acme…"; when the server has not let it finish, the console's neutral "almost ready"
/// (`WorkspaceAccessPending`), with no reason and nothing to choose: the inviter has been told and fixes it.
struct InviteJoinStatus: View {
  let invite: PendingInvite
  let joining: Bool

  private var name: String { invite.orgName ?? "this workspace" }

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      if joining {
        HStack(spacing: AglynSpace.one) {
          ProgressView().controlSize(.small)
          Text("Joining \(name)…").font(AglynFont.headline)
        }
      } else {
        Text("Your access to \(name) is almost ready").font(AglynFont.headline)
        Text("You have been invited, and nothing is needed from you.").font(AglynFont.subheadline)
        Text("\(name)'s admins have been asked to finish setting up your access. It opens on its own once they have.")
          .font(AglynFont.subheadline).foregroundStyle(AglynColor.secondaryText)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("invite-status-\(invite.id)")
  }
}

/// The invitations still on their way for the signed-in person (joining, or almost ready), as cards.
struct InviteJoinList: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    if let invites = model.invites, !(invites.joining.isEmpty && invites.waiting.isEmpty) {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        ForEach(invites.joining + invites.waiting) { invite in
          InviteJoinStatus(invite: invite, joining: invites.statuses[invite.id] == .joining)
            .padding(AglynSpace.one)
            .background(AglynColor.paper, in: RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous))
        }
      }
    }
  }
}
