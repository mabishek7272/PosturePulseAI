import AVFoundation
import Foundation

/// Speaks step instructions and guidance prompts in Patient mode.
protocol InstructionSpeaking: AnyObject {
    func speak(_ text: String)
    func stop()
}

final class SpeechInstructionSpeaker: InstructionSpeaking {
    private let synthesizer = AVSpeechSynthesizer()

    func speak(_ text: String) {
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .word) }
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
        synthesizer.speak(utterance)
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
    }
}
