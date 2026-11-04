import { normalizeSpeechText, SPEECH_MAX_CODE_POINTS } from "@/src/core";
const EXCLUDED = 'input,textarea,[contenteditable="true"]:not([data-speech-content]),[data-file-path-source],pre,code,.katex,svg,math,iframe,[hidden],[aria-hidden="true"],[data-speech-exclude],button:not([role="radio"]):not([role="checkbox"]),[role="menu"],[role="dialog"],[role="tooltip"]';
export function selectedSpeech(selection: Selection | null, scope: HTMLElement): { text: string; rect: DOMRect; error?: string } | null {
	if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
	const range = selection.getRangeAt(0);
	if (!scope.contains(range.startContainer) || !scope.contains(range.endContainer)) return null;
	const element = (node: Node) => node.nodeType === 1 ? node as Element : node.parentElement;
	const start = element(range.startContainer), end = element(range.endContainer);
	if (!start || !end || start.closest(EXCLUDED) || end.closest(EXCLUDED)) return null;
	const root = start.closest(".lh-prose,[data-speech-content]");
	if (!root) return null;
	const text = normalizeSpeechText(selection.toString());
	if (!text) return null;
	const rect = range.getBoundingClientRect();
	if (!rect.width && !rect.height) return null;
	let error: string | undefined;
	if (!root.contains(end)) error = "Select text within one passage to read.";
	for (const excluded of root.querySelectorAll(EXCLUDED)) {
		if (range.intersectsNode(excluded) && excluded.textContent?.trim()) error = "Select prose without code, formulas, or controls.";
	}
	if ([...text].length > SPEECH_MAX_CODE_POINTS) error = "Select up to 2,000 characters to read.";
	return { text, rect, ...(error ? { error } : {}) };
}
