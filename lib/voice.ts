export const VOICE_UNSUPPORTED_MESSAGE = "Voice is not supported in this browser. Please type.";
export const VOICE_PERMISSION_MESSAGE = "Allow the microphone to dictate, or please type.";
export const VOICE_NO_MIC_MESSAGE = "No microphone was found. Please type.";
export const VOICE_NETWORK_MESSAGE = "Voice could not connect. Please type.";
export const VOICE_SILENCE_MESSAGE = "Marge did not hear anything. Tap the mic and try again, or please type.";
export const VOICE_LISTENING_MESSAGE = "Listening… speak now. You can edit the text, then send. Tap the mic again to stop.";

const RECOGNITION_RESTART_MS = 250;
const SPEECH_CANCEL_GAP_MS = 50;
const SPEECH_CHUNK = 140;
const MAX_EMPTY_RESTARTS = 20;

export type RecognitionResult = {
  isFinal?: boolean;
  0?: { transcript?: string };
};

export type MinimalRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results?: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type SpeechCtor = new () => MinimalRecognition;

export type SpeechHost = {
  isSecureContext?: boolean;
  SpeechRecognition?: new () => object;
  webkitSpeechRecognition?: new () => object;
};

export type DictationHandlers = {
  onTranscript: (text: string) => void;
  onListening: (listening: boolean) => void;
  onMessage: (message: string | null) => void;
};

export type DictationSession = {
  start: () => boolean;
  stop: () => void;
  cancel: () => void;
};

type VoiceOption = {
  lang: string;
  name?: string;
  default?: boolean;
  localService?: boolean;
};

type SpeechSynth<Utterance> = {
  cancel: () => void;
  speak: (utterance: Utterance) => void;
  resume?: () => void;
  getVoices?: () => readonly VoiceOption[];
};

export function prefersContinuousRecognition(userAgent: string, maxTouchPoints = 0, platform = ""): boolean {
  const ios = /iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  const safariDesktop =
    /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPR|Android/i.test(userAgent);
  return !ios && !safariDesktop;
}

export function speechRecognitionCtor(host: SpeechHost | null | undefined): SpeechCtor | null {
  if (!host || host.isSecureContext === false) return null;
  const Ctor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  return (Ctor as SpeechCtor | undefined) ?? null;
}

export function transcriptFromResults(results: ArrayLike<RecognitionResult> | null | undefined): string {
  if (!results) return "";
  const parts: string[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const transcript = results[index]?.[0]?.transcript?.replace(/\s+/g, " ").trim();
    if (transcript) parts.push(transcript);
  }
  return parts.join(" ");
}

export function composeDictation(base: string, heard: string): string {
  const prefix = base.replace(/\s+/g, " ").trim();
  const next = heard.replace(/\s+/g, " ").trim();
  if (!prefix) return next;
  if (!next) return prefix;
  return `${prefix} ${next}`;
}

export function dictationValue(base: string, results: ArrayLike<RecognitionResult> | null | undefined): string {
  return composeDictation(base, transcriptFromResults(results));
}

export function assistantSpeech(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .map((part) => (part.type === "text" && part.text ? part.text : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function actionForRecognitionError(error: string): { keepListening: boolean; message: string | null } {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return { keepListening: false, message: VOICE_PERMISSION_MESSAGE };
    case "audio-capture":
      return { keepListening: false, message: VOICE_NO_MIC_MESSAGE };
    case "network":
      return { keepListening: false, message: VOICE_NETWORK_MESSAGE };
    case "aborted":
      return { keepListening: false, message: null };
    default:
      return { keepListening: true, message: null };
  }
}

export function speechChunks(text: string, maxLength = SPEECH_CHUNK): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const chunks: string[] = [];
  let rest = cleaned;
  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf(" ", maxLength);
    if (cut < Math.floor(maxLength * 0.5)) cut = maxLength;
    const piece = rest.slice(0, cut).trim();
    if (piece) chunks.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function pickEnglishVoice<T extends VoiceOption>(voices: readonly T[]): T | null {
  const english = voices.filter((voice) => /^en(-|$)/i.test(voice.lang));
  const pool = english.length > 0 ? english : [...voices];
  return (
    pool.find((voice) => voice.default && /^en-US/i.test(voice.lang)) ??
    pool.find((voice) => /^en-US/i.test(voice.lang) && voice.localService) ??
    pool.find((voice) => /^en-US/i.test(voice.lang)) ??
    pool.find((voice) => voice.localService) ??
    pool[0] ??
    null
  );
}

export function queueSpeech<Voice extends VoiceOption, Utterance>(
  synth: SpeechSynth<Utterance>,
  text: string,
  createUtterance: (chunk: string, voice: Voice | null) => Utterance,
  schedule: (fn: () => void, delayMs: number) => void = (fn, delayMs) => {
    setTimeout(fn, delayMs);
  },
  immediate = false,
): Utterance[] {
  const chunks = speechChunks(text);
  if (chunks.length === 0) return [];
  const voice = pickEnglishVoice(synth.getVoices?.() ?? []) as Voice | null;
  const utterances = chunks.map((chunk) => createUtterance(chunk, voice));
  const speakAll = () => {
    try {
      synth.resume?.();
      for (const utterance of utterances) synth.speak(utterance);
    } catch {
      /* The reply stays on screen when this browser will not speak. */
    }
  };
  if (immediate) {
    speakAll();
    return utterances;
  }
  synth.cancel();
  schedule(speakAll, SPEECH_CANCEL_GAP_MS);
  return utterances;
}

function thrownName(error: unknown): string {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) return error.name;
  if (error && typeof error === "object" && "name" in error && typeof (error as { name: unknown }).name === "string") {
    return (error as { name: string }).name;
  }
  return "";
}

export function attachDictation(
  recognition: MinimalRecognition,
  handlers: DictationHandlers,
  options?: {
    schedule?: (fn: () => void, delayMs: number) => void;
    restartDelayMs?: number;
    maxRestarts?: number;
    continuous?: boolean;
  },
): DictationSession {
  const schedule = options?.schedule ?? ((fn: () => void, delayMs: number) => {
    setTimeout(fn, delayMs);
  });
  const restartDelayMs = options?.restartDelayMs ?? RECOGNITION_RESTART_MS;
  const maxRestarts = options?.maxRestarts ?? MAX_EMPTY_RESTARTS;
  const continuous = options?.continuous ?? true;
  let userStopped = false;
  let acceptResults = true;
  let heardSomething = false;
  let restarts = 0;
  let failed = false;

  recognition.lang = "en-US";
  recognition.continuous = continuous;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  const stopForGood = (message: string | null) => {
    userStopped = true;
    acceptResults = false;
    handlers.onListening(false);
    if (message) handlers.onMessage(message);
  };

  recognition.onstart = () => {
    failed = false;
    handlers.onListening(true);
  };

  recognition.onresult = (event) => {
    if (!acceptResults) return;
    const heard = transcriptFromResults(event.results);
    if (!heard) return;
    heardSomething = true;
    restarts = 0;
    handlers.onTranscript(heard);
  };

  recognition.onerror = (event) => {
    const action = actionForRecognitionError(event.error ?? "");
    if (!action.keepListening) {
      failed = true;
      stopForGood(action.message);
      return;
    }
    if (action.message) handlers.onMessage(action.message);
  };

  recognition.onend = () => {
    if (userStopped) {
      acceptResults = false;
      handlers.onListening(false);
      return;
    }
    restarts += 1;
    if (restarts > maxRestarts) {
      stopForGood(heardSomething ? null : VOICE_SILENCE_MESSAGE);
      return;
    }
    schedule(() => {
      if (userStopped) return;
      try {
        recognition.start();
      } catch (error) {
        if (thrownName(error) === "InvalidStateError") return;
        stopForGood(heardSomething ? VOICE_NETWORK_MESSAGE : VOICE_UNSUPPORTED_MESSAGE);
      }
    }, restartDelayMs);
  };

  return {
    start() {
      userStopped = false;
      failed = false;
      acceptResults = true;
      restarts = 0;
      try {
        recognition.start();
      } catch (error) {
        if (thrownName(error) === "InvalidStateError") return true;
        stopForGood(thrownName(error) === "NotAllowedError" ? VOICE_PERMISSION_MESSAGE : VOICE_UNSUPPORTED_MESSAGE);
        return false;
      }
      return !failed && !userStopped;
    },
    stop() {
      userStopped = true;
      handlers.onListening(false);
      try {
        recognition.stop();
      } catch {
        try {
          recognition.abort();
        } catch {
          acceptResults = false;
        }
      }
    },
    cancel() {
      stopForGood(null);
      try {
        recognition.abort();
      } catch {
        try {
          recognition.stop();
        } catch {
          /* The session had already ended. */
        }
      }
    },
  };
}
