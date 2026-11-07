/** Browser-safe contract for read-aloud. Generation and credentials remain server-side. */
export const SPEECH_MAX_CODE_POINTS = 2_000;
export const SPEECH_MAX_REQUEST_BYTES = 32 * 1024;
export const SPEECH_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const SPEECH_TIMEOUT_MS = 30_000;

/** Listening playback choices; these do not change the synthesis profile. */
export type SpeechPlaybackRate = 1 | 0.75;

export interface SpeechAudio {
	audio: Uint8Array;
	mimeType: string;
}

export interface SpeechCache {
	get(key: string): Promise<SpeechAudio | null>;
	put(key: string, audio: Uint8Array, mimeType: string): Promise<void>;
}

export interface SpeechProfile {
	profileVersion: string;
	modelId: string;
	voiceId: string | null;
	languageCode?: string;
	outputFormat: "mp3_44100_128";
	voiceSettings?: {
		stability?: number;
		similarity_boost?: number;
		style?: number;
		use_speaker_boost?: boolean;
		speed?: number;
	};
}

export type SpeechErrorCode =
	| "invalid_request" | "text_too_long" | "speech_not_configured"
	| "speech_key_missing" | "speech_auth_failed" | "speech_voice_unavailable" | "speech_payment_required"
	| "speech_rate_limited" | "speech_busy" | "speech_timeout"
	| "speech_provider_failed" | "speech_invalid_audio";

export interface SpeechErrorBody {
	error: { code: SpeechErrorCode; message: string };
}

export class SpeechError extends Error {
	constructor(readonly code: SpeechErrorCode, message: string, readonly status: number) {
		super(message);
		this.name = "SpeechError";
	}
}

/** Layout whitespace is immaterial; characters, script, case and punctuation are not. */
export function normalizeSpeechText(text: string): string {
	return text.replace(/[\t\r\n ]+/g, " ").trim();
}

export function parseSpeechRequest(body: unknown): { text: string } {
	if (!body || typeof body !== "object" || Array.isArray(body) ||
		typeof (body as Record<string, unknown>).text !== "string") {
		throw new SpeechError("invalid_request", "Select some text to read.", 400);
	}
	const text = normalizeSpeechText((body as { text: string }).text);
	if (!text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) {
		throw new SpeechError("invalid_request", "Select readable text to continue.", 400);
	}
	if ([...text].length > SPEECH_MAX_CODE_POINTS) {
		throw new SpeechError("text_too_long", `Select up to ${SPEECH_MAX_CODE_POINTS.toLocaleString("en-US")} characters at a time.`, 413);
	}
	return { text };
}
