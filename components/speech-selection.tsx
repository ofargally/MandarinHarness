"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isDictationActive, useDictationActive } from "./dictation-state";
import { createSpeechPlayer, type SpeechPlayerState } from "./speech-player";
import { selectedSpeech } from "./speech-selection-dom";

export function SpeechSelection() {
	const marker = useRef<HTMLSpanElement>(null);
	const popup = useRef<HTMLDivElement>(null);
	const player = useRef<ReturnType<typeof createSpeechPlayer> | null>(null);
	const [candidate, setCandidate] = useState<ReturnType<typeof selectedSpeech>>(null);
	const [state, setState] = useState<SpeechPlayerState>({ phase: "idle", text: "" });
	const dictating = useDictationActive();
	useEffect(() => {
		const controller = createSpeechPlayer({ fetch: (...args) => fetch(...args), audio: () => new Audio(), createURL: blob => URL.createObjectURL(blob), revokeURL: url => URL.revokeObjectURL(url), blocked: isDictationActive, changed: setState });
		player.current = controller;
		const scope = marker.current?.closest<HTMLElement>("[data-speech-scope]");
		const update = () => {
			if (popup.current?.contains(document.activeElement)) return;
			setCandidate(scope ? selectedSpeech(window.getSelection(), scope) : null);
		};
		const hide = () => setCandidate(null);
		const stop = () => { controller.stop(); hide(); };
		const keyboard = (event: KeyboardEvent) => {
			// Reach the popup without altering the application's global Tab behavior.
			if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && scope && selectedSpeech(window.getSelection(), scope)) {
				const button = popup.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
				if (button && !popup.current?.contains(document.activeElement)) { event.preventDefault(); event.stopPropagation(); button.focus(); }
			}
		};
		document.addEventListener("selectionchange", update);
		document.addEventListener("keydown", keyboard);
		window.addEventListener("scroll", hide, true); window.addEventListener("resize", hide);
		window.addEventListener("pagehide", stop);
		return () => { controller.dispose(); player.current = null; document.removeEventListener("selectionchange", update); document.removeEventListener("keydown", keyboard); window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); window.removeEventListener("pagehide", stop); };
	}, []);
	const visible = candidate || state.phase !== "idle";
	const text = candidate?.text ?? state.text;
	const status = candidate?.error ?? (dictating ? "Stop dictation to read aloud." : state.message ?? (state.phase === "loading" ? "Preparing audio…" : state.phase === "playing" ? "Reading…" : ""));
	const style = candidate ? { left: Math.max(8, Math.min(candidate.rect.left, window.innerWidth - 296)), top: Math.max(8, Math.min(candidate.rect.bottom + 8, window.innerHeight - 120)) } : { right: 16, bottom: 100 };
	return <><span ref={marker} hidden />{visible && typeof document !== "undefined" && createPortal(
		<div ref={popup} data-speech-exclude="" data-testid="speech-popup" role="group" aria-label="Read selected text" style={style} className="fixed z-[80] max-w-[min(280px,calc(100vw-16px)) rounded-lg border border-border bg-popover p-2 text-sm text-popover-foreground shadow-lg" onKeyDown={e => { if (e.key === "Tab") e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); player.current?.stop(); setState({ phase: "idle", text: "" }); setCandidate(null); } }}>
			<div className="flex items-center gap-2">
				<button type="button" className="rounded border border-border px-3 py-1 hover:bg-accent focus-visible:ring-1 focus-visible:ring-foreground" disabled={dictating || !!candidate?.error || !text || (state.phase === "loading" && state.text === text)} onPointerDown={e => e.preventDefault()} onClick={() => void player.current?.read(text)}>Read</button>
				{(state.phase === "loading" || state.phase === "playing") && <button type="button" className="rounded px-2 py-1 hover:bg-accent" onClick={() => player.current?.stop()}>Stop</button>}
				<button type="button" aria-label="Close read controls" className="ml-auto rounded px-2 py-1 hover:bg-accent" onClick={() => { player.current?.stop(); setState({ phase: "idle", text: "" }); setCandidate(null); }}>×</button>
			</div>
			{status && <p role="status" className="mt-2 break-words text-xs text-muted-foreground">{status}</p>}
		</div>, document.body)}</>;
}
