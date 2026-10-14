// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

#if canImport(UIKit)
  import UIKit
#elseif canImport(AppKit)
  import AppKit
#endif

/*
 * THE DEVICE'S OWN PRINT DIALOG. The console prints a receipt that has no cloud
 * printer through the browser's print dialog (`window.print()` from a hidden
 * frame, `pos-receipt.ts`): the page goes to whatever printers the computer
 * knows. This is that, on the device: AirPrint on an iPhone or iPad, the Mac's
 * print panel on a Mac. No printer driver and no SDK ship in the app; the
 * person picks the printer in the system's own sheet.
 */

public enum SystemPrintResult: Equatable, Sendable {
  case printed
  /// The person closed the print sheet.
  case canceled
  case failed(String)
}

@MainActor
public enum SystemPrinter {
  /// Whether this device can show a print sheet at all.
  public static var isAvailable: Bool {
    #if canImport(UIKit)
      return UIPrintInteractionController.isPrintingAvailable
    #elseif canImport(AppKit)
      return true
    #else
      return false
    #endif
  }

  /// Sends `text`, monospaced, to the system's print sheet. The receipt's 48 columns fit an 80 mm roll at this size.
  public static func printText(_ text: String, jobName: String) async -> SystemPrintResult {
    #if canImport(UIKit)
      guard UIPrintInteractionController.isPrintingAvailable else { return .failed("Printing is not available on this device.") }
      let info = UIPrintInfo(dictionary: nil)
      info.outputType = .general
      info.jobName = jobName
      let formatter = UISimpleTextPrintFormatter(text: text)
      formatter.font = UIFont.monospacedSystemFont(ofSize: 7, weight: .regular)
      formatter.perPageContentInsets = UIEdgeInsets(top: 18, left: 18, bottom: 18, right: 18)
      let controller = UIPrintInteractionController.shared
      controller.printInfo = info
      controller.printFormatter = formatter
      return await withCheckedContinuation { continuation in
        let shown = controller.present(animated: true) { _, completed, error in
          if let error {
            continuation.resume(returning: .failed(error.localizedDescription))
          } else {
            continuation.resume(returning: completed ? .printed : .canceled)
          }
        }
        if !shown { continuation.resume(returning: .failed("The print sheet could not be shown.")) }
      }
    #elseif canImport(AppKit)
      let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 260, height: 800))
      view.isEditable = false
      view.font = NSFont.monospacedSystemFont(ofSize: 7, weight: .regular)
      view.string = text
      let operation = NSPrintOperation(view: view, printInfo: (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo.shared)
      operation.jobTitle = jobName
      operation.showsPrintPanel = true
      return operation.run() ? .printed : .canceled
    #else
      return .failed("Printing is not available on this device.")
    #endif
  }
}
