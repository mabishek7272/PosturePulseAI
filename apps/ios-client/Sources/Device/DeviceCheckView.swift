import SwiftUI

/// Re-reads the device whenever the screen appears or the app returns from
/// Settings, so turning the camera on (or Low Power Mode off) updates it live.
@MainActor
final class DeviceCheckModel: ObservableObject {
    @Published private(set) var readiness: DeviceReadiness
    private let capabilities: () -> DeviceCapabilities
    private let requestCamera: () async -> Bool

    init(capabilities: @escaping () -> DeviceCapabilities = { SystemDeviceCapabilities() },
         requestCamera: @escaping () async -> Bool = { await SystemDeviceCapabilities.requestCameraAccess() }) {
        self.capabilities = capabilities
        self.requestCamera = requestCamera
        readiness = DeviceReadiness(capabilities())
    }

    func refresh() { readiness = DeviceReadiness(capabilities()) }

    func perform(_ action: DeviceReadiness.Action) {
        switch action {
        case .none: break
        case .openSettings: SystemDeviceCapabilities.openSettings()
        case .allowCamera:
            Task {
                _ = await requestCamera()
                refresh()
            }
        }
    }
}

/// "Device check" card: camera permission (with an Allow / Open Settings
/// button), flashlight, depth sensor, screen-awake and power state.
struct DeviceCheckView: View {
    @ObservedObject var model: DeviceCheckModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Eyebrow("Device check", color: Theme.brand)
                .padding(.bottom, 10)
            ForEach(Array(model.readiness.items.enumerated()), id: \.element.id) { index, item in
                row(item)
                if index < model.readiness.items.count - 1 {
                    Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, 54)
                }
            }
        }
        .card()
        .onAppear { model.refresh() }
        .onChange(of: scenePhase) { phase in
            if phase == .active { model.refresh() }
        }
    }

    private func row(_ item: ReadinessItem) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol(for: item.status))
                .font(.title3)
                .foregroundColor(Theme.brand)
                .frame(width: 40, height: 40)
                .background(Circle().fill(item.status == .warning || item.status == .needsAction ? Theme.draftTint : Theme.brandTint))
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title).font(.headline).foregroundColor(Theme.ink)
                Text(item.detail).font(.footnote).foregroundColor(Theme.inkSoft).fixedSize(horizontal: false, vertical: true)
                if let label = buttonLabel(item) {
                    Button(label) { model.perform(item.action) }
                        .font(.subheadline.weight(.semibold))
                        .padding(.top, 2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }

    private func symbol(for status: ReadinessItem.Status) -> String {
        switch status {
        case .ready: return "checkmark"
        case .info: return "info"
        case .warning: return "exclamationmark"
        case .needsAction: return "hand.raised"
        }
    }

    private func buttonLabel(_ item: ReadinessItem) -> String? {
        switch item.action {
        case .none: return nil
        case .allowCamera: return "Allow camera"
        case .openSettings: return "Open Settings"
        }
    }
}
