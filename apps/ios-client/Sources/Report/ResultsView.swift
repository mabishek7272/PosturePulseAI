import SwiftUI

/// Patient mode results: each assessment this phone has a report-access token
/// for, and the released report once a clinician has signed it off.
struct ResultsView: View {
    let onBack: () -> Void

    private enum LoadState {
        case idle
        case loading
        case pending
        case report(AssessmentReport)
        case failed
    }

    @State private var entries: [ReportAccessStore.Entry] = []
    @State private var selected: ReportAccessStore.Entry?
    @State private var state: LoadState = .idle

    private let store = ReportAccessStore()
    private let client = ReportAccessClient()

    var body: some View {
        Group {
            if let selected, case .report(let report) = state {
                VStack(spacing: 0) {
                    backBar { self.selected = nil; state = .idle }
                    AssessmentReportView(report: report)
                }
                .paperBackground()
                .id(selected.sessionId)
            } else {
                list
            }
        }
        .onAppear { entries = store.all() }
    }

    private func backBar(_ action: @escaping () -> Void) -> some View {
        HStack {
            Button(action: action) {
                Label("Back", systemImage: "chevron.left").font(.subheadline.weight(.semibold))
            }
            Spacer()
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.vertical, 8)
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Button(action: onBack) {
                    Label("Back", systemImage: "chevron.left").font(.subheadline.weight(.semibold))
                }
                .padding(.top, 8)

                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Your results", color: Theme.brand)
                    Text("Assessments")
                        .font(Typo.hero)
                        .foregroundColor(Theme.ink)
                    Text("Results appear here after your clinician has reviewed and released them.")
                        .font(.callout)
                        .foregroundColor(Theme.inkSoft)
                }

                if entries.isEmpty {
                    Text("No assessments on this phone yet.")
                        .font(.callout)
                        .foregroundColor(Theme.inkSoft)
                }

                ForEach(entries, id: \.sessionId) { entry in
                    Button { open(entry) } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(entry.savedAt.formatted(date: .long, time: .shortened))
                                    .font(.headline.monospacedDigit())
                                    .foregroundColor(Theme.ink)
                                Spacer()
                                Image(systemName: "arrow.right").foregroundColor(Theme.brand)
                            }
                            if selected?.sessionId == entry.sessionId {
                                switch state {
                                case .loading:
                                    ProgressView()
                                case .pending:
                                    Label("Not released yet. Your clinician will review your results.", systemImage: "clock")
                                        .font(.footnote)
                                        .foregroundColor(Theme.inkSoft)
                                case .failed:
                                    Label("Could not reach your clinic's server. Try again later.", systemImage: "wifi.exclamationmark")
                                        .font(.footnote)
                                        .foregroundColor(Theme.inkSoft)
                                case .idle, .report:
                                    EmptyView()
                                }
                            }
                        }
                        .card()
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Theme.gutter)
            .readableColumn()
            .padding(.bottom, 28)
        }
        .paperBackground()
    }

    private func open(_ entry: ReportAccessStore.Entry) {
        selected = entry
        state = .loading
        Task {
            do {
                switch try await client.releasedReport(sessionId: entry.sessionId, token: entry.token) {
                case .pendingReview:
                    state = .pending
                case .released(let body):
                    state = .report(AssessmentReport(body: body))
                }
            } catch {
                state = .failed
            }
        }
    }
}
