// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

#if os(iOS)
  import UIKit
#endif

// The two pickers, workspace then site (AGL-3945, Figma Menus 2:4 and Phone 2:7): search first, then Pinned, Recent and
// everyone else A to Z, 50 at a time. Pins are the account's (`pinnedOrgs`), shared with the console, five at most.

/// How many rows a picker shows before "Show more".
let pickerPage = 50

/// The picker sheet: the workspace step, then the site step. On a phone it is the scope chip's two-step picker; on iPad
/// and the Mac the All workspaces tile opens it on the workspace step, and the site button on the site step.
struct ScopePickerSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Environment(\.dismiss) private var dismiss
  let start: ShellPicker
  /// Whether picking a workspace goes on to its sites (the phone's two steps) or opens the whole workspace.
  var twoStep = false
  var siteNoun = "Site"
  @State private var path: [ShellPicker] = []

  var body: some View {
    NavigationStack(path: $path) {
      root
        .navigationDestination(for: ShellPicker.self) { _ in sitePicker }
    }
    #if os(macOS)
      .aglynSheetMinimumSize(width: 440, height: 560)
    #endif
    .onAppear {
      if twoStep && start == .site { path = [.site] }
    }
  }

  @ViewBuilder
  private var root: some View {
    if start == .site && !twoStep {
      sitePicker
    } else {
      WorkspacePickerList(twoStep: twoStep) { orgID in
        if twoStep {
          path = [.site]
        } else {
          navigation.enterWorkspace()
          dismiss()
        }
        _ = orgID
      }
      .navigationTitle(twoStep ? "Switch" : "Workspaces")
      .toolbar { doneButton }
    }
  }

  private var sitePicker: some View {
    SitePickerList(siteNoun: siteNoun) { dismiss() }
      .navigationTitle(model.workspace?.org?.name ?? "Sites")
      .toolbar { doneButton }
  }

  private var doneButton: some ToolbarContent {
    ToolbarItem(placement: .confirmationAction) {
      Button("Done") { dismiss() }.accessibilityIdentifier("picker-done")
    }
  }
}

/// A workspace picked in the switcher is open at once, from its Home, whatever mode or pushed screen the window was in:
/// as the rail, ⌘1–⌘5 and the one box open one. The phone's next step, its sites, only narrows it to a site, so closing
/// the sheet there leaves the new workspace in front rather than the old one's pushed screen.
@MainActor
func openPickedWorkspace(_ orgID: String, in workspace: WorkspaceStore?, navigation: ShellNavigation) {
  workspace?.open(orgID: orgID)
  navigation.enterWorkspace()
}

/// The pin as Figma draws it (the phone picker 21:2, Switcher/Workspace row 15:691): Pin is an outlined (secondary)
/// button, never the platform's `.bordered` glass with its bright rim in dark mode; Pinned is its label alone, in the
/// secondary text color.
private struct PinButtonLook: ViewModifier {
  let pinned: Bool

  func body(content: Content) -> some View {
    if pinned {
      // In the phone's bold look the pinned state reads in the accent's text shade (Figma Phone picker 21:2, AGL-3990).
      content.buttonStyle(.plain).foregroundStyle(AglynThemeRuntime.shared.phoneBold ? AglynColor.tint : AglynColor.secondaryText)
    } else {
      content.buttonStyle(.aglynSecondary)
    }
  }
}

/// One workspace row: its tile, name, role and plan, and the pin.
private struct WorkspacePickerRow: View {
  /// A phone, where the ⌘1–⌘5 shortcuts are not shown.
  static var isPhone: Bool {
    #if os(iOS)
      UIDevice.current.userInterfaceIdiom == .phone
    #else
      false
    #endif
  }

  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let org: WorkspaceOrg
  let pickAction: () -> Void

  var body: some View {
    let preferences = model.preferences
    let pinIndex = preferences?.pinned.firstIndex(of: org.id)
    let logo = model.workspace?.orgLogos[org.id]
    let subtitle = [org.role.capitalized, logo?.planLabel].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · ")
    HStack(spacing: 10) {
      Button(action: pickAction) {
        HStack(spacing: 10) {
          AglynWorkspaceTile(
            name: org.name, logoURL: model.mediaURL(logo?.light, hostID: nil),
            darkLogoURL: model.mediaURL(logo?.dark, hostID: nil), colorHex: model.workspaceColor(org.id).color,
            selected: false, size: 28)
          VStack(alignment: .leading, spacing: 1) {
            Text(org.name).font(AglynFont.body).lineLimit(1)
            if !subtitle.isEmpty { Text(subtitle).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(1) }
          }
          Spacer(minLength: 4)
          if org.id == model.workspace?.org?.id {
            Image(systemName: "checkmark").foregroundStyle(AglynColor.tint).fontWeight(.semibold).accessibilityHidden(true)
          }
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.aglynRow)
      .accessibilityAddTraits(org.id == model.workspace?.org?.id ? .isSelected : [])
      .accessibilityIdentifier("picker-org-\(org.id)")
      Button {
        guard let preferences else { return }
        if pinIndex != nil {
          preferences.unpin(org.id)
        } else if preferences.pin(org.id) == .full {
          navigation.pinFull = PendingPin(orgID: org.id, name: org.name)
        }
      } label: {
        HStack(spacing: 4) {
          Image(systemName: pinIndex != nil ? "pin.fill" : "pin")
          Text(pinIndex != nil ? "Pinned" : "Pin")
          // The keyboard shortcut, where there is a keyboard to press it (not on a phone).
          if let pinIndex, !Self.isPhone {
            Text("⌘\(pinIndex + 1)").font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
        .font(AglynFont.caption)
      }
      .modifier(PinButtonLook(pinned: pinIndex != nil))
      .controlSize(.small)
      .accessibilityLabel(pinIndex != nil ? "Unpin \(org.name)" : "Pin \(org.name)")
      .accessibilityIdentifier("picker-pin-\(org.id)")
    }
  }
}

/// The workspace step: search, Pinned (n of 5), Recent, then everyone else A to Z, 50 at a time, and Add workspace.
struct WorkspacePickerList: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let twoStep: Bool
  let picked: (String) -> Void
  @State private var query = ""
  @State private var shown = pickerPage
  @State private var adding = false

  var body: some View {
    Group {
      if let workspace = model.workspace {
        content(workspace)
          .task(id: workspace.orgs.map(\.id)) { workspace.loadLogos(workspace.orgs.map(\.id)) }
          .task(id: model.preferences?.pinned ?? []) {
            workspace.loadOrgs((model.preferences?.pinned ?? []) + (model.preferences?.recentOrgs ?? []))
          }
      } else {
        ProgressView()
      }
    }
    .aglynSearchable(text: $query, prompt: "Find a workspace")
    .sheet(isPresented: $adding) { AddWorkspaceSheet { adding = false } }
  }

  private func content(_ workspace: WorkspaceStore) -> some View {
    let pinned = (model.preferences?.pinned ?? []).compactMap { id in workspace.orgs.first { $0.id == id } }
    let pinnedIDs = Set(pinned.map(\.id))
    let recent = (model.preferences?.recentOrgs ?? []).filter { !pinnedIDs.contains($0) }
      .compactMap { id in workspace.orgs.first { $0.id == id } }.prefix(ContractValues.shared.railRecentOrgs)
    let listed = pinnedIDs.union(recent.map(\.id))
    let rest = workspace.orgs.filter { !listed.contains($0.id) }
    let total = workspace.orgCount ?? workspace.orgs.count
    let matches = matching(workspace.orgs)
    return List {
      if let matches {
        Section(matches.isEmpty ? "No workspace matches" : "Workspaces") {
          ForEach(matches) { row($0) }
          if workspace.hasMoreOrgs {
            Text("Searching the \(workspace.orgs.count) workspaces loaded so far.")
              .font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
      } else {
        if !workspace.ready && workspace.orgs.isEmpty { SkeletonRows(count: 3) }
        if !pinned.isEmpty {
          Section("Pinned \(pinned.count) of \(ContractValues.shared.pinnedOrgsMax)") { ForEach(pinned) { row($0) } }
        }
        if !recent.isEmpty { Section("Recent") { ForEach(Array(recent)) { row($0) } } }
        if !rest.isEmpty {
          Section("All workspaces · \(total)") {
            ForEach(Array(rest.prefix(shown))) { row($0) }
            if rest.count > shown || workspace.hasMoreOrgs {
              AglynLoadMoreRow("Show more · \(min(shown, rest.count) + listed.count) of \(total)") {
                if rest.count > shown { shown += pickerPage } else { workspace.loadMoreOrgs() }
              }
              .accessibilityIdentifier("switcher-more-orgs")
            }
          }
        }
      }
      Section {
        Button {
          adding = true
        } label: {
          Label("Add workspace", systemImage: "plus")
        }
        .accessibilityIdentifier("picker-add-workspace")
      }
    }
    #if os(iOS)
      .listStyle(.insetGrouped)
    #endif
    .scrollContentBackground(.hidden)
    .background(AglynColor.page)
  }

  private func row(_ org: WorkspaceOrg) -> some View {
    WorkspacePickerRow(org: org) {
      openPickedWorkspace(org.id, in: model.workspace, navigation: navigation)
      picked(org.id)
    }
  }

  /// The loaded workspaces matching what was typed, ranked the console's way; nil with nothing typed.
  private func matching(_ orgs: [WorkspaceOrg]) -> [WorkspaceOrg]? {
    let text = query.trimmingCharacters(in: .whitespaces)
    guard !text.isEmpty else { return nil }
    return orgs.compactMap { org in scoreMatch(name: org.name, extra: [org.slug], query: text).map { (org, $0) } }
      .sorted { scoredFirst(($0.1, $0.0.name), ($1.1, $1.0.name)) }.map(\.0)
  }
}

/// The site step: search, Recent (sites opened lately), every site A to Z, the whole workspace, View all sites and
/// Create site.
struct SitePickerList: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  var siteNoun = "Site"
  let done: () -> Void
  @State private var query = ""
  @State private var shown = pickerPage

  var body: some View {
    Group {
      if let workspace = model.workspace { content(workspace) } else { ProgressView() }
    }
    .aglynSearchable(text: $query, prompt: "Find a \(siteNoun.lowercased())")
  }

  private func content(_ workspace: WorkspaceStore) -> some View {
    let recentIDs = recentSiteIDs(workspace)
    let recent = recentIDs.compactMap { id in workspace.sites.first { $0.id == id } }
    let others = workspace.sites.filter { !recentIDs.contains($0.id) }
    let text = query.trimmingCharacters(in: .whitespaces)
    let matches = text.isEmpty
      ? nil
      : workspace.sites.compactMap { site in
        scoreMatch(name: site.name, extra: [site.subdomain], query: text).map { (site, $0) }
      }.sorted { scoredFirst(($0.1, $0.0.name), ($1.1, $1.0.name)) }.map(\.0)
    return List {
      if !workspace.ready { SkeletonRows(count: 3) }
      if let matches {
        Section(matches.isEmpty ? "No \(siteNoun.lowercased()) matches" : "\(siteNoun)s") { ForEach(matches) { row($0) } }
      } else {
        if workspace.ready && workspace.sites.isEmpty {
          Text("This workspace has no \(siteNoun.lowercased())s you can open.").foregroundStyle(.secondary)
        }
        if !recent.isEmpty { Section("Recent") { ForEach(recent) { row($0) } } }
        if !others.isEmpty {
          Section(recent.isEmpty ? "\(siteNoun)s" : "All \(siteNoun.lowercased())s") {
            ForEach(Array(others.prefix(shown))) { row($0) }
            if others.count > shown {
              AglynLoadMoreRow("Show more") { shown += pickerPage }
            }
          }
        }
      }
      if model.app == .aglyn {
        Section {
          Button {
            navigation.enterWorkspace()
            done()
          } label: {
            AglynRow("The whole workspace", subtitle: "Sites, CRM, Inbox, Media, Data…", systemImage: "square.grid.2x2")
          }
          .buttonStyle(.aglynRow)
          .accessibilityIdentifier("picker-whole-workspace")
          Button {
            navigation.enterWorkspace()
            navigation.select(.plugin("site.sites"))
            done()
          } label: {
            Label("View all sites", systemImage: "square.grid.2x2")
          }
          .accessibilityIdentifier("picker-view-all-sites")
        }
      }
    }
    #if os(iOS)
      .listStyle(.insetGrouped)
    #endif
    .scrollContentBackground(.hidden)
    .background(AglynColor.page)
  }

  private func row(_ site: WorkspaceSite) -> some View {
    Button {
      model.workspace?.selectSite(site.id)
      navigation.enterSite()
      done()
    } label: {
      AglynRow(
        site.name, subtitle: site.shownAddress, systemImage: "globe",
        imageURL: model.mediaURL(site.favicon, hostID: site.id)
      ) {
        if site.id == model.scopedSite(navigation)?.id {
          Image(systemName: "checkmark").foregroundStyle(AglynColor.tint).fontWeight(.semibold).accessibilityHidden(true)
        }
      }
    }
    .buttonStyle(.aglynRow)
    .accessibilityIdentifier("switcher-site-\(site.id)")
    .accessibilityAddTraits(site.id == model.scopedSite(navigation)?.id ? .isSelected : [])
  }

  private func recentSiteIDs(_ workspace: WorkspaceStore) -> [String] { model.recentSiteIDs(in: workspace) }
}

extension AppModel {
  /// The sites opened most lately, newest first: the one open, then the account's recents (`recents` with a site).
  func recentSiteIDs(in workspace: WorkspaceStore, limit: Int = 3) -> [String] {
    var seen = Set<String>()
    var out: [String] = []
    if let current = workspace.site?.id { seen.insert(current); out.append(current) }
    for item in preferences?.recents ?? [] where item.orgId == workspace.org?.id {
      if out.count >= limit { break }
      if let hostID = item.hostId, seen.insert(hostID).inserted { out.append(hostID) }
    }
    return out
  }
}

/// Add workspace: the invitations waiting for this person, then creating one.
struct AddWorkspaceSheet: View {
  @Environment(AppModel.self) private var model
  let done: () -> Void
  @State private var creating = false

  var body: some View {
    if creating {
      CreateWorkspaceSheet(name: "") { done() }
    } else {
      NavigationStack {
        Form {
          // Invitations join on their own (AGL-4023): the ones still on their way, never an Accept.
          if let invites = model.invites, !(invites.joining.isEmpty && invites.waiting.isEmpty) {
            Section("Invitations") {
              ForEach(invites.joining + invites.waiting) { invite in
                InviteJoinStatus(invite: invite, joining: invites.statuses[invite.id] == .joining)
              }
            }
          }
          Section {
            Button("Create a workspace", systemImage: "plus") { creating = true }
              .accessibilityIdentifier("add-workspace-create")
          } footer: {
            Text("A workspace is your organization: its sites, team, billing and plan live together.")
          }
        }
        .formStyle(.grouped)
        .navigationTitle("Add workspace")
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { done() } } }
        .task { await model.joinInvites() }
      }
      .aglynSheetMinimumSize(width: 420, height: 300)
    }
  }
}
