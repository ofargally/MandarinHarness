import {
	SpeechError, SPEECH_MAX_AUDIO_BYTES, SPEECH_TIMEOUT_MS,
	type SpeechAudio, type SpeechProfile,
} from "../core/speech.ts";

export interface SynthesisRequest {
	text: string;
	profile: SpeechProfile & { voiceId: string };
	apiKey: string;
}

/** Bounded binary reader: do not trust Content-Length alone. */
async function readAudio(response: Response, signal: AbortSignal): Promise<Uint8Array> {
	if (!response.body) throw new SpeechError("speech_invalid_audio", "The speech service returned no audio. Try again.", 502);
	const declaredLength = Number(response.headers.get("content-length"));
	if (declaredLength > SPEECH_MAX_AUDIO_BYTES) {
		await response.body.cancel();
		throw new SpeechError("speech_invalid_audio", "The generated audio is too large. Select less text.", 502);
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > SPEECH_MAX_AUDIO_BYTES) throw new SpeechError("speech_invalid_audio", "The generated audio is too large. Select less text.", 502);
			chunks.push(value);
		}
	} catch (error) {
		void reader.cancel().catch(() => {});
		throw error;
	} finally {
		reader.releaseLock();
	}
	const audio = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.byteLength; }
	// MP3 may start with an ID3 tag or an MPEG audio frame header. This also
	// catches an upstream JSON/HTML error mistakenly labeled audio/mpeg.
	const id3 = size >= 10 && audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33;
	const frame = size >= 4 && audio[0] === 0xff && (audio[1]! & 0xe0) === 0xe0;
	if (!id3 && !frame) throw new SpeechError("speech_invalid_audio", "The speech service returned unusable audio. Try again.", 502);
	return audio;
}

/** No automatic retries: a failed connection may already have been billed. */
export function createElevenLabsSynthesizer(options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
	const fetcher = options.fetch ?? fetch;
	return async ({ text, profile, apiKey }: SynthesisRequest): Promise<SpeechAudio> => {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				controller.abort();
				reject(new SpeechError("speech_timeout", "Speech generation took too long. Try again.", 504));
			}, options.timeoutMs ?? SPEECH_TIMEOUT_MS);
		});
		const work = async () => {
			const response = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(profile.voiceId)}?output_format=${profile.outputFormat}`, {
				method: "POST",
				headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
				body: JSON.stringify({ text, model_id: profile.modelId,
					...(profile.languageCode && profile.modelId !== "eleven_multilingual_v2" ? { language_code: profile.languageCode } : {}),
					...(profile.voiceSettings ? { voice_settings: profile.voiceSettings } : {}),
				}),
				signal: controller.signal,
				redirect: "error",
			});
			if (!response.ok) {
				void response.body?.cancel().catch(() => {});
				if (response.status === 402) throw new SpeechError("speech_payment_required", "ElevenLabs requires a paid plan for this voice or request. Use a voice available on your plan, or update your ElevenLabs subscription.", 402);
				if (response.status === 401 || response.status === 403) throw new SpeechError("speech_auth_failed", "ElevenLabs rejected the API key or its permissions. Check Providers in settings.", 502);
				if (response.status === 404) throw new SpeechError("speech_voice_unavailable", "The configured ElevenLabs voice is unavailable. Check the speech profile.", 502);
				if (response.status === 429) throw new SpeechError("speech_rate_limited", "ElevenLabs is rate-limiting requests or your quota is exhausted. Check your account and try again later.", 429);
				throw new SpeechError("speech_provider_failed", "ElevenLabs could not generate this audio. Check your account or try again.", 502);
			}
			const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
			if (mimeType !== "audio/mpeg" && mimeType !== "audio/mp3") {
				void response.body?.cancel().catch(() => {});
				throw new SpeechError("speech_invalid_audio", "The speech service returned an unsupported audio format.", 502);
			}
			return { audio: await readAudio(response, controller.signal), mimeType: "audio/mpeg" };
		};
		try {
			return await Promise.race([work(), timeout]);
		} catch (error) {
			if (error instanceof SpeechError) throw error;
			if (controller.signal.aborted) throw new SpeechError("speech_timeout", "Speech generation took too long. Try again.", 504);
			throw new SpeechError("speech_provider_failed", "Could not reach ElevenLabs. Check your connection and try again.", 502);
		} finally { clearTimeout(timer); }
	};
}
