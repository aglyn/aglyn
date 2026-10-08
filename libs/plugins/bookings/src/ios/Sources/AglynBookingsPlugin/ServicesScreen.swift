// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// A site's bookable services, as the console's Services card keeps them:
/// add one (through the quota-checked resources route), edit it in the
/// service dialog, offer a draft or withdraw a live one, and delete it.
struct BookingServicesScreen: View {
  let context: NativePluginContext
  @State private var services = LiveList<ServiceRow>()
  @State private var selection: String?
  @State private var adding = false
  @State private var notice: (String, AglynTone)?
  @State private var deleting: ServiceRow?

  private static let newID = "new"
  private var api: BookingsAPI? { context.hostID.map { BookingsAPI(api: context.api, writer: context.writer, hostID: $0) } }

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          list(selectable: true).frame(minWidth: 300, idealWidth: 340, maxWidth: 400)
          Divider()
          detail(selection).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        list(selectable: false)
      }
    }
    .navigationTitle("Services")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          adding = true
          selection = Self.newID
        } label: {
          Label("Add service", systemImage: "plus")
        }
        .accessibilityIdentifier("add-service")
      }
    }
    .sheet(isPresented: Binding(get: { adding && !isWide }, set: { if !$0 { adding = false } })) {
      NavigationStack { editor(for: nil) }
    }
    .task(id: context.hostID) {
      if let hostID = context.hostID {
        services.start(context.firestore, FirestoreQuery(servicesPath(hostID), limit: servicesWindow), map: visibleServices)
      }
    }
    .onDisappear { services.stop() }
    .confirmationDialog(
      "Delete this service?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
      titleVisibility: .visible, presenting: deleting
    ) { service in
      Button("Delete", role: .destructive) {
        run("\(service.name) was deleted.") { try await api?.deleteService(service.id) }
        if selection == service.id { selection = nil }
      }
    } message: { service in
      Text("\(service.name) stops taking bookings. Bookings it already has stay.")
    }
  }

  @Environment(\.horizontalSizeClass) private var sizeClass
  private var isWide: Bool { sizeClass != .compact }

  private func run(_ done: String, _ action: @escaping () async throws -> Void) {
    notice = nil
    Task {
      do {
        try await action()
        notice = (done, .success)
      } catch {
        notice = (error.localizedDescription, .error)
      }
    }
  }

  @ViewBuilder
  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      if let (text, tone) = notice {
        AglynNotice(text, tone: tone) { notice = nil }.padding(AglynSpace.two)
      }
      if let rows = services.rows {
        if services.failed && rows.isEmpty {
          AglynEmptyState("Could not load this site's services", systemImage: "exclamationmark.triangle")
        } else if rows.isEmpty {
          AglynEmptyState("No services yet", systemImage: "list.bullet.rectangle", message: "Add a service visitors can book, with the hours it is open.")
        } else if selectable {
          List(rows, selection: $selection) { service in
            ServiceListRow(service: service).tag(service.id)
          }
          .aglynListBackground()
          .accessibilityIdentifier("services-list")
        } else {
          List(rows) { service in
            NavigationLink {
              editor(for: service)
            } label: {
              ServiceListRow(service: service)
            }
            .accessibilityIdentifier("service-\(service.id)")
          }
          .aglynListBackground()
          .accessibilityIdentifier("services-list")
        }
      } else {
        List { SkeletonRows(count: 3) }.aglynListBackground()
      }
    }
  }

  @ViewBuilder
  private func detail(_ id: String?) -> some View {
    if id == Self.newID {
      editor(for: nil)
    } else if let service = services.rows?.first(where: { $0.id == id }) {
      editor(for: service).id(service.id)
    } else {
      AglynEmptyState("Pick a service to see it here", systemImage: "list.bullet.rectangle")
    }
  }

  private func editor(for service: ServiceRow?) -> some View {
    ServiceEditor(
      initial: service.map { bookingServiceDraftFrom($0.raw) } ?? newBookingServiceDraft(timeZone: TimeZone.current.identifier),
      service: service,
      onSave: { draft in
        if let service {
          run("Service saved.") { try await api?.saveService(service.id, draft) }
        } else {
          adding = false
          if selection == Self.newID { selection = nil }
          run("Service saved.") { try await api?.createService(draft) }
        }
      },
      onToggle: service.map { service in
        {
          run(service.draft ? "\(service.name) now takes bookings." : "\(service.name) is a draft again; it takes no new bookings.") {
            try await api?.setServiceActive(service.id, service.draft)
          }
        }
      },
      onDelete: service.map { service in { deleting = service } })
  }
}

struct ServiceListRow: View {
  let service: ServiceRow

  var body: some View {
    AglynRow(service.name, subtitle: "\(service.durationMinutes) min · \(service.priceText) · \(service.timeZone)", systemImage: "calendar.badge.plus") {
      if service.draft { StatusChip("Draft", tone: .warning) }
    }
  }
}

/// The service dialog: every field the console's has, with hours as an editor rather than text.
struct ServiceEditor: View {
  @Environment(\.dismiss) private var dismiss
  let service: ServiceRow?
  let onSave: (BookingServiceDraft) -> Void
  let onToggle: (() -> Void)?
  let onDelete: (() -> Void)?
  @State private var form: BookingServiceDraft
  @State private var hours: [[AglynHoursWindow]]

  init(
    initial: BookingServiceDraft, service: ServiceRow?, onSave: @escaping (BookingServiceDraft) -> Void,
    onToggle: (() -> Void)?, onDelete: (() -> Void)?
  ) {
    self.service = service
    self.onSave = onSave
    self.onToggle = onToggle
    self.onDelete = onDelete
    _form = State(initialValue: initial)
    _hours = State(initialValue: initial.windowText.map { parseBookingWindows($0).map { AglynHoursWindow(start: $0.start, end: $0.end) } })
  }

  private var values: ContractValues { .shared }

  var body: some View {
    Form {
      if service?.draft == true {
        Section { AglynNotice("A draft is offered nowhere until it is turned on.", tone: .warning) }
      }
      Section("Service") {
        TextField("Name", text: Binding(get: { form.name }, set: { form.name = String($0.prefix(values.bookingServiceNameMax)) }))
          .accessibilityIdentifier("service-name")
        TextField("Minutes (5 to 480)", text: Binding(get: { form.durationMinutes }, set: { form.durationMinutes = String($0.filter(\.isNumber).prefix(3)) }))
          #if os(iOS)
            .keyboardType(.numberPad)
          #endif
          .accessibilityIdentifier("service-duration")
        Picker("Show the price as", selection: $form.priceDisplay) {
          ForEach(values.bookingPriceDisplays.filter { $0 != .unknown }, id: \.self) { display in
            Text(display == .fixed ? "The price" : values.bookingPriceLabels[display.rawValue] ?? display.rawValue).tag(display)
          }
        }
        .accessibilityIdentifier("service-price-display")
        if form.priceDisplay == .fixed {
          TextField("Price (whole dollars)", text: Binding(get: { form.priceUsd }, set: { form.priceUsd = String($0.filter { $0.isNumber || $0 == "." }.prefix(7)) }))
            #if os(iOS)
              .keyboardType(.decimalPad)
            #endif
            .accessibilityIdentifier("service-price")
        }
        Picker("Time zone", selection: $form.timezone) {
          ForEach(zones, id: \.self) { Text($0).tag($0) }
        }
        .accessibilityIdentifier("service-timezone")
        TextField("Description (optional)", text: Binding(get: { form.description }, set: { form.description = String($0.prefix(values.bookingServiceDescriptionMax)) }), axis: .vertical)
          .lineLimit(2...6)
          .accessibilityIdentifier("service-description")
      }
      Section {
        AglynWeeklyHoursEditor(labels: values.bookingWeekdays, days: $hours)
      } header: {
        Text("Hours")
      } footer: {
        Text("When it can be booked each week, on the service's clock (\(form.timezone)).")
      }
      Section("What the booker is asked") {
        Picker("Phone", selection: $form.askPhone) { asks }
          .accessibilityIdentifier("service-ask-phone")
        Picker("Address", selection: $form.askAddress) { asks }
          .accessibilityIdentifier("service-ask-address")
      }
      Section("CRM") {
        Toggle(isOn: $form.crmMeetingActivity) {
          VStack(alignment: .leading) {
            Text("Log a meeting on the contact")
            Text("Each booking shows on the booker's record as a meeting.").font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
        .accessibilityIdentifier("service-crm-meeting")
        Toggle(isOn: $form.crmFollowUpTask) {
          VStack(alignment: .leading) {
            Text("Add a follow-up task")
            Text("A task to follow up after the appointment.").font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
        .accessibilityIdentifier("service-crm-task")
      }
      if onToggle != nil || onDelete != nil {
        Section {
          if let onToggle, let service {
            Button(service.draft ? "Turn on" : "Turn off", action: onToggle).accessibilityIdentifier("service-toggle")
          }
          if let onDelete {
            Button("Delete", role: .destructive, action: onDelete).accessibilityIdentifier("service-delete")
          }
        }
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .navigationTitle(service == nil ? "New service" : form.name.isEmpty ? "Service" : form.name)
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        Button(service == nil ? "Add" : "Save") {
          var draft = form
          draft.windowText = hours.map { formatBookingWindows($0.map { BookingWindow(end: $0.end, start: $0.start) }) }
          onSave(draft)
          if service == nil { dismiss() }
        }
        .disabled(bookingServiceDraftProblem(name: form.name) != nil)
        .accessibilityIdentifier("service-save")
      }
    }
    .accessibilityIdentifier("service-editor")
  }

  private var zones: [String] {
    let known = ["UTC"] + TimeZone.knownTimeZoneIdentifiers.filter { $0.contains("/") }.sorted()
    return known.contains(form.timezone) ? known : [form.timezone] + known
  }

  @ViewBuilder
  private var asks: some View {
    Text("Don't ask").tag(BookingFieldAsk.off)
    Text("Optional").tag(BookingFieldAsk.optional)
    Text("Required").tag(BookingFieldAsk.required)
  }
}
