// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The console's "Newest site users" card on a site's dashboard (newest-site-users-card.component.tsx, AGL-4011): the
/// five newest visitor accounts (`hosts/{id}/siteMembers`, newest first), each its name or address and the day it
/// joined; View all opens the site's users. Drawn only while the site has visitor accounts on (the `accounts` switch the
/// console registers the card under), whatever else commerce has on. The Kotlin twin is `NewestSiteUsersCard.kt`.
struct NewestSiteUsersCard: View {
  let context: NativePluginContext
  @State private var org = ObservedDocument()
  @State private var host = ObservedDocument()
  @State private var members = LiveQueryList(pageSize: 5) { $0 }

  /// The site's accounts switch (`ACCOUNTS_PLUGIN_ID`), read the way the console's slot reads it.
  private var accountsOn: Bool {
    guard org.ready, host.ready else { return false }
    func ids(_ doc: FirestoreDocument?, _ key: String) -> [String]? { (doc?.data[key] as? [Any])?.compactMap { $0 as? String } }
    return resolveHostEnabledPlugins(
      orgEnabled: ids(org.document, "enabledPlugins"), hostDisabled: ids(host.document, "disabledPlugins"),
      hostEnabled: ids(host.document, "enabledPlugins")
    ).contains("accounts")
  }

  var body: some View {
    VStack(spacing: 0) {
      if accountsOn {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          HStack(alignment: .firstTextBaseline) {
            Text("Newest site users").font(AglynFont.headline).accessibilityAddTraits(.isHeader)
            Spacer(minLength: AglynSpace.one)
            Button("View all") { context.navigate("core.site.users") }
              .buttonStyle(.borderless).foregroundStyle(AglynColor.tint)
              .accessibilityIdentifier("newest-site-users-all")
          }
          if members.ready && members.rows.isEmpty {
            Text("No site accounts yet — they appear when visitors sign up on your site.")
              .font(AglynFont.subheadline).foregroundStyle(.secondary)
          } else {
            ForEach(members.rows, id: \.id) { member in
              HStack(spacing: AglynSpace.one) {
                Text(member.string("displayName") ?? member.string("name") ?? member.string("email") ?? member.id)
                  .font(AglynFont.subheadline).lineLimit(1)
                Spacer(minLength: AglynSpace.one)
                if let joined = member.date("createdAt") {
                  Text(joined.formatted(date: .numeric, time: .omitted)).font(AglynFont.caption).foregroundStyle(.secondary)
                }
              }
              .accessibilityElement(children: .combine)
            }
          }
        }
        .padding(AglynSpace.two)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .aglynCardSurface()
        .accessibilityIdentifier("newest-site-users")
      }
    }
    .task(id: "\(context.orgID ?? ""):\(context.hostID ?? "")") {
      guard let orgID = context.orgID, let hostID = context.hostID else { return }
      org.start(context.firestore, ["orgs", orgID])
      host.start(context.firestore, ["hosts", hostID])
      members.show(context.firestore) { _ in
        FirestoreQuery(["hosts", hostID, "siteMembers"], order: [.init("createdAt", descending: true)], limit: 5)
      }
    }
    .onDisappear {
      org.stop()
      host.stop()
      members.stop()
    }
  }
}
