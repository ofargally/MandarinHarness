"use client";

import { useEffect, useRef, useState } from "react";
import { HeadphonesIcon, PlayIcon, SquareIcon } from "lucide-react";
import { isDictationActive, useDictationActive } from "./dictation-state";
import { createSpeechPlayer, type SpeechPlayerState } from "./speech-player";
import type { SpeechPlaybackRate } from "@/src/core";

/** Intentionally never renders text: the sentence is a post-answer transcript. */
export function ListeningAudio({ text, active = true, disabled = false, onStarted, onCompleted, onContinue }: {
	text: string;
	active?: boolean;
	disabled?: boolean;
	onStarted?: (rate: SpeechPlaybackRate) => void;
	onCompleted?: () => void;
	onContinue?: () => void;
}) {
	const player = useRef<ReturnType<typeof createSpeechPlayer> | null>(null);
	const completed = useRef(onCompleted);
	completed.current = onCompleted;
	const started = useRef(onStarted);
	started.current = onStarted;
	const [state, setState] = useState<SpeechPlayerState>({ phase: "idle", text: "" });
	const [failures, setFailures] = useState(0);
	const dictating = useDictationActive();
	useEffect(() => {
		setState({ phase: "idle", text: "" });
		setFailures(0);
		const controller = createSpeechPlayer({
			fetch: (...args) => fetch(...args), audio: () => new Audio(),
			createURL: blob => URL.createObjectURL(blob), revokeURL: url => URL.revokeObjectURL(url),
			blocked: isDictationActive, playLabel: "Play",
			changed: next => { setState(next); if (next.phase === "error") setFailures(n => n + 1); },
			started: rate => started.current?.(rate),
			ended: () => completed.current?.(),
		});
		player.current = controller;
		const stop = () => { controller.stop(); };
		window.addEventListener("pagehide", stop);
		return () => { window.removeEventListener("pagehide", stop); controller.dispose(); player.current = null; };
	}, [text]);
	useEffect(() => { if (!active) player.current?.stop(); }, [active]);
	const busy = state.phase === "loading" || state.phase === "playing";
	const status = dictating ? "Stop dictation before playing the sentence."
		: state.message ?? (state.phase === "loading" ? "Preparing audio…" : state.phase === "playing" ? state.rate === 0.75 ? "Listening at 0.75×…" : "Listening…" : "Play at 1× or 0.75×, then answer. Replay as often as you need.");
	return (
		<div data-testid="listening-audio" data-speech-exclude="" className="mb-3 min-w-0 rounded-lg border border-border bg-muted/30 p-3"
			onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}>
			<div className="flex flex-wrap items-center gap-2">
				<span className="mr-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"><HeadphonesIcon className="size-4" /> Listen</span>
				<button type="button" data-testid="listening-play" disabled={(state.phase === "loading" && state.rate === 1) || dictating || disabled || !active}
					className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
					onClick={() => void player.current?.read(text)}><PlayIcon className="size-3.5" />{state.phase === "error" ? "Retry" : "Play"}</button>
				<button type="button" data-testid="listening-slow" aria-label="Play at 0.75 times normal speed" disabled={(state.phase === "loading" && state.rate === 0.75) || dictating || disabled || !active}
					className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
					onClick={() => void player.current?.read(text, 0.75)}>0.75×</button>
				{busy && <button type="button" onClick={() => player.current?.stop()} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm hover:bg-accent"><SquareIcon className="size-3.5" /> Stop</button>}
				{failures >= 2 && state.phase === "error" && onContinue && <button type="button" data-testid="listening-continue" disabled={disabled || !active} onClick={onContinue} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">Continue another way</button>}
			</div>
			<p role="status" className="mt-2 break-words text-xs text-muted-foreground">{status}</p>
		</div>
	);
}
