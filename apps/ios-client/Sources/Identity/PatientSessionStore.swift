import Foundation

/// The signed-in patient's JWT, persisted in the Keychain so a returning user
/// skips straight past login (ADR-019). Separate from SubjectIdentityStore,
/// which stores the older pseudonymous per-session identity - the two aren't
/// interchangeable (a persistent login token vs. a random, unauthenticated id).
final class PatientSessionStore {
    private static let tokenKey = "patientAccessToken"
    private let store: SecretStore

    init(store: SecretStore = KeychainSecretStore()) {
        self.store = store
    }

    var token: String? { store.read(Self.tokenKey) }

    func save(token: String) {
        _ = store.write(Self.tokenKey, value: token)
    }

    func clear() {
        store.delete(Self.tokenKey)
    }
}
