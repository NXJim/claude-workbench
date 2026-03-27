/**
 * React hook wrapping the Web Speech API (SpeechRecognition).
 * Provides live transcription with interim results and auto-restart on silence timeout.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// Feature detection
const SpeechRecognitionClass =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined;

/** Human-readable error messages for SpeechRecognition error codes. */
function errorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
      return 'Microphone access denied. Allow microphone in browser settings.';
    case 'no-speech':
      return 'No speech detected. Try again.';
    case 'audio-capture':
      return 'No microphone found. Check your audio devices.';
    case 'network':
      return 'Network error. Speech recognition requires an internet connection.';
    case 'aborted':
      return 'Recognition was aborted.';
    case 'service-not-allowed':
      return 'Speech recognition service not available.';
    default:
      return `Recognition error: ${code}`;
  }
}

export interface SpeechRecognitionState {
  isSupported: boolean;
  isListening: boolean;
  interimTranscript: string;
  finalTranscript: string;
  error: string | null;
  startListening: (lang?: string) => void;
  stopListening: () => void;
  resetTranscript: () => void;
}

export function useSpeechRecognition(): SpeechRecognitionState {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isManualStopRef = useRef(false);
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Accumulated final transcript across multiple onresult events
  const accumulatedRef = useRef('');

  const stopListening = useCallback(() => {
    isManualStopRef.current = true;
    if (startTimeoutRef.current) {
      clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const resetTranscript = useCallback(() => {
    accumulatedRef.current = '';
    setFinalTranscript('');
    setInterimTranscript('');
    setError(null);
  }, []);

  const startListening = useCallback((lang = 'en-US') => {
    if (!SpeechRecognitionClass) return;

    // Stop any existing instance
    if (recognitionRef.current) {
      isManualStopRef.current = true;
      recognitionRef.current.stop();
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      // Clear the startup timeout — the service connected successfully
      if (startTimeoutRef.current) {
        clearTimeout(startTimeoutRef.current);
        startTimeoutRef.current = null;
      }
      setIsListening(true);
      setError(null);
      isManualStopRef.current = false;
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      // Process results from resultIndex onward (new since last event)
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          accumulatedRef.current += result[0].transcript;
          setFinalTranscript(accumulatedRef.current);
        } else {
          interim += result[0].transcript;
        }
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // 'no-speech' is common during silence — don't treat as fatal
      if (event.error === 'no-speech') return;
      // 'aborted' happens on manual stop — ignore
      if (event.error === 'aborted') return;

      setError(errorMessage(event.error));
      setIsListening(false);
    };

    recognition.onend = () => {
      // Chrome stops after ~60s of silence. Auto-restart unless the user
      // explicitly stopped or a fatal error occurred.
      if (!isManualStopRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          // Can fail if permissions were revoked mid-session
        }
      }
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      // Firefox exposes SpeechRecognition but has no working speech service —
      // start() succeeds silently but onstart never fires. Detect this with a timeout.
      startTimeoutRef.current = setTimeout(() => {
        startTimeoutRef.current = null;
        // If onstart hasn't fired by now, the service isn't working
        if (!isManualStopRef.current) {
          try { recognition.stop(); } catch { /* ignore */ }
          setIsListening(false);
          setError('Speech recognition service unavailable. This feature works best in Chrome or Edge.');
        }
      }, 3000);
    } catch {
      setError('Failed to start speech recognition.');
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (startTimeoutRef.current) {
        clearTimeout(startTimeoutRef.current);
      }
      if (recognitionRef.current) {
        isManualStopRef.current = true;
        recognitionRef.current.stop();
      }
    };
  }, []);

  return {
    isSupported: !!SpeechRecognitionClass,
    isListening,
    interimTranscript,
    finalTranscript,
    error,
    startListening,
    stopListening,
    resetTranscript,
  };
}
