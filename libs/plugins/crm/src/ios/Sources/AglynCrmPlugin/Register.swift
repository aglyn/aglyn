// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Registers the ids `plugins.config.json` declares under the plugin's
/// `mobile.contributes`: every section of the console's CRM hub as a
/// screen, each record kind's screen, the glance and tasks-due Home cards,
/// quick actions, and the console's CRM links.
@MainActor
public func registerCrmNative(_ r: NativePluginRegistrar) {
  for section in CrmSection.allCases {
    r.screen(section.screen, title: section == .contacts ? "CRM" : section.label, requiresSite: true, icon: section.symbol) { ctx, params in
      CrmHubScreen(context: ctx, section: section, initialRecord: section.kind.flatMap { params[$0.param] })
    }
  }
  for kind in CrmKind.allCases {
    r.screen(kind.detailScreen, title: kind.singular, requiresSite: true, icon: kind.symbol) { ctx, params in
      if let id = params[kind.param] ?? params["\(kind.param)Id"] ?? params["id"] {
        CrmGate(context: ctx) { scope, api, reference in
          RecordDetail(context: ctx, kind: kind, id: id, scope: scope, api: api, reference: reference)
        }
      } else {
        CrmHubScreen(context: ctx, section: CrmSection.allCases.first { $0.kind == kind } ?? .contacts)
      }
    }
  }
  r.widget("crm.glance", title: "CRM", icon: "person.badge.plus", order: 70, size: .half, requiresSite: true) { CrmGlanceWidget(context: $0) }
  r.widget("crm.tasks-due", title: "Tasks due", icon: "checklist", order: 72, size: .half, requiresSite: true) { TasksDueWidget(context: $0) }
  r.quickAction("crm.open", title: "CRM", icon: "person.2", order: 70, screen: CrmSection.contacts.screen, requiresSite: true)
  r.quickAction("crm.deals-action", title: "Deals", icon: "dollarsign.circle", order: 72, screen: CrmSection.deals.screen, requiresSite: true)
  r.quickAction("crm.tasks-action", title: "Tasks", icon: "checklist", order: 74, screen: CrmSection.tasks.screen, requiresSite: true)
  r.deepLink("crm.page", path: "/crm", screen: CrmSection.contacts.screen)
  r.deepLink("crm.legacy-contacts", path: "/contacts", screen: CrmSection.contacts.screen)
  for section in CrmSection.allCases { r.deepLink("crm.\(section.rawValue)-page", path: "/crm/\(section.rawValue)", screen: section.screen) }
  for kind in CrmKind.allCases { r.deepLink("crm.\(kind.param)-page", path: "/crm/\(kind.collection)/:\(kind.param)", screen: kind.detailScreen) }
}

/// Home's CRM card: the open leads this site may see.
struct CrmGlanceWidget: View {
  let context: NativePluginContext
  @State private var scope = CrmScopeModel()
  @State private var list = LiveQueryList(pageSize: 100) { $0.id }

  var body: some View {
    let count = list.ready && list.failure == nil ? list.rows.count : nil
    MetricCard(
      "Open leads", systemImage: "person.badge.plus", tone: .info, value: count.map { list.hasMore ? "\($0)+" : "\($0)" },
      caption: count == 1 ? "lead to work" : "leads to work", actionLabel: "Open leads",
      failed: scope.scope?.suite == false ? "The CRM is included from Starter." : list.failure.map { _ in "Could not load leads." }
    ) {
      context.navigate(CrmSection.leads.screen)
    }
    .task(id: context.hostID) {
      guard let orgID = context.orgID, let hostID = context.hostID else { return }
      scope.start(context.firestore, orgID: orgID, hostID: hostID, uid: context.uid)
    }
    .task(id: scope.scope?.readTokens) {
      guard let current = scope.scope, current.suite else { return }
      list.show(context.firestore) {
        scopedQuery(
          current, "leads",
          filters: [ListQueryConstraint(path: "status", op: .in, value: ContractValues.shared.nativeCrmLeadOpenStatuses)], limit: $0)
      }
    }
    .onDisappear {
      scope.stop()
      list.stop()
    }
  }
}

/// Home's tasks card: the member's open tasks due by the end of today.
struct TasksDueWidget: View {
  let context: NativePluginContext
  @State private var scope = CrmScopeModel()
  @State private var list = LiveQueryList(pageSize: 100, map: crmTask)

  var body: some View {
    let end = startOfLocalDay(Int64(Date().timeIntervalSince1970 * 1000)) + 86_400_000
    let count = list.ready && list.failure == nil ? list.rows.filter { ($0.dueAtMs ?? .max) < end }.count : nil
    MetricCard(
      "Tasks due", systemImage: "checklist", tone: .warning, value: count.map(String.init),
      caption: count == 1 ? "task due today or overdue" : "tasks due today or overdue", actionLabel: "Open tasks",
      failed: scope.scope?.suite == false ? "The CRM is included from Starter." : list.failure.map { _ in "Could not load tasks." }
    ) {
      context.navigate(CrmSection.tasks.screen)
    }
    .task(id: context.hostID) {
      guard let orgID = context.orgID, let hostID = context.hostID else { return }
      scope.start(context.firestore, orgID: orgID, hostID: hostID, uid: context.uid)
    }
    .task(id: scope.scope?.readTokens) {
      guard let current = scope.scope, current.suite else { return }
      let plan = taskViewPlan(.mine, nowMs: Int64(Date().timeIntervalSince1970 * 1000), uid: current.uid)
      list.show(context.firestore) { tasksQuery(current, plan, search: "", limit: $0) }
    }
    .onDisappear {
      scope.stop()
      list.stop()
    }
  }
}
