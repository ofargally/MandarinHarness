import type { SpeechPlaybackRate } from "@/src/core";

/** One session owns this handle; dictation and Escape can stop it synchronously. */
let stopCurrent: (() => boolean) | undefined;
export function stopSpeech(): boolean { return stopCurrent?.() ?? false; }
export type SpeechPlayerState = { phase: "idle" | "loading" | "ready" | "playing" | "error"; text: string; rate?: SpeechPlaybackRate; message?: string };
export type SpeechMedia = Pick<HTMLAudioElement, "play" | "pause" | "currentTime" | "onended" | "onerror" | "src" | "load" | "playbackRate" | "preservesPitch">;
export function createSpeechPlayer(deps: {
	fetch: typeof fetch; audio: () => SpeechMedia; createURL: (blob: Blob) => string; revokeURL: (url: string) => void;
	blocked: () => boolean; changed: (state: SpeechPlayerState) => void;
	started?: (rate: SpeechPlaybackRate) => void;
	ended?: (rate: SpeechPlaybackRate) => void;
	playLabel?: string;
}) {
	let token = 0, disposed = false;
	let requestedRate: SpeechPlaybackRate = 1;
	let activePlayToken: number | undefined;
	let media: SpeechMedia | undefined, url: string | undefined, loadedText = "";
	let abort: AbortController | undefined;
	let state: SpeechPlayerState = { phase: "idle", text: "" };
	function update(next: SpeechPlayerState) { state = next; if (!disposed) deps.changed(next); }
	function release() { activePlayToken = undefined; if (media) { media.pause(); media.onended = null; media.onerror = null; media.src = ""; media.load(); } media = undefined; if (url) deps.revokeURL(url); url = undefined; loadedText = ""; }
	function stop() {
		const active = state.phase === "loading" || state.phase === "playing";
		token++; activePlayToken = undefined; abort?.abort(); abort = undefined; media?.pause();
		if (active) update({ phase: media ? "ready" : "idle", text: state.text, rate: state.rate });
		return active;
	}
	async function play(current: number, rate: SpeechPlaybackRate) {
		const target = media;
		if (!target || disposed || current !== token || deps.blocked()) return;
		target.currentTime = 0;
		target.playbackRate = rate;
		target.preservesPitch = true;
		activePlayToken = current;
		update({ ...state, phase: "loading", text: loadedText, rate });
		target.onended = () => { if (!disposed && current === token) { activePlayToken = undefined; update({ phase: "ready", text: loadedText, rate }); deps.ended?.(rate); } };
		target.onerror = () => {
			if (disposed || current !== token) return;
			// A decoder error can also reject play(). Invalidate that promise
			// so one failed attempt reports exactly one retryable error.
			token++;
			release();
			update({ phase: "error", text: state.text, message: `Audio could not be played. Try ${deps.playLabel ?? "Read"} again.` });
		};
		try {
			await target.play();
			if (disposed || current !== token || deps.blocked()) {
				// A superseded play() may settle after a speed switch on the same
				// media element. It must not pause the newer playback.
				if (disposed || deps.blocked() || target !== media || activePlayToken !== token) target.pause();
				return;
			}
			update({ ...state, phase: "playing", text: loadedText, rate });
			deps.started?.(rate);
		} catch {
			if (current === token && !disposed) { release(); update({ phase: "error", text: state.text, message: `Audio could not start. Press ${deps.playLabel ?? "Read"} to retry.` }); }
		}
	}
	async function read(text: string, rate: SpeechPlaybackRate = 1) {
		if (disposed || deps.blocked()) return;
		requestedRate = rate;
		if (state.phase === "loading" && state.text === text && !media) {
			// Choose the eventual playback speed without fetching the same audio twice.
			update({ ...state, rate });
			return;
		}
		if (stopCurrent !== stop) stopCurrent?.();
		stopCurrent = stop;
		stop(); const current = ++token;
		if (media && loadedText === text) { await play(current, rate); return; }
		release(); abort = new AbortController();
		update({ phase: "loading", text, rate });
		try {
			const response = await deps.fetch("/api/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: abort.signal });
			if (!response.ok) {
				const body = await response.json().catch(() => null);
				throw new Error(typeof body?.error?.message === "string" ? body.error.message : "Speech is unavailable. Try again.");
			}
			if (!response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Speech returned unusable audio. Try again.");
			const blob = await response.blob();
			if (disposed || current !== token || deps.blocked()) return;
			url = deps.createURL(blob); media = deps.audio(); media.src = url; loadedText = text;
			update({ phase: "ready", text, ...(response.headers.has("X-Speech-Cache-Warning") ? { message: "Audio could not be saved; replay here still works." } : {}) });
			await play(current, requestedRate);
		} catch (error) {
			if (current === token && !disposed) update({ phase: "error", text, message: error instanceof Error ? error.message : "Speech is unavailable." });
		}
	}
	// Claim on playback, not mount: read-aloud and listening controls may coexist.
	return { read, stop, dispose() { stop(); disposed = true; release(); if (stopCurrent === stop) stopCurrent = undefined; } };
}
