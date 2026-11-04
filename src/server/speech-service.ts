import { createHash } from "node:crypto";
import { SpeechError, parseSpeechRequest, SPEECH_MAX_REQUEST_BYTES, type SpeechAudio, type SpeechCache, type SpeechProfile } from "../core/speech.ts";
import { createElevenLabsSynthesizer, type SynthesisRequest } from "./elevenlabs-speech.ts";

export type SpeechResult = SpeechAudio & { cache: "hit" | "miss"; warning?: string };
function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
export function speechCacheKey(text: string, profile: SpeechProfile): string {
	return createHash("sha256").update(canonical({ text, provider: "elevenlabs", normalization: 1, profile })).digest("hex");
}
export function createSpeechService({ cache, profile, key, synthesize = createElevenLabsSynthesizer(), maxConcurrent = 2 }: {
	cache: SpeechCache; profile: () => SpeechProfile; key: () => string | undefined;
	synthesize?: (request: SynthesisRequest) => Promise<SpeechAudio>; maxConcurrent?: number;
}) {
	const pending = new Map<string, Promise<SpeechResult>>();
	let generating = 0;
	return async (body: unknown): Promise<SpeechResult> => {
		const { text } = parseSpeechRequest(body);
		const selected = structuredClone(profile());
		if (!selected.voiceId || !selected.modelId) throw new SpeechError("speech_not_configured", "The default Mandarin voice has not been configured yet.", 503);
		const identity = speechCacheKey(text, selected);
		const existing = pending.get(identity);
		if (existing) return existing;
		const work = async (): Promise<SpeechResult> => {
			let warning: string | undefined;
			try { const saved = await cache.get(identity); if (saved) return { ...saved, cache: "hit" }; }
			catch { warning = "Audio cache is unavailable; replay in this window still works."; }
			const apiKey = key();
			if (!apiKey) throw new SpeechError("speech_key_missing", "Add your ElevenLabs API key in Settings → Providers → Read aloud.", 503);
			if (generating >= maxConcurrent) throw new SpeechError("speech_busy", "Speech generation is busy. Try again shortly.", 429);
			generating++;
			try {
				const result = await synthesize({ text, profile: selected as SpeechProfile & { voiceId: string }, apiKey });
				try { await cache.put(identity, result.audio, result.mimeType); }
				catch { warning = "Audio could not be saved; replay in this window still works."; }
				return { ...result, cache: "miss", ...(warning ? { warning } : {}) };
			} finally { generating--; }
		};
		// Defer work to ensure the map owns the request before any awaits complete.
		const request = Promise.resolve().then(work);
		pending.set(identity, request);
		try { return await request; }
		finally { if (pending.get(identity) === request) pending.delete(identity); }
	};
}

export function createSpeechHandler(service: (body: unknown) => Promise<SpeechResult>) {
	return async (request: Request): Promise<Response> => {
		const headers = { "Cache-Control": "private, no-store" };
		try {
			if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new SpeechError("invalid_request", "Send selected text as JSON.", 415);
			if (Number(request.headers.get("content-length")) > SPEECH_MAX_REQUEST_BYTES) throw new SpeechError("text_too_long", "Select less text to read.", 413);
			if (!request.body) throw new SpeechError("invalid_request", "Select text to read.", 400);
			const reader = request.body.getReader();
			const chunks: Uint8Array[] = []; let size = 0;
			try {
				while (true) { const { value, done } = await reader.read(); if (done) break;
					size += value.byteLength;
					if (size > SPEECH_MAX_REQUEST_BYTES) { void reader.cancel().catch(() => {}); throw new SpeechError("text_too_long", "Select less text to read.", 413); }
					chunks.push(value);
				}
			} finally { reader.releaseLock(); }
			let body: unknown;
			try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
			catch { throw new SpeechError("invalid_request", "The speech request was invalid.", 400); }
			const result = await service(body);
			return new Response(new Uint8Array(result.audio), { headers: {
				...headers, "Content-Type": result.mimeType, "X-Speech-Cache": result.cache,
				...(result.warning ? { "X-Speech-Cache-Warning": "unavailable" } : {}),
			} });
		} catch (error) {
			const failure = error instanceof SpeechError ? error : new SpeechError("speech_provider_failed", "Speech is unavailable. Try again.", 502);
			return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status, headers });
		}
	};
}
