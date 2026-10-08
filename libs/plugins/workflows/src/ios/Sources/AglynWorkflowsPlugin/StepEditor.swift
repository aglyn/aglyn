// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

/// Where a step sits, for the email step's transactional switch.
struct ReplyContext {
  let event: String?
  let afterWait: Bool
}

/// The function-call fields a workflow step shows instead of an Actions step's.
struct FunctionCallContext {
  let options: [PickerOption]
  let functions: [String: HostFunctionDefinition]
}

/// One step's section: what it does, the fields that kind takes, and (for an
/// Actions step) the condition that gates it — the console's `AutomationStepFields`.
struct StepSection: View {
  @Binding var step: StepDraft
  let index: Int
  let kinds: [StepKind]
  let pickers: AutomationPickers
  let reply: ReplyContext?
  let functionCall: FunctionCallContext?
  let onRemove: () -> Void

  private var kindValue: String { step.isFunctionCall && functionCall != nil ? functionCallKind : step.type ?? "" }

  var body: some View {
    Section {
      Picker("Do", selection: Binding(get: { kindValue }, set: { choose($0) })) {
        if !kinds.contains(where: { $0.value == kindValue }) {
          Text(workflowStepTypeLabel(kindValue)).tag(kindValue)
        }
        ForEach(kinds) { Text($0.label).tag($0.value) }
      }
      .accessibilityIdentifier("step-\(index)-kind")
      if let functionCall, step.isFunctionCall {
        FunctionCallFields(step: $step, index: index, context: functionCall)
      } else {
        StepFields(step: $step, index: index, pickers: pickers)
        if step.type == "sendEmail", let reply { ReplySwitch(step: $step, context: reply) }
        StepGuardFields(step: $step, index: index)
      }
    } header: {
      HStack {
        Text("Step \(index + 1)")
        Spacer()
        Button(role: .destructive, action: onRemove) {
          Label("Remove step", systemImage: "minus.circle")
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .accessibilityIdentifier("step-\(index)-remove")
      }
    }
  }

  private func choose(_ value: String) {
    guard value != kindValue else { return }
    step = StepDraft(value == functionCallKind ? blankFunctionCall() : defaultAutomationStep(value))
  }
}

/// Text bound to one string field of a step.
private func text(_ step: Binding<StepDraft>, _ key: String) -> Binding<String> {
  Binding(get: { step.wrappedValue.string(key) }, set: { step.wrappedValue.fields[key] = $0 })
}

/// A record picker storing `{idKey, nameKey}`: the id, and the name at the time it was picked.
private struct RecordPicker: View {
  @Binding var step: StepDraft
  let label: String
  let noun: String
  let idKey: String
  let nameKey: String
  let options: [PickerOption]
  var emptyText: String? = nil
  let identifier: String

  var body: some View {
    let currentID = step.string(idKey)
    let byName = options.first { $0.name == step.string(nameKey) }?.id
    let selection = currentID.isEmpty ? (byName ?? "") : currentID
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      if options.isEmpty, let emptyText {
        LabeledContent(label) { Text(emptyText).foregroundStyle(.secondary) }
      } else {
        Picker(
          label,
          selection: Binding(
            get: { selection },
            set: { id in
              step.fields[idKey] = id
              step.fields[nameKey] = options.first { $0.id == id }?.name ?? step.fields[nameKey] ?? ""
            })
        ) {
          if selection.isEmpty { Text("Choose…").tag("") }
          if !selection.isEmpty && !options.contains(where: { $0.id == selection }) {
            Text(step.string(nameKey).isEmpty ? selection : step.string(nameKey)).tag(selection)
          }
          ForEach(options) { Text($0.name).tag($0.id) }
        }
        .accessibilityIdentifier(identifier)
      }
      AglynHelperText(
        placeholderReferenceHelp(name: step.fields[nameKey], id: step.fields[idKey], noun: noun), isError: true)
    }
  }
}

/// A text field that flags a bracketed placeholder still to fill in.
private struct PlaceholderField: View {
  let label: String
  @Binding var text: String
  var placeholder: String? = nil
  var help: String = "Fill in the placeholder"
  var helper: String? = nil
  var multiline = false
  let identifier: String

  var body: some View {
    let flagged = draftPlaceholderIn(text) != nil
    AglynLabeledField(
      label, text: $text, placeholder: placeholder, helper: flagged ? help : helper, isError: flagged, multiline: multiline
    )
    .accessibilityIdentifier(identifier)
  }
}

/// A duration picker over the wait presets; a stored value off the list stays visible.
private struct DurationPicker: View {
  let label: String
  @Binding var minutes: Int
  let identifier: String

  var body: some View {
    Picker(label, selection: $minutes) {
      if !flowWaitPresets.contains(where: { $0.minutes == minutes }) {
        Text(durationLabel(minutes)).tag(minutes)
      }
      ForEach(flowWaitPresets, id: \.minutes) { Text($0.label).tag($0.minutes) }
    }
    .accessibilityIdentifier(identifier)
  }
}

private func intField(_ step: Binding<StepDraft>, _ key: String, default fallback: Int) -> Binding<Int> {
  Binding(
    get: { (step.wrappedValue.fields[key] as? NSNumber)?.intValue ?? fallback },
    set: { step.wrappedValue.fields[key] = $0 })
}

/// The fields each Actions step type takes, as the console's editor offers them.
struct StepFields: View {
  @Binding var step: StepDraft
  let index: Int
  let pickers: AutomationPickers

  private func id(_ name: String) -> String { "step-\(index)-\(name)" }

  var body: some View {
    switch step.type ?? "" {
    case "runWorkflow":
      RecordPicker(
        step: $step, label: "Workflow", noun: "workflow", idKey: "workflowId", nameKey: "workflowName",
        options: pickers.workflows, identifier: id("workflow"))
    case "siteAlert":
      PlaceholderField(label: "Message", text: text($step, "message"), identifier: id("message"))
      Picker("Style", selection: Binding(get: { step.string("severity").isEmpty ? "info" : step.string("severity") }, set: { step.fields["severity"] = $0 })) {
        ForEach(["info", "success", "warning", "error"], id: \.self) { Text($0).tag($0) }
      }
      .accessibilityIdentifier(id("severity"))
    case "customEvent":
      AglynLabeledField("Event name", text: text($step, "eventName")).accessibilityIdentifier(id("event-name"))
    case "webhookPost":
      RecordPicker(
        step: $step, label: "Webhook", noun: "webhook", idKey: "webhookId", nameKey: "webhookName",
        options: pickers.webhooks, identifier: id("webhook"))
    case "datasetAppend", "updateDataset":
      RecordPicker(
        step: $step, label: "Dataset", noun: "dataset", idKey: "datasetId", nameKey: "datasetName",
        options: pickers.datasets, identifier: id("dataset"))
    case "showOverlay":
      Picker(
        "Overlay",
        selection: Binding(
          get: { step.string("overlayId") },
          set: { overlay in
            step.fields["overlayId"] = overlay
            step.fields["overlayName"] = pickers.overlays.first { $0.id == overlay }?.name ?? ""
          })
      ) {
        if step.string("overlayId").isEmpty { Text("Choose…").tag("") }
        ForEach(pickers.overlays) { Text($0.name).tag($0.id) }
      }
      .accessibilityIdentifier(id("overlay"))
    case "sendEmail":
      PlaceholderField(label: "Subject", text: text($step, "subject"), identifier: id("subject"))
      PlaceholderField(
        label: "Body", text: text($step, "body"), help: "Fill in the placeholders", helper: sendEmailMergeHelp,
        multiline: true, identifier: id("body"))
    case "notifyAdmins":
      PlaceholderField(label: "Notification title", text: text($step, "title"), identifier: id("title"))
    case "enrollList":
      RecordPicker(
        step: $step, label: "List", noun: "list", idKey: "listId", nameKey: "listName", options: pickers.lists,
        emptyText: "No lists yet — create one under Campaigns", identifier: id("list"))
    case "assignCampaign":
      RecordPicker(
        step: $step, label: "Campaign", noun: "campaign", idKey: "campaignId", nameKey: "campaignName",
        options: pickers.campaigns, emptyText: "No campaigns yet", identifier: id("campaign"))
    case "setContactStage":
      Picker("Stage", selection: Binding(get: { step.string("lifecycleStage") }, set: { step.fields["lifecycleStage"] = $0 })) {
        ForEach(contactLifecycleStages, id: \.self) { Text(lifecycleStageLabels[$0] ?? $0).tag($0) }
      }
      .accessibilityIdentifier(id("stage"))
    case "addContactTag":
      PlaceholderField(
        label: "Tag",
        text: Binding(get: { step.string("tag") }, set: { step.fields["tag"] = jsSliceText($0, contactTagMaxLength) }),
        identifier: id("tag"))
    case "assignContactOwner":
      OwnerFields(step: $step, index: index)
    case "createCrmTask":
      TaskFields(step: $step, index: index)
    case "logCrmActivity":
      ActivityFields(step: $step, index: index)
    case "wait":
      DurationPicker(label: "Wait for", minutes: intField($step, "delayMinutes", default: 1440), identifier: id("wait"))
      AglynHelperText("The rest of this automation runs later, on its own.")
    case "waitForEvent":
      Picker("Until", selection: Binding(get: { step.string("eventName") }, set: { step.fields["eventName"] = $0 })) {
        if step.string("eventName").isEmpty { Text("Choose…").tag("") }
        if !step.string("eventName").isEmpty && !isHostEventType(step.string("eventName")) {
          Text(step.string("eventName")).tag(step.string("eventName"))
        }
        ForEach(hostEvents, id: \.type) { Text($0.label).tag($0.type) }
      }
      .accessibilityIdentifier(id("until"))
      DurationPicker(
        label: "Give up after", minutes: intField($step, "timeoutMinutes", default: 4320), identifier: id("timeout"))
      AglynHelperText("Continues as soon as this happens, or when the time is up.")
    case "exitFlow":
      AglynHelperText("Nothing after this step runs. Add a condition to make it a branch.")
    case "scrollTo":
      ClientFields(step: $step, index: index)
      Picker("Scroll", selection: Binding(get: { step.string("behavior") == "instant" ? "instant" : "smooth" }, set: { step.fields["behavior"] = $0 })) {
        Text("Smoothly").tag("smooth")
        Text("Instantly").tag("instant")
      }
      .accessibilityIdentifier(id("scroll"))
      AglynLabeledField(
        "Offset (px)",
        text: Binding(
          get: { (step.fields["offsetPx"] as? NSNumber).map { "\($0.intValue)" } ?? "" },
          set: { value in
            if let px = Int(value.filter(\.isNumber)) { step.fields["offsetPx"] = px } else { step.fields.removeValue(forKey: "offsetPx") }
          })
      )
      .accessibilityIdentifier(id("offset"))
    default:
      ClientFields(step: $step, index: index)
    }
  }
}

/// A client step's plain text fields; a step type with none just names what it does.
private struct ClientFields: View {
  @Binding var step: StepDraft
  let index: Int

  var body: some View {
    let fields = clientStepFields[step.type ?? ""] ?? []
    if fields.isEmpty {
      AglynHelperText(
        clientActionStepTypes.contains(step.type ?? "")
          ? "Runs in the visitor’s browser." : "This step is kept as it was saved.")
    }
    ForEach(fields, id: \.key) { field in
      let binding = text($step, field.key)
      let attributeProblem =
        field.key == "name" && !binding.wrappedValue.isEmpty && !isInteractionAttributeAllowed(binding.wrappedValue)
      AglynLabeledField(
        field.label, text: binding, placeholder: field.placeholder,
        helper: attributeProblem ? "Must start with aria- or data-" : nil, isError: attributeProblem,
        multiline: field.multiline
      )
      .accessibilityIdentifier("step-\(index)-\(field.key)")
    }
  }
}

private struct OwnerFields: View {
  @Binding var step: StepDraft
  let index: Int

  var body: some View {
    let roundRobin = looseIsTrueValue(step.fields["roundRobin"])
    Picker(
      "Assign to",
      selection: Binding(
        get: { roundRobin ? "roundRobin" : "member" },
        set: { mode in
          step.fields = mode == "roundRobin" ? ["type": step.type ?? "", "roundRobin": true] : ["type": step.type ?? "", "ownerEmail": ""]
        })
    ) {
      Text("A team member").tag("member")
      Text("Round robin — the next member of the CRM’s pool").tag("roundRobin")
    }
    .accessibilityIdentifier("step-\(index)-assign")
    if roundRobin {
      AglynHelperText("The pool is set under CRM → Settings; an empty pool is a failed step.")
    } else {
      AglynLabeledField(
        "Owner (email address or member id)",
        text: Binding(
          get: { step.string("ownerEmail").isEmpty ? step.string("ownerUid") : step.string("ownerEmail") },
          set: { memberReference(&step.fields, role: "owner", $0) }),
        helper: "Somebody on your team, matched against the roster when the automation runs."
      )
      .accessibilityIdentifier("step-\(index)-owner")
    }
  }
}

private struct TaskFields: View {
  @Binding var step: StepDraft
  let index: Int

  var body: some View {
    PlaceholderField(label: "Title", text: text($step, "title"), identifier: "step-\(index)-title")
    Picker("Type", selection: Binding(get: { step.string("kind") }, set: { step.fields["kind"] = $0 })) {
      ForEach(crmTaskKinds, id: \.self) { Text(taskKindLabels[$0] ?? $0).tag($0) }
    }
    .accessibilityIdentifier("step-\(index)-task-kind")
    Picker("Priority", selection: Binding(get: { step.string("priority").isEmpty ? "normal" : step.string("priority") }, set: { step.fields["priority"] = $0 })) {
      ForEach(taskPriorityOptions, id: \.value) { Text($0.label).tag($0.value) }
    }
    .accessibilityIdentifier("step-\(index)-priority")
    Stepper(
      value: Binding(
        get: { (step.fields["dueInDays"] as? NSNumber)?.intValue ?? 0 },
        set: { step.fields["dueInDays"] = min(crmTaskMaxDueDays, max(0, $0)) }),
      in: 0...crmTaskMaxDueDays
    ) {
      LabeledContent("Due in (days)", value: "\((step.fields["dueInDays"] as? NSNumber)?.intValue ?? 0)")
    }
    .accessibilityIdentifier("step-\(index)-due")
    AglynLabeledField(
      "Assignee (email address or member id, optional)",
      text: Binding(
        get: { step.string("assigneeEmail").isEmpty ? step.string("assigneeUid") : step.string("assigneeEmail") },
        set: { memberReference(&step.fields, role: "assignee", $0) }),
      helper: "Blank gives it to the contact’s owner."
    )
    .accessibilityIdentifier("step-\(index)-assignee")
  }
}

private struct ActivityFields: View {
  @Binding var step: StepDraft
  let index: Int

  var body: some View {
    let kind = step.string("kind")
    let directions = crmActivityDirections[kind] ?? []
    Picker(
      "Kind",
      selection: Binding(
        get: { kind },
        set: { next in
          step.fields["kind"] = next
          if let direction = step.fields["direction"] as? String, !(crmActivityDirections[next] ?? []).contains(direction) {
            step.fields.removeValue(forKey: "direction")
          }
        })
    ) {
      ForEach(crmActivityKinds, id: \.self) { Text(activityKindLabels[$0] ?? $0).tag($0) }
    }
    .accessibilityIdentifier("step-\(index)-activity-kind")
    if !directions.isEmpty {
      Picker(
        "Direction",
        selection: Binding(
          get: { step.string("direction") },
          set: { value in
            if value.isEmpty { step.fields.removeValue(forKey: "direction") } else { step.fields["direction"] = value }
          })
      ) {
        Text("Not said").tag("")
        ForEach(directions, id: \.self) { Text(activityDirectionLabels[$0] ?? $0).tag($0) }
      }
      .accessibilityIdentifier("step-\(index)-direction")
    }
    PlaceholderField(
      label: "What happened", text: text($step, "body"), help: "Fill in the placeholders", multiline: true,
      identifier: "step-\(index)-what")
  }
}

/// The email step's transactional-reply switch: on by default where it qualifies, off and disabled where not.
private struct ReplySwitch: View {
  @Binding var step: StepDraft
  let context: ReplyContext

  var body: some View {
    let ineligible = sendEmailReplyIneligibility(step.fields, event: context.event, afterWait: context.afterWait)
    let on = sendEmailIsTransactionalReply(step.fields, event: context.event, afterWait: context.afterWait)
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      Toggle("Transactional reply (no unsubscribe)", isOn: Binding(get: { on }, set: { step.fields["transactional"] = $0 }))
        .disabled(ineligible != nil)
        .accessibilityIdentifier("step-transactional")
      AglynHelperText(
        ineligible.map { "Sent as a mailing with an unsubscribe link: \(sendEmailReplyIneligibleReasons[$0] ?? $0)." }
          ?? (on
            ? "Answers what this person just did, so it goes without an unsubscribe link or header. Bounced, complaining and unsubscribed addresses are still skipped."
            : "Sent as a mailing, with an unsubscribe link and header."))
    }
  }
}

/// "Only if": the step's own condition, one clause, as the console's row writes it.
private struct StepGuardFields: View {
  @Binding var step: StepDraft
  let index: Int

  private var clause: [String: Any]? {
    ((step.fields["when"] as? [String: Any])?["conditions"] as? [Any])?.first as? [String: Any]
  }

  private func set(op: String? = nil, field: String? = nil, value: String? = nil) {
    let current = clause ?? [:]
    let nextOp = op ?? (current["op"] as? String ?? "")
    if nextOp.isEmpty {
      step.fields["when"] = NSNull()
      return
    }
    step.fields["when"] = [
      "conditions": [
        [
          "op": nextOp, "field": field ?? (current["field"] as? String ?? ""),
          "value": value ?? (current["value"] as? String ?? ""),
        ]
      ]
    ]
  }

  var body: some View {
    let op = clause?["op"] as? String ?? ""
    Picker("Only if", selection: Binding(get: { op }, set: { set(op: $0) })) {
      Text("Always run").tag("")
      Text("Field is not empty").tag("notEmpty")
      Text("Field equals").tag("equals")
      Text("Field contains").tag("contains")
    }
    .accessibilityIdentifier("step-\(index)-only-if")
    if !op.isEmpty {
      AglynLabeledField(
        "Field", text: Binding(get: { clause?["field"] as? String ?? "" }, set: { set(field: $0) }), placeholder: "orderId"
      )
      .accessibilityIdentifier("step-\(index)-guard-field")
    }
    if op == "equals" || op == "contains" {
      let value = clause?["value"] as? String ?? ""
      let flagged = draftPlaceholderIn(value) != nil
      AglynLabeledField(
        "Value", text: Binding(get: { value }, set: { set(value: $0) }),
        helper: flagged ? "Replace the placeholder with the value to match" : nil, isError: flagged
      )
      .accessibilityIdentifier("step-\(index)-guard-value")
    }
  }
}

/// A workflow's function call: the function, the result name, and one expression per parameter.
private struct FunctionCallFields: View {
  @Binding var step: StepDraft
  let index: Int
  let context: FunctionCallContext

  var body: some View {
    let functionID = step.string("functionId")
    let resolvedID = functionID.isEmpty ? (context.options.first { $0.name == step.string("functionName") }?.id ?? "") : functionID
    let definition = context.functions[functionID] ?? context.functions[step.string("functionName")]
    Picker(
      "Function",
      selection: Binding(
        get: { resolvedID },
        set: { id in
          step.fields["functionId"] = id
          step.fields["functionName"] = context.options.first { $0.id == id }?.name ?? step.string("functionName")
        })
    ) {
      if resolvedID.isEmpty { Text("Choose…").tag("") }
      if !resolvedID.isEmpty && !context.options.contains(where: { $0.id == resolvedID }) {
        Text(step.string("functionName").isEmpty ? resolvedID : step.string("functionName")).tag(resolvedID)
      }
      ForEach(context.options) { Text($0.name).tag($0.id) }
    }
    .accessibilityIdentifier("step-\(index)-function")
    AglynLabeledField(
      "Result name",
      text: Binding(
        get: { step.string("resultName") },
        set: { step.fields["resultName"] = $0.filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") } }),
      placeholder: "step\(index + 1)"
    )
    .accessibilityIdentifier("step-\(index)-result")
    ForEach(Array((definition?.parameters ?? []).enumerated()), id: \.offset) { position, parameter in
      AglynLabeledField(
        "\(parameter.name) expression",
        text: Binding(
          get: {
            let args = step.fields["args"] as? [Any] ?? []
            return position < args.count ? (args[position] as? String ?? "") : ""
          },
          set: { value in
            var args = (step.fields["args"] as? [Any] ?? []).map { $0 as? String ?? "" }
            while args.count <= position { args.append("") }
            args[position] = value
            step.fields["args"] = args
          }),
        placeholder: position == 0 && index > 0 ? "step\(index)" : "a variable, number, or expression"
      )
      .accessibilityIdentifier("step-\(index)-arg-\(position)")
    }
  }
}

// MARK: - Conditions

/// The trigger's condition rows: "Only run when", then "Condition" rows joined by and/or.
struct ConditionRowsSection: View {
  @Binding var rows: [ConditionRow]
  @Binding var combinator: String
  /// The site's forms, when the event carries a `formId` (the "Form is…" option); nil offers none.
  let forms: [PickerOption]?

  private var offerForms: Bool { forms != nil || rows.contains { $0.op == formIsOp } }

  var body: some View {
    Section {
      ForEach($rows) { $row in
        let index = rows.firstIndex(where: { $0.id == row.id }) ?? 0
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          HStack {
            if index > 0 {
              Text(combinator == "or" ? "or" : "and").font(AglynFont.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            Picker(
              index == 0 ? "Only run when" : "Condition",
              selection: Binding(
                get: { row.op },
                set: { op in
                  if op == formIsOp {
                    row = ConditionRow(op: op, field: formIDField, value: "")
                  } else if row.op == formIsOp {
                    row = ConditionRow(op: op, field: "", value: "")
                  } else {
                    row.op = op
                  }
                })
            ) {
              if rows.count == 1 { Text("Always (no condition)").tag("") }
              Text("A field is not empty").tag("notEmpty")
              Text("A field equals…").tag("equals")
              Text("A field contains…").tag("contains")
              if offerForms { Text("Form is…").tag(formIsOp) }
            }
            .accessibilityIdentifier("condition-\(index)-op")
            if rows.count > 1 {
              Button(role: .destructive) {
                rows.removeAll { $0.id == row.id }
                if rows.isEmpty { rows = [.empty()] }
              } label: {
                Label("Remove condition", systemImage: "minus.circle")
              }
              .labelStyle(.iconOnly)
              .buttonStyle(.borderless)
            }
          }
          if row.op == formIsOp {
            if let forms {
              Picker("Form", selection: $row.value) {
                if row.value.isEmpty { Text("Choose…").tag("") }
                if !row.value.isEmpty && !forms.contains(where: { $0.id == row.value }) {
                  Text("A form that is gone (\(row.value))").tag(row.value)
                }
                ForEach(forms) { Text($0.name).tag($0.id) }
              }
              .accessibilityIdentifier("condition-\(index)-form")
              AglynHelperText(row.value.isEmpty ? "Pick the form" : nil, isError: true)
            } else {
              AglynLabeledField("Form id", text: $row.value)
            }
          } else if !row.op.isEmpty {
            AglynLabeledField("Field", text: $row.field, placeholder: "subscribe")
              .accessibilityIdentifier("condition-\(index)-field")
          }
          if row.op == "equals" || row.op == "contains" {
            let flagged = draftPlaceholderIn(row.value) != nil
            AglynLabeledField(
              "Value", text: $row.value, placeholder: "Yes",
              helper: flagged ? "Replace the placeholder with the value to match" : nil, isError: flagged
            )
            .accessibilityIdentifier("condition-\(index)-value")
          }
        }
      }
      if rows.allSatisfy({ !$0.op.isEmpty }) {
        Button {
          rows.append(ConditionRow(op: "notEmpty", field: "", value: ""))
        } label: {
          Label("Add condition", systemImage: "plus")
        }
        .disabled(rows.count >= actionMaxConditions)
        .accessibilityIdentifier("add-condition")
        if rows.count >= 2 {
          Picker("Match", selection: $combinator) {
            Text("All conditions match (AND)").tag("and")
            Text("Any condition matches (OR)").tag("or")
          }
          .accessibilityIdentifier("condition-match")
        }
      }
    } header: {
      Text("Conditions")
    }
  }
}
