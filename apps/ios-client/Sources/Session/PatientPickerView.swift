import SwiftUI

/// Clinic mode: find or add the patient in the clinic's server register
/// (ADR-017) before consent and the battery. Names and dates of birth are
/// shown here only; they are never stored on the device or sent anywhere but
/// /patients.
struct PatientPickerView: View {
    let clinicianToken: String
    let onPicked: (PatientSummary) -> Void
    let onBack: () -> Void

    @State private var query = ""
    @State private var results: [PatientSummary] = []
    @State private var hasSearched = false
    @State private var isBusy = false
    @State private var errorMessage: String?
    @State private var addingNew = false
    @State private var newName = ""
    @State private var newDateOfBirth = Calendar.current.date(byAdding: .year, value: -40, to: Date()) ?? Date()
    @State private var newContact = ""

    private var client: PatientsClient { PatientsClient(clinicianToken: clinicianToken) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Button(action: onBack) {
                    Label("Back", systemImage: "chevron.left").font(.subheadline.weight(.semibold))
                }
                .padding(.top, 8)

                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Clinic mode", color: Theme.brand)
                    Text("Who is being assessed?")
                        .font(Typo.hero)
                        .foregroundColor(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundColor(Theme.inkSoft)
                    TextField("Search by name", text: $query)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .onSubmit(search)
                    if isBusy { ProgressView() }
                }
                .card()

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundColor(Theme.ink)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.draftTint))
                }

                if !results.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(results) { patient in
                            Button { onPicked(patient) } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(patient.name ?? "Unnamed").font(.headline).foregroundColor(Theme.ink)
                                        if let dob = patient.dateOfBirth {
                                            Text("Born " + dob).font(.footnote.monospacedDigit()).foregroundColor(Theme.inkSoft)
                                        }
                                    }
                                    Spacer()
                                    Image(systemName: "arrow.right").foregroundColor(Theme.brand)
                                }
                                .padding(.vertical, 12)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            if patient.id != results.last?.id {
                                Rectangle().fill(Theme.hairline).frame(height: 1)
                            }
                        }
                    }
                    .card()
                } else if hasSearched && !isBusy {
                    Text("No patient found. Check the spelling or add a new patient.")
                        .font(.footnote)
                        .foregroundColor(Theme.inkSoft)
                }

                if addingNew {
                    newPatientForm
                } else {
                    Button {
                        addingNew = true
                        if newName.isEmpty { newName = query }
                    } label: {
                        Label("Add a new patient", systemImage: "person.badge.plus")
                            .font(.subheadline.weight(.semibold))
                    }
                }
            }
            .padding(.horizontal, Theme.gutter)
            .readableColumn()
            .padding(.bottom, 28)
        }
        .paperBackground()
    }

    private var newPatientForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow("New patient")
            TextField("Full name", text: $newName)
                .textContentType(.name)
                .textInputAutocapitalization(.words)
            Divider()
            DatePicker("Date of birth", selection: $newDateOfBirth, in: ...Date(), displayedComponents: .date)
            Divider()
            TextField("Contact (optional)", text: $newContact)
                .textInputAutocapitalization(.never)
            Button(action: create) {
                if isBusy { ProgressView().tint(.white) } else { Text("Add and continue") }
            }
            .buttonStyle(.primary)
            .disabled(isBusy || newName.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .card()
    }

    private func search() {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, !isBusy else { return }
        isBusy = true
        errorMessage = nil
        Task {
            defer { isBusy = false; hasSearched = true }
            do {
                results = try await client.search(q)
            } catch {
                errorMessage = "Could not search the patient register. Check your connection and try again."
            }
        }
    }

    private func create() {
        guard !isBusy else { return }
        isBusy = true
        errorMessage = nil
        let components = Calendar.current.dateComponents([.year, .month, .day], from: newDateOfBirth)
        Task {
            defer { isBusy = false }
            do {
                let patient = try await client.create(
                    name: newName.trimmingCharacters(in: .whitespaces),
                    dateOfBirth: components,
                    contact: newContact.trimmingCharacters(in: .whitespaces)
                )
                onPicked(patient)
            } catch {
                errorMessage = "Could not add the patient. Check your connection and try again."
            }
        }
    }
}
