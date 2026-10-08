// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * THE CRM'S TASKS (the Kotlin `CrmTasks.kt`): the console's views, each a
 * set of base clauses on `crmTasks` over TASK_LIST_DECLARATION by due date;
 * saved and completed through the console's task routes.
 */

struct CrmTask: Identifiable, Equatable {
  let id: String
  let title: String
  let kind: String
  let priority: String
  let status: String
  let dueAtMs: Int64?
  let assigneeUID: String?
  let notes: String
  let contactID: String?
  let companyID: String?
  let dealID: String?

  var draft: TaskDraft {
    TaskDraft(
      title: title, kind: kind, priority: priority, dueAtMs: dueAtMs, assigneeUID: assigneeUID, notes: notes, contactID: contactID,
      companyID: companyID, dealID: dealID)
  }
}

func crmTask(_ doc: FirestoreDocument) -> CrmTask {
  CrmTask(
    id: doc.id, title: doc.string("title") ?? "Task", kind: doc.string("kind") ?? "todo", priority: doc.string("priority") ?? "normal",
    status: doc.string("status") ?? "open", dueAtMs: millis(doc.data["dueAtMs"]), assigneeUID: doc.string("assigneeUid"),
    notes: doc.string("notes") ?? "", contactID: doc.string("contactId"), companyID: doc.string("companyId"), dealID: doc.string("dealId"))
}

enum TaskView: String, CaseIterable, Identifiable {
  case mine, overdue, today, upcoming, open, done
  var id: String { rawValue }
  var label: String { self == .open ? "All open" : rawValue.capitalized }
}

struct TaskViewPlan: Equatable {
  var status: String
  var assigneeUID: String?
  var dueFrom: Int64?
  var dueBefore: Int64?
  var descending = false
}

func startOfLocalDay(_ ms: Int64) -> Int64 {
  Int64(Calendar.current.startOfDay(for: Date(timeIntervalSince1970: Double(ms) / 1000)).timeIntervalSince1970 * 1000)
}

/// `crmTaskViewPlan`.
func taskViewPlan(_ view: TaskView, nowMs: Int64, uid: String) -> TaskViewPlan {
  let today = startOfLocalDay(nowMs)
  let tomorrow = startOfLocalDay(today + 36 * 3_600_000)
  switch view {
  case .mine: return TaskViewPlan(status: "open", assigneeUID: uid)
  case .overdue: return TaskViewPlan(status: "open", dueBefore: today)
  case .today: return TaskViewPlan(status: "open", dueFrom: today, dueBefore: tomorrow)
  case .upcoming: return TaskViewPlan(status: "open", dueFrom: tomorrow)
  case .open: return TaskViewPlan(status: "open")
  case .done: return TaskViewPlan(status: "done", descending: true)
  }
}

func tasksQuery(_ scope: CrmScope, _ plan: TaskViewPlan, search: String, limit: Int) -> FirestoreQuery {
  var base = scopeBase(scope) + [ListQueryFilter(op: .equal, path: "status", value: .string(plan.status))]
  if let uid = plan.assigneeUID { base.append(ListQueryFilter(op: .equal, path: "assigneeUid", value: .string(uid))) }
  if let from = plan.dueFrom { base.append(ListQueryFilter(op: .greaterThanOrEqual, path: "dueAtMs", value: .number(Double(from)))) }
  if let before = plan.dueBefore { base.append(ListQueryFilter(op: .lessThan, path: "dueAtMs", value: .number(Double(before)))) }
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return planListQuery(
    ContractValues.shared.taskListDeclaration,
    ListQueryRequest(
      base: base, clauses: [], search: words.isEmpty ? nil : [words],
      sort: ListQuerySort(direction: plan.descending ? .desc : .asc, path: "dueAtMs"))
  ).firestoreQuery(crmPath(scope.orgID, "crmTasks"), limit: limit)
}

struct TaskRowView: View {
  let task: CrmTask
  let reference: CrmReference
  var onToggle: (() -> Void)?

  var body: some View {
    let due = task.dueAtMs.map { Date(timeIntervalSince1970: Double($0) / 1000) }
    let overdue = task.status == "open" && (task.dueAtMs ?? .max) < startOfLocalDay(Int64(Date().timeIntervalSince1970 * 1000))
    HStack(spacing: AglynSpace.oneAndHalf) {
      if let onToggle {
        Button(action: onToggle) {
          Image(systemName: task.status == "done" ? "checkmark.circle.fill" : "circle")
            .font(.title3).foregroundStyle(task.status == "done" ? AglynColor.success : .secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(task.status == "done" ? "Reopen \(task.title)" : "Complete \(task.title)")
        .accessibilityIdentifier("task-done-\(task.id)")
      }
      AglynRow(
        task.title,
        subtitle: [
          ContractValues.shared.crmTaskKindLabels[task.kind] ?? task.kind, due.map { "Due \($0.formatted(date: .abbreviated, time: .shortened))" },
          reference.memberLabel(task.assigneeUID),
        ].compactMap { $0 }.joined(separator: " · ")
      ) {
        HStack(spacing: 4) {
          if overdue { StatusChip("Overdue", tone: .error) }
          if task.priority == "high" { StatusChip("High", tone: .warning) }
        }
      }
    }
    .accessibilityIdentifier("task-\(task.id)")
  }
}

/// The task form: what it is, when it is due, whose it is and what it is about.
struct TaskSheet: View {
  let title: String
  let initial: TaskDraft
  let reference: CrmReference
  var onDelete: (() async throws -> Void)?
  let save: (TaskDraft) async throws -> Void
  @State private var draft = TaskDraft()
  @State private var loaded = false
  @State private var hasDue = false
  @State private var due = Date()
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    AglynFormSheet(title, canConfirm: !draft.title.trimmingCharacters(in: .whitespaces).isEmpty, save: {
      var final = draft
      final.dueAtMs = hasDue ? Int64(due.timeIntervalSince1970 * 1000) : nil
      try await save(final)
    }) {
      Section {
        TextField("Task", text: $draft.title).accessibilityIdentifier("task-title")
        Picker("Type", selection: $draft.kind) {
          ForEach(ContractValues.shared.nativeCrmTaskKinds, id: \.self) { Text(ContractValues.shared.crmTaskKindLabels[$0] ?? $0).tag($0) }
        }
        Picker("Priority", selection: $draft.priority) {
          Text("Low").tag("low")
          Text("Normal").tag("normal")
          Text("High").tag("high")
        }
        .pickerStyle(.segmented)
        Toggle("Due", isOn: $hasDue)
        if hasDue { DatePicker("When", selection: $due) }
        Picker("Assigned to", selection: Binding(get: { draft.assigneeUID ?? "" }, set: { draft.assigneeUID = $0.isEmpty ? nil : $0 })) {
          Text("Nobody").tag("")
          ForEach(reference.members) { Text($0.label).tag($0.uid) }
        }
      }
      Section("About") {
        Picker("Company", selection: Binding(get: { draft.companyID ?? "" }, set: { draft.companyID = $0.isEmpty ? nil : $0 })) {
          Text("None").tag("")
          ForEach(reference.companies) { Text($0.label).tag($0.value) }
        }
        Picker("Contact", selection: Binding(get: { draft.contactID ?? "" }, set: { draft.contactID = $0.isEmpty ? nil : $0 })) {
          Text("None").tag("")
          ForEach(reference.contacts) { Text($0.label).tag($0.value) }
        }
        TextField("Notes", text: $draft.notes, axis: .vertical).lineLimit(2...8)
      }
      if let onDelete {
        Section {
          Button("Delete this task", role: .destructive) {
            Task {
              try? await onDelete()
              dismiss()
            }
          }
        }
      }
    }
    .onAppear {
      guard !loaded else { return }
      loaded = true
      draft = initial
      if let dueAt = initial.dueAtMs {
        hasDue = true
        due = Date(timeIntervalSince1970: Double(dueAt) / 1000)
      } else {
        due = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date().addingTimeInterval(86_400)) ?? Date()
      }
    }
  }
}

struct TasksSection: View {
  let context: NativePluginContext
  let scope: CrmScope
  let api: CrmAPI
  let reference: CrmReference
  @State private var view: TaskView = .mine
  @State private var list = LiveQueryList(pageSize: 25, map: crmTask)
  @State private var searchText = ""
  @State private var search = ""
  @State private var editing: CrmTask?
  @State private var creating = false

  var body: some View {
    VStack(spacing: 0) {
      Picker("View", selection: $view) {
        ForEach(TaskView.allCases) { Text($0.label).tag($0) }
      }
      .pickerStyle(.segmented)
      .padding(AglynSpace.two)
      if !list.ready {
        List { SkeletonRows(count: 6) }.aglynListBackground()
      } else if let failure = list.failure {
        AglynEmptyState("Could not load tasks", systemImage: "exclamationmark.triangle", message: failure) { Button("Try again") { list.retry() } }
      } else if list.rows.isEmpty {
        AglynEmptyState(view == .done ? "Nothing done yet" : "Nothing to do here", systemImage: "checklist", message: "Tasks you and your team add show up here.")
      } else {
        List {
          ForEach(list.rows) { task in
            TaskRowView(
              task: task, reference: reference,
              onToggle: scope.canWrite
                ? {
                  Task {
                    if task.status == "done" { try? await api.reopenTask(task) } else { try? await api.completeTask(task.id) }
                  }
                } : nil
            )
            .contentShape(Rectangle())
            .onTapGesture { if scope.canWrite { editing = task } }
            .aglynListRow()
          }
          if list.hasMore { Button("Show more") { list.loadMore() }.frame(maxWidth: .infinity) }
        }
        .refreshable { list.retry() }
        .aglynListBackground()
      }
    }
    .searchable(text: $searchText, prompt: "Search tasks")
    .onSubmit(of: .search) { search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { search = "" } }
    .toolbar {
      if scope.canWrite {
        ToolbarItem(placement: .primaryAction) {
          Button {
            creating = true
          } label: {
            Label("New task", systemImage: "plus")
          }
          .accessibilityIdentifier("crm-new-task")
        }
      }
    }
    .task(id: "\(view.rawValue)|\(search)") {
      let plan = taskViewPlan(view, nowMs: Int64(Date().timeIntervalSince1970 * 1000), uid: scope.uid)
      let search = search
      list.show(context.firestore) { tasksQuery(scope, plan, search: search, limit: $0) }
    }
    .onDisappear { list.stop() }
    .sheet(isPresented: $creating) {
      TaskSheet(title: "New task", initial: TaskDraft(assigneeUID: scope.uid), reference: reference) { try await api.saveTask(nil, $0) }
    }
    .sheet(item: $editing) { task in
      TaskSheet(title: "Edit task", initial: task.draft, reference: reference, onDelete: { try await api.deleteTask(task) }) {
        try await api.saveTask(task.id, $0)
      }
    }
  }
}
