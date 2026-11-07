import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { unlinkSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Value } from "typebox/value";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createProberTools, createTeacherTools } from "../src/agent/tools.ts";
import { chatStore } from "../src/store/chats.ts";
import { jobStore } from "../src/store/jobs.ts";
import { PATHS } from "../config.ts";
import { audioFailureAnswer, buildAnswer, compactAnswerForModel, type QuestionData } from "../src/core/question-core.ts";
import { parseExplainInput, parseQuizInput } from "../src/core/tool-parts.ts";
import { newAnswerResult, pendingQuestionOf, needsContinuation, type LhMessage } from "../src/core/native-messages.ts";
import { inputAppends } from "../src/core/input-events.ts";
import { messageMarkdown } from "../src/core/session-markdown.ts";
import { QuestionDock } from "../components/question-dock.tsx";
import { AnsweredCard } from "../components/answered-card.tsx";
import { answerForPresentation } from "../src/core/answer-presentation.ts";

const text = "我想要一杯热茶。";
const quiz = {
	listening: { text }, question: "What does the speaker want?",
	options: [{ label: "Hot tea", value: "tea" }, { label: "Coffee", value: "coffee" }],
	explanation: "The speaker requests hot tea.", correctAnswer: "tea", type: "check", nodeId: "drinks",
};
const recall = { listening: { text }, question: "What does the speaker want?", correctAnswer: "A cup of hot tea.", type: "check", nodeId: "drinks" };
const chat = chatStore.createChat("Listening fixture");
chatStore.saveTree(chat.id, { nodes: [{ id: "drinks", title: "Drinks" }], edges: [], version: 1 });
after(() => { unlinkSync(path.join(PATHS.chats, `${chat.id}.json`)); });
const ctx = { chatId: chat.id, chatStore, jobStore, spawn: () => {}, deliver: () => {} };

for (const free of [false, true]) for (const phase of ["probe", "teach"] as const) {
	test(`both listening formats are valid in ${phase} with ordinary ${free ? "free recall" : "MCQ"}`, async () => {
		const tools = phase === "probe" ? createProberTools(ctx, { explain: free }) : createTeacherTools(ctx, { explain: free });
		const names = phase === "probe" ? ["probe", "recall"] : ["quiz", "explain"];
		for (const [i, name] of names.entries()) {
			const tool = tools[name!]!;
			const input = i === 0 ? quiz : recall;
			assert.equal(Value.Check(tool.parameters, input), true);
			assert.equal((await tool.execute("audio-question", input)).isError, undefined);
			const { listening: _audio, ...ordinary } = input;
			const isPreferred = i === (free ? 1 : 0);
			assert.equal(Value.Check(tool.parameters, ordinary), isPreferred);
			if (!isPreferred) assert.equal((await tool.execute("ordinary", ordinary)).isError, true, "execute also enforces listening-only alternate");
		}
		if (phase === "teach") assert.equal((await tools[names[0]!]!.execute("bad-node", { ...quiz, nodeId: "missing" })).isError, true);
	});
}

test("listening survives display parsing; malformed speech and listening multiselect do not become pending", () => {
	assert.deepEqual(parseQuizInput(quiz)?.listening, { text });
	assert.deepEqual(parseExplainInput(recall)?.listening, { text });
	for (const listening of [{ text: "  " }, { text: "a\u0000b" }, { text: "字".repeat(2001) }, { text: {} }]) {
		assert.equal(parseQuizInput({ ...quiz, listening }), undefined);
		assert.equal(parseExplainInput({ ...recall, listening }), undefined);
	}
	assert.equal(parseQuizInput({ ...quiz, multiSelect: true }), undefined);
	assert.ok(parseQuizInput({ ...quiz, listening: undefined, multiSelect: true }), "ordinary multiselect is unchanged");
});

function question(kind: "quiz" | "explain"): QuestionData {
	return { id: "listen-1", kind, question: quiz.question, listening: { text },
		mode: kind === "quiz" ? "single-select" : "text", options: kind === "quiz" ? quiz.options : [],
		correctIndices: [1], explanation: quiz.explanation, committedAnswer: recall.correctAnswer, createdAt: "2026-11-07T00:00:00Z" };
}

for (const kind of ["quiz", "explain"] as const) {
	test(`${kind}: slower playback is valid and descriptive assistance survives saved-answer presentation`, () => {
		const qd = question(kind);
		const answer = buildAnswer(qd, { values: ["tea"], text: "Hot tea", listeningCompleted: true, listeningPlaybackRates: [0.75, 1, 0.75] }, kind);
		assert.equal(answer.correct, kind === "quiz" ? true : undefined);
		assert.deepEqual(answer.listening?.playbackRates, [0.75, 1]);
		const model = compactAnswerForModel(answer);
		assert.equal(model.slowPlaybackUsed, true); assert.deepEqual(model.playbackRates, [0.75, 1]);
		const projected = answerForPresentation(JSON.parse(JSON.stringify(answer)), kind === "quiz" ? quiz : recall);
		assert.deepEqual(projected.listening?.playbackRates, [0.75, 1]);
		const legacy = buildAnswer(qd, { values: ["tea"], text: "Hot tea", listeningCompleted: true }, kind);
		assert.equal("slowPlaybackUsed" in compactAnswerForModel(legacy), false);
		const normal = buildAnswer(qd, { values: ["tea"], text: "Hot tea", listeningCompleted: true, listeningPlaybackRates: [1] }, kind);
		assert.equal(compactAnswerForModel(normal).slowPlaybackUsed, false);
	});
	test(`${kind}: playback gate, transcript reveal and technical recovery survive persistence`, () => {
		const qd = question(kind);
		assert.throws(() => buildAnswer(qd, { values: ["tea"], text: "Hot tea" }), /playback/);
		const answer = buildAnswer(qd, { values: ["tea"], text: "Hot tea", listeningCompleted: true }, kind);
		const markup = renderToStaticMarkup(React.createElement(AnsweredCard, { answer: JSON.parse(JSON.stringify(answer)), input: kind === "quiz" ? quiz : recall }));
		assert.match(markup, /listening-transcript/); assert.ok(markup.includes(text));
		assert.equal(answer.correct, kind === "quiz" ? true : undefined);
		assert.equal(compactAnswerForModel(answer).modality, "listening");
		assert.equal(JSON.stringify(compactAnswerForModel(answer)).includes(text), false, "model already has authored audio text");
		const call: LhMessage = { ...fauxAssistantMessage([fauxToolCall(kind, kind === "quiz" ? quiz : recall, { id: qd.id })], { stopReason: "toolUse" }), id: "message-1" };
		const restored = JSON.parse(JSON.stringify([call])) as LhMessage[];
		assert.equal(pendingQuestionOf(restored)?.toolCallId, qd.id);
		const failure = audioFailureAnswer(qd, kind);
		assert.equal(failure.correct, undefined); assert.equal(failure.confidence, undefined); assert.equal(failure.dontKnow, false);
		const output = compactAnswerForModel(failure);
		assert.equal(output.outcome, "audio_unavailable"); assert.equal(output.assessment, "unassessed");
		const appended = inputAppends({ messages: restored }, { type: "answer", toolCallId: qd.id, answer: failure });
		assert.equal(pendingQuestionOf([...restored, ...appended]), null);
		assert.equal(needsContinuation([...restored, ...appended]), true);
		const failureMarkup = renderToStaticMarkup(React.createElement(AnsweredCard, { answer: JSON.parse(JSON.stringify(failure)), input: kind === "quiz" ? quiz : recall }));
		assert.match(failureMarkup, /Listening was not assessed/);
		assert.equal(failureMarkup.includes(text), false); assert.doesNotMatch(failureMarkup, /incorrect|The answer:/);
		assert.match(messageMarkdown(newAnswerResult(qd.id, kind, failure), "result", false)!, /listening remains unassessed/);
	});
	test(`${kind}: pending question renders controls and immediate answer field without transcript`, () => {
		const input = kind === "quiz" ? parseQuizInput(quiz)! : parseExplainInput(recall)!;
		const markup = renderToStaticMarkup(React.createElement(QuestionDock, { toolName: kind, toolCallId: "pending", input, expanded: true, onExpand: () => {}, onSubmit: () => {} }));
		assert.match(markup, /listening-play/); assert.match(markup, /Listen once before submitting/);
		assert.equal(markup.includes(text), false);
		assert.match(markup, kind === "quiz" ? /Hot tea/ : /Your answer/);
	});
}
