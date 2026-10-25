// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

// The CRM's dashboard cards (AGL-4011), the console's `CrmGlanceCard` and `CrmTasksDueCard`: on a site's Home they read
// the site's group, on the workspace's Home (the console's `orgDashboard` row) they total every site. The Kotlin twin is
// `CrmGlance.kt`.

/// The console's `orgDashboard` slot: the workspace Home's row of cards that total every site.
public let crmOrgDashboardSlot = "orgDashboard"

/// The five figures of "CRM at a glance".
struct CrmGlanceFigures: Equatable {
  var contacts: Int
  var newThisWeek: Int
  var pipelineCents: Double
  var tasksDue: Int
  var leadsToWork: Int
}

/// "CRM at a glance": contacts, new this week, the open pipeline, tasks due today or overdue, and leads still to work,
/// each a server count or sum over the same scope the hub's sections read, each opening its section.
struct CrmAtAGlanceCard: View {
  let context: NativePluginContext
  /// The workspace's CRM: every site's records.
  let orgLevel: Bool
  @State private var scope = CrmScopeModel()
  @State private var figures: CrmGlanceFigures?
  @State private var failed = false

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.two) {
      HStack(alignment: .firstTextBaseline) {
        Text("CRM at a glance").font(AglynFont.headline).accessibilityAddTraits(.isHeader)
        Spacer(minLength: AglynSpace.one)
        Button("Open CRM") { context.navigate(CrmSection.contacts.screen) }
          .buttonStyle(.borderless).foregroundStyle(AglynColor.tint)
          .accessibilityIdentifier("crm-glance-open")
      }
      if scope.scope?.suite == false {
        AglynUpgradeNotice(upgradeNoticeMessage(title: "CRM", feature: "crm"), kind: .plan) { context.navigate("core.billing.plans") }
      } else {
        AglynCardGrid(minimum: AglynSpace.of(14), maxColumns: 5, spacing: AglynSpace.two) {
          figure(figures.map { $0.contacts.formatted() }, "Contacts", section: .contacts)
          figure(figures.map { $0.newThisWeek.formatted() }, "New this week", section: .contacts)
          figure(figures.map { money($0.pipelineCents) }, "Open pipeline", section: .deals)
          figure(figures.map { $0.tasksDue.formatted() }, "Tasks due", note: "today or overdue", section: .tasks)
          figure(
            figures.map { $0.leadsToWork.formatted() }, "Leads to work", note: orgLevel ? "open across every site" : "open on this site",
            section: .leads)
        }
        if failed {
          Text("The CRM figures could not be read. Open the CRM for the full picture.").font(AglynFont.caption)
            .foregroundStyle(.secondary)
        }
      }
    }
    .padding(AglynSpace.two)
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .aglynCardSurface()
    .accessibilityIdentifier(orgLevel ? "crm-org-glance" : "crm-glance")
    .task(id: "\(context.orgID ?? ""):\(context.hostID ?? "")") {
      guard let orgID = context.orgID else { return }
      scope.start(context.firestore, orgID: orgID, hostID: orgLevel ? "" : context.hostID ?? "", uid: context.uid, orgLevel: orgLevel)
    }
    .task(id: scope.scope?.readTokens) {
      guard let current = scope.scope, current.suite else { return }
      await read(current)
    }
    .onDisappear { scope.stop() }
  }

  private func figure(_ value: String?, _ label: String, note: String? = nil, section: CrmSection) -> some View {
    Button {
      context.navigate(section.screen)
    } label: {
      AglynStatTile(failed ? "—" : value, label: label, note: note)
    }
    .buttonStyle(.plain)
  }

  private func money(_ cents: Double) -> String {
    (cents / 100).formatted(.currency(code: "USD").precision(.fractionLength(cents.truncatingRemainder(dividingBy: 100) == 0 ? 0 : 2)))
  }

  private func read(_ scope: CrmScope) async {
    let reader = context.firestore
    let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
    let dayEnd = startOfLocalDay(nowMs) + 86_400_000
    let weekAgo = Date(timeIntervalSince1970: Double(nowMs - 7 * 86_400_000) / 1000)
    // An array-contains-any over nothing is a query Firestore refuses: a member who reaches no site sees zeros.
    if !(scope.orgLevel && scope.readTokens.isEmpty) && scope.readTokens.isEmpty {
      figures = CrmGlanceFigures(contacts: 0, newThisWeek: 0, pipelineCents: 0, tasksDue: 0, leadsToWork: 0)
      return
    }
    do {
      async let contacts = reader.count(scopedQuery(scope, "contacts", limit: 1))
      async let newThisWeek = reader.count(
        scopedQuery(scope, "contacts", filters: [ListQueryConstraint(path: "createdAt", op: .greaterThanOrEqual, value: weekAgo)], limit: 1))
      async let pipeline = reader.sum(
        scopedQuery(scope, "deals", filters: [ListQueryConstraint(path: "status", op: .equal, value: "open")], limit: 1),
        field: "amountCents")
      async let tasksDue = reader.count(
        scopedQuery(
          scope, "crmTasks",
          filters: [
            ListQueryConstraint(path: "status", op: .equal, value: "open"),
            ListQueryConstraint(path: "dueAtMs", op: .lessThan, value: dayEnd),
          ], limit: 1))
      async let leads = reader.count(scopedQuery(scope, "leads", limit: 1))
      async let closed = reader.count(
        scopedQuery(
          scope, "leads", filters: [ListQueryConstraint(path: "status", op: .in, value: ContractValues.shared.crmLeadClosedStatuses.map(\.rawValue))],
          limit: 1))
      let values = try await (contacts, newThisWeek, pipeline, tasksDue, leads, closed)
      figures = CrmGlanceFigures(
        contacts: values.0 ?? 0, newThisWeek: values.1 ?? 0, pipelineCents: values.2 ?? 0, tasksDue: values.3 ?? 0,
        // Every lead less the closed ones: an untouched lead carries no status (`openLeadsFromCounts`).
        leadsToWork: max(0, (values.4 ?? 0) - (values.5 ?? 0)))
      failed = false
    } catch {
      failed = true
    }
  }
}

/// "Tasks due": the member's own overdue and due-today counts and the next five of their open tasks. Nothing at all on a
/// workspace that has never made a task (the console's probe), so the card never flashes in and out.
struct CrmTasksDueCard: View {
  let context: NativePluginContext
  let orgLevel: Bool
  @State private var scope = CrmScopeModel()
  @State private var probe = LiveQueryList(pageSize: 1) { $0.id }
  @State private var mine = LiveQueryList(pageSize: 100, map: crmTask)

  private static let nextUp = 5

  var body: some View {
    VStack(spacing: 0) {
      if probe.ready && !probe.rows.isEmpty {
        card
      }
    }
    .task(id: "\(context.orgID ?? ""):\(context.hostID ?? "")") {
      guard let orgID = context.orgID else { return }
      scope.start(context.firestore, orgID: orgID, hostID: orgLevel ? "" : context.hostID ?? "", uid: context.uid, orgLevel: orgLevel)
    }
    .task(id: scope.scope?.readTokens) {
      guard let current = scope.scope, current.suite else { return }
      probe.show(context.firestore) { _ in
        scopedQuery(current, "crmTasks", filters: [ListQueryConstraint(path: "status", op: .equal, value: "open")], limit: 1)
      }
      let plan = taskViewPlan(.mine, nowMs: Int64(Date().timeIntervalSince1970 * 1000), uid: current.uid)
      mine.show(context.firestore) { tasksQuery(current, plan, search: "", limit: $0) }
    }
    .onDisappear {
      scope.stop()
      probe.stop()
      mine.stop()
    }
  }

  private var card: some View {
    let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
    let today = startOfLocalDay(nowMs)
    let tomorrow = today + 86_400_000
    let overdue = mine.rows.filter { ($0.dueAtMs ?? .max) < today }.count
    let dueToday = mine.rows.filter { ($0.dueAtMs ?? -1) >= today && ($0.dueAtMs ?? .max) < tomorrow }.count
    let next = Array(mine.rows.prefix(Self.nextUp))
    return VStack(alignment: .leading, spacing: AglynSpace.two) {
      HStack(alignment: .firstTextBaseline) {
        Text("Tasks due").font(AglynFont.headline).accessibilityAddTraits(.isHeader)
        Spacer(minLength: AglynSpace.one)
        Button("View all") { context.navigate(CrmSection.tasks.screen) }
          .buttonStyle(.borderless).foregroundStyle(AglynColor.tint)
          .accessibilityIdentifier("crm-tasks-due-view-all")
      }
      HStack(spacing: AglynSpace.three) {
        AglynStatTile(
          mine.ready ? (mine.hasMore ? "\(overdue)+" : "\(overdue)") : nil, label: "Overdue",
          valueColor: overdue > 0 ? AglynColor.error : nil)
        AglynStatTile(mine.ready ? "\(dueToday)" : nil, label: "Due today", valueColor: dueToday > 0 ? AglynColor.warning : nil)
      }
      .fixedSize(horizontal: false, vertical: true)
      if mine.ready && next.isEmpty {
        Text("Nothing is assigned to you.").font(AglynFont.subheadline).foregroundStyle(.secondary)
      } else {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          ForEach(next) { task in
            HStack(spacing: AglynSpace.one) {
              Image(systemName: "checklist").foregroundStyle(.secondary).accessibilityHidden(true)
              Text(task.title).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
              if let due = task.dueAtMs {
                Text(Date(timeIntervalSince1970: Double(due) / 1000).formatted(date: .abbreviated, time: .omitted))
                  .font(AglynFont.caption)
                  .foregroundStyle(due < today ? AglynColor.error : .secondary)
              }
            }
            .font(AglynFont.subheadline)
            .accessibilityElement(children: .combine)
          }
        }
      }
    }
    .padding(AglynSpace.two)
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .aglynCardSurface()
    .accessibilityIdentifier(orgLevel ? "crm-org-tasks-due" : "crm-tasks-due")
  }
}
