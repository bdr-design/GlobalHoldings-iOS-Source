import SwiftUI
import UIKit

/// Standalone UI for a sandbox app owned by the user.
struct TrialUUIDView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var record: TrialUUIDRecord?
    @State private var copied = false
    private let store = TrialUUIDStore()

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Text("المعرّف التجريبي المحلي")
                    .font(.title2.bold())

                Text("UUID عشوائي صالح لمدة 24 ساعة داخل هذا التطبيق التجريبي فقط. لا يغيّر UDID أو IDFV أو معرّفات أي تطبيق آخر.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                if let record {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(record.value.uuidString)
                            .font(.system(.footnote, design: .monospaced))
                            .textSelection(.enabled)

                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            let seconds = record.remainingSeconds(at: context.date)
                            let valid = record.isValid(at: context.date)
                            Label(valid ? "صالح" : "منتهي", systemImage: valid ? "checkmark.circle.fill" : "clock.badge.xmark")
                                .foregroundStyle(valid ? .green : .orange)
                            Text("المتبقي: \(format(seconds))")
                                .monospacedDigit()
                        }

                        Text("ينتهي: \(record.expiresAt.formatted(date: .abbreviated, time: .standard))")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        Button(copied ? "تم النسخ" : "نسخ المعرّف") {
                            UIPasteboard.general.string = record.value.uuidString
                            copied = true
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding(16)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
                } else {
                    Text("لم يتم إنشاء معرّف تجريبي بعد")
                        .foregroundStyle(.secondary)
                }

                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let isActive = record?.isValid(at: context.date) ?? false
                    Button(record == nil ? "إنشاء UUID تجريبي" : "إنشاء UUID بعد انتهاء الصلاحية") {
                        record = store.generateIfExpired()
                        copied = false
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isActive)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("اختبار UUID")
            .onAppear { record = store.load() }
            .onChange(of: scenePhase) { phase in
                if phase == .active { record = store.load() }
            }
        }
        .environment(\.layoutDirection, .rightToLeft)
    }

    private func format(_ total: Int) -> String {
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        return String(format: "%02d:%02d:%02d", hours, minutes, seconds)
    }
}
