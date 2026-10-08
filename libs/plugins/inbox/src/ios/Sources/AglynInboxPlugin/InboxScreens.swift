// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

func inboxMessage(_ error: Error) -> String {
  (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Try again."
}

/// Picks one of the workspace's email lists for the sender, as the console's list card does.
struct ListAssignmentSheet: View {
  let row: Submission
  let actions: InboxActions
  let onDone: (String) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var options: ListOptions?
  @State private var loadError: String?
  @State private var listID = ""
  @State private var attest = false
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        if let options {
          if let summary = options.summary { Text(summary).foregroundStyle(.secondary) }
          if options.lists.isEmpty {
            Text("There are no lists yet. Make one under Email, Audiences.")
          } else if !options.enrollable {
            Text(options.summary ?? "This sender cannot be added to a list.")
          } else {
            Picker("List", selection: $listID) {
              Text("Choose").tag("")
              ForEach(options.lists) { Text($0.name).tag($0.id) }
            }
            if options.truncated { Text("Showing the first \(options.lists.count) lists.").font(AglynFont.caption) }
            if options.requiresAttestation {
              Toggle("They agreed to hear from us", isOn: $attest)
            }
          }
        } else if let loadError {
          Text(loadError).foregroundStyle(AglynColor.error)
        } else {
          SkeletonRows(count: 2)
        }
        if let error { Text(error).foregroundStyle(AglynColor.error) }
      }
      .formStyle(.grouped)
      .navigationTitle("Add to a marketing list")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
        ToolbarItem(placement: .confirmationAction) {
          Button("Add") { Task { await add() } }
            .disabled(busy || listID.isEmpty || options?.enrollable != true || (options?.requiresAttestation == true && !attest))
        }
      }
      .task {
        do { options = try await actions.listOptions(row.id) } catch { loadError = inboxMessage(error) }
      }
    }
    .frame(minWidth: 360, minHeight: 300)
  }

  private func add() async {
    busy = true
    error = nil
    defer { busy = false }
    do {
      let name = try await actions.assignList(row.id, listID: listID, attest: attest)
      onDone("Added to \(name ?? "the list").")
      dismiss()
    } catch {
      self.error = inboxMessage(error)
    }
  }
}

/// The site's members and the leads it may see; a lead opens in the CRM.
struct PeopleScreen: View {
  let context: NativePluginContext
  @State private var tab = "members"
  @State private var members = LiveQueryList(pageSize: 25, map: siteMember)
  @State private var leads = LiveQueryList(pageSize: 25, map: leadRow)
  @State private var site = SiteRoleModel()
  @State private var searchText = ""
  @State private var search = ""
  @State private var removing: SiteMemberRow?
  @State private var error: String?

  var body: some View {
    VStack(spacing: 0) {
      Picker("Show", selection: $tab) {
        Text("Site members").tag("members")
        Text("Leads").tag("leads")
      }
      .pickerStyle(.segmented)
      .padding(AglynSpace.two)
      if let error { AglynNotice(error, tone: .error) { self.error = nil }.padding(.horizontal, AglynSpace.two) }
      if tab == "members" { membersList } else { leadsList }
    }
    .background(AglynColor.page)
    .navigationTitle("Members & leads")
    .onDisappear {
      members.stop()
      leads.stop()
      site.stop()
    }
    .searchable(text: $searchText, prompt: tab == "members" ? "Search members" : "Search leads")
    .onSubmit(of: .search) { search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { search = "" } }
    .task(id: "\(tab)|\(search)|\(context.hostID ?? "")") {
      site.start(context)
      guard let hostID = context.hostID else { return }
      let search = search
      if tab == "members" {
        members.show(context.firestore) { siteMembersQuery(hostID, search: search, limit: $0) }
      } else if let orgID = context.orgID {
        leads.show(context.firestore) { siteLeadsQuery(orgID: orgID, hostID: hostID, search: search, limit: $0) }
      }
    }
    .confirmationDialog(
      "Remove \(removing?.name ?? "this member")?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
      titleVisibility: .visible
    ) {
      Button("Remove", role: .destructive) {
        guard let member = removing, let hostID = context.hostID else { return }
        Task {
          do {
            try await InboxActions(api: context.api, reader: context.firestore, hostID: hostID).removeMember(member.id)
          } catch {
            self.error = inboxMessage(error)
          }
        }
      }
    } message: {
      Text("They lose their account on this site. Their past orders and messages stay.")
    }
  }

  private var canRemove: Bool { ["owner", "admin"].contains(site.role ?? "") }

  @ViewBuilder
  private var membersList: some View {
    if !members.ready {
      List { SkeletonRows(count: 6) }.aglynListBackground()
    } else if let failure = members.failure {
      AglynEmptyState("Could not load members", systemImage: "exclamationmark.triangle", message: failure)
    } else if members.rows.isEmpty {
      AglynEmptyState("No members yet", systemImage: "person.2", message: "People who sign up on the site show up here.")
    } else {
      List {
        ForEach(members.rows) { member in
          AglynRow(
            member.name,
            subtitle: [member.email == member.name ? nil : member.email, member.joinedAt.map { "Joined \(relativeTime($0))" }]
              .compactMap { $0 }.joined(separator: " · "),
            systemImage: "person"
          ) {
            if canRemove {
              Button("Remove") { removing = member }.buttonStyle(.borderless)
                .accessibilityIdentifier("member-remove-\(member.id)")
            }
          }
          .aglynListRow()
        }
        if members.hasMore { Button("Show more") { members.loadMore() }.frame(maxWidth: .infinity) }
      }
      .refreshable { members.retry() }
      .aglynListBackground()
    }
  }

  @ViewBuilder
  private var leadsList: some View {
    if !leads.ready {
      List { SkeletonRows(count: 6) }.aglynListBackground()
    } else if let failure = leads.failure {
      AglynEmptyState("Could not load leads", systemImage: "exclamationmark.triangle", message: failure)
    } else if leads.rows.isEmpty {
      AglynEmptyState("No leads yet", systemImage: "person.badge.plus", message: "People your forms capture as leads show up here.")
    } else {
      List {
        ForEach(leads.rows) { lead in
          Button {
            context.navigate("crm.lead", ["lead": lead.id])
          } label: {
            AglynRow(
              lead.name, subtitle: [lead.email == lead.name ? nil : lead.email, lead.company].compactMap { $0 }.joined(separator: " · "),
              systemImage: "person.badge.plus"
            ) {
              if let status = lead.statusLabel { StatusChip(status) }
            }
          }
          .buttonStyle(.plain)
          .aglynListRow()
          .accessibilityIdentifier("lead-\(lead.id)")
        }
        if leads.hasMore { Button("Show more") { leads.loadMore() }.frame(maxWidth: .infinity) }
      }
      .refreshable { leads.retry() }
      .aglynListBackground()
    }
  }
}

/// Home's Inbox card: unread among the newest messages, as the console's glance card counts them.
struct InboxGlanceWidget: View {
  let context: NativePluginContext
  @State private var list = LiveQueryList(pageSize: 3, map: Submission.init)

  var body: some View {
    let unread = list.ready && list.failure == nil ? list.rows.filter { !$0.read }.count : nil
    MetricCard(
      "Inbox", systemImage: "tray", tone: .info, value: unread.map(String.init),
      caption: list.rows.isEmpty
        ? "No messages yet"
        : unread == 0 ? "All caught up" : list.hasMore ? "unread here, more in the Inbox" : unread == 1 ? "unread message" : "unread messages",
      actionLabel: "Open the Inbox", failed: list.failure.map { _ in "Could not load the Inbox." }
    ) {
      context.navigate(inboxSubmissionsScreen)
    }
    .task(id: context.hostID) {
      guard let hostID = context.hostID else { return }
      list.show(context.firestore) {
        submissionsPlan(formID: nil, read: nil, search: "").firestoreQuery(submissionsPath(hostID), limit: $0)
      }
    }
    .onDisappear { list.stop() }
  }
}
