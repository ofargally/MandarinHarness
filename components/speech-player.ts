/** One session owns this handle; dictation and Escape can stop it synchronously. */
let stopCurrent: (() => boolean) | undefined;
export function stopSpeech(): boolean { return stopCurrent?.() ?? false; }
export type SpeechPlayerState = { phase: "idle" | "loading" | "ready" | "playing" | "error"; text: string; message?: string };
export type SpeechMedia = Pick<HTMLAudioElement, "play" | "pause" | "currentTime" | "onended" | "onerror" | "src" | "load">;
export function createSpeechPlayer(deps: {
	fetch: typeof fetch; audio: () => SpeechMedia; createURL: (blob: Blob) => string; revokeURL: (url: string) => void;
	blocked: () => boolean; changed: (state: SpeechPlayerState) => void;
}) {
	let token = 0, disposed = false;
	let media: SpeechMedia | undefined, url: string | undefined, loadedText = "";
	let abort: AbortController | undefined;
	let state: SpeechPlayerState = { phase: "idle", text: "" };
	function update(next: SpeechPlayerState) { state = next; if (!disposed) deps.changed(next); }
	function release() { if (media) { media.pause(); media.onended = null; media.onerror = null; media.src = ""; media.load(); } media = undefined; if (url) deps.revokeURL(url); url = undefined; loadedText = ""; }
	function stop() {
		const active = state.phase === "loading" || state.phase === "playing";
		token++; abort?.abort(); abort = undefined; media?.pause();
		if (active) update({ phase: media ? "ready" : "idle", text: state.text });
		return active;
	}
	async function play(current: number) {
		const target = media;
		if (!target || disposed || current !== token || deps.blocked()) return;
		target.currentTime = 0;
		update({ ...state, phase: "loading", text: loadedText });
		target.onended = () => { if (current === token) update({ phase: "ready", text: loadedText }); };
		target.onerror = () => { if (current === token) { release(); update({ phase: "error", text: state.text, message: "Audio could not be played. Try Read again." }); } };
		try {
			await target.play();
			if (disposed || current !== token || deps.blocked()) { target.pause(); return; }
			update({ ...state, phase: "playing", text: loadedText });
		} catch {
			if (current === token && !disposed) update({ ...state, phase: "ready", text: loadedText, message: "Press Read to start playback." });
		}
	}
	async function read(text: string) {
		if (disposed || deps.blocked()) return;
		if (state.phase === "loading" && state.text === text) return;
		stop(); const current = ++token;
		if (media && loadedText === text) { await play(current); return; }
		release(); abort = new AbortController();
		update({ phase: "loading", text });
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
			await play(current);
		} catch (error) {
			if (current === token && !disposed) update({ phase: "error", text, message: error instanceof Error ? error.message : "Speech is unavailable." });
		}
	}
	stopCurrent?.(); stopCurrent = stop;
	return { read, stop, dispose() { stop(); disposed = true; release(); if (stopCurrent === stop) stopCurrent = undefined; } };
}
