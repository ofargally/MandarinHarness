/** Real listening question controls + native audio. Local synthetic WAV only. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

const root = path.resolve(import.meta.dirname, "..");
const directory = await mkdtemp(path.join(os.tmpdir(), "lh-listening-browser-"));
const markup = path.join(directory, "message.tsx");
// Only Markdown paint is stubbed; actual dock, answer card, editors, selection
// read-aloud, audio controller, dictation state and grading run in Chromium.
await writeFile(markup, `import React from 'react'; export function ToolContentResponse({children,...props}){return <div {...props} data-speech-content="">{children}</div>}`);
const source = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{QuestionDock}from'./components/question-dock';import{AnsweredCard}from'./components/answered-card';
import{SpeechSelection}from'./components/speech-selection';import{setDictationActive}from'./components/dictation-state';
window.setDictationActive=setDictationActive;window.audioElements=[];window.submissions=[];
const NativeAudio=window.Audio;window.Audio=function(){const a=new NativeAudio();window.audioElements.push(a);return a;};
const nativeFetch=window.fetch;window.fetch=(url,options={})=>nativeFetch(url,{...options,headers:{...options.headers,'x-fixture-fail':window.failAudio?'1':'0','x-fixture-corrupt':window.corruptAudio?'1':'0'}});
function App(){const[exercise,setExercise]=useState(null);const[answer,setAnswer]=useState(null);
window.show=(kind,id='fixture')=>{setAnswer(null);setExercise({kind,id,input:{type:'check',nodeId:'drinks',listening:{text:'我想要一杯热茶。'},question:'What does the speaker want?',...(kind==='quiz'?{options:[{label:'Hot tea',value:'tea'},{label:'Coffee',value:'coffee'}],correctAnswer:'tea',explanation:'The speaker wants hot tea.'}:{correctAnswer:'A cup of hot tea.'})}});};
return <div data-speech-scope><SpeechSelection/><p data-speech-content id="readable">你好。</p>{exercise&&(answer?<AnsweredCard answer={answer} input={exercise.input}/>:<QuestionDock key={exercise.id} toolName={exercise.kind} toolCallId={exercise.id} input={exercise.input} expanded onExpand={()=>{}} onSubmit={a=>{window.submissions.push(a);setAnswer(a);}}/>)}</div>;}
createRoot(document.getElementById('root')).render(<App/>);`;
const result = await build({ stdin: { contents: source, resolveDir: root, loader: "tsx" }, bundle: true, write: false,
	alias: { "@/components/ai-elements/message": markup }, nodePaths: [path.join(root, "node_modules")], jsx: "automatic", platform: "browser", define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" } });
const bundle = result.outputFiles[0].contents;
const samples = 8000, wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 8000) * 20), 44 + i * 2);
const requests = [];
const server = createServer(async (req, res) => {
	if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle); return; }
	if (req.url === "/api/speech") {
		let body = ""; for await (const chunk of req) body += chunk;
		requests.push(JSON.parse(body));
		if (req.headers["x-fixture-fail"] === "1") { res.writeHead(503, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "Fixture audio unavailable." } })); return; }
		if (req.headers["x-fixture-corrupt"] === "1") { res.setHeader("Content-Type", "audio/wav"); res.end(Buffer.from([1, 2, 3, 4])); return; }
		res.setHeader("Content-Type", "audio/wav"); res.end(wav); return;
	}
	res.setHeader("Content-Type", "text/html");
	res.end('<html><head><style>body{font:16px system-ui;background:#141414;color:#eee;padding:24px}button{margin:6px;padding:8px}button:disabled{opacity:.4}[contenteditable]{border:1px solid #777;min-height:40px}.invisible{visibility:hidden} [data-speech-content]{user-select:text}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
let browser;
try {
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, userDataDir: directory });
	const page = await browser.newPage(), errors = [];
	page.on("pageerror", error => { errors.push(String(error)); console.error("Browser error:", String(error)); });
	await page.goto(`http://127.0.0.1:${server.address().port}`);
	await page.waitForFunction(() => typeof window.show === "function");
	const submit = () => page.$eval('button[type="submit"]', button => button.disabled);
	const play = () => page.click('[data-testid="listening-play"]');
	const slow = () => page.click('[data-testid="listening-slow"]');
	const waitPlaying = () => page.waitForFunction(() => [...document.querySelectorAll('[data-testid="listening-audio"] [role="status"]')].some(el => el.textContent === "Listening…"));
	const waitSlow = () => page.waitForFunction(() => [...document.querySelectorAll('[data-testid="listening-audio"] [role="status"]')].some(el => el.textContent === "Listening at 0.75×…"));
	await page.evaluate(() => window.show("quiz", "mcq-1"));
	await page.waitForSelector('[role="radio"]');
	assert.equal(requests.length, 0, "authoring must not synthesize audio");
	assert.equal(await page.evaluate(() => document.body.textContent.includes("我想要一杯热茶。")), false);
	await page.evaluate(() => [...document.querySelectorAll('[role="radio"]')].find(el => el.textContent.includes("Hot tea")).click());
	assert.equal(await submit(), true);
	await play(); await waitPlaying();
	assert.equal(await submit(), true, "starting playback is insufficient");
	await page.evaluate(() => [...document.querySelectorAll('[data-testid="listening-audio"] button')].find(el => el.textContent.includes("Stop")).click());
	assert.equal(await submit(), true, "stopping early is insufficient");
	await play(); await waitPlaying();
	await page.waitForFunction(() => window.audioElements.some(audio => !audio.paused && audio.currentTime > 0.15));
	await slow(); await waitSlow();
	const switched = await page.evaluate(() => { const audio = window.audioElements.find(audio => !audio.paused); return { rate: audio.playbackRate, pitch: audio.preservesPitch, time: audio.currentTime }; });
	assert.equal(switched.rate, 0.75); assert.equal(switched.pitch, true); assert.ok(switched.time < 0.4, "speed switch restarts the utterance");
	assert.equal(await submit(), true, "a partial normal playback does not unlock slow playback");
	await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
	assert.equal(requests.length, 1, "replay should reuse loaded audio");
	await slow(); await waitSlow();
	await page.evaluate(() => [...document.querySelectorAll('[data-testid="listening-audio"] button')].find(el => el.textContent.includes("Stop")).click());
	assert.equal(await submit(), false, "stopping a replay preserves an earlier completed playback");
	await play(); await waitPlaying();
	assert.equal(await page.evaluate(() => window.audioElements.find(audio => !audio.paused).playbackRate), 1);
	await page.click('button[type="submit"]');
	await page.waitForSelector('[data-testid="listening-transcript"]');
	assert.equal(await page.evaluate(() => window.submissions.at(-1).correct), true);
	assert.deepEqual(await page.evaluate(() => window.submissions.at(-1).listening.playbackRates), [1, 0.75]);
	assert.equal(await page.evaluate(() => window.audioElements.every(audio => audio.paused)), true, "submission stops pending playback");
	const submittedRates = await page.evaluate(() => [...window.submissions.at(-1).listening.playbackRates]);
	await slow(); await waitSlow();
	assert.deepEqual(await page.evaluate(() => window.submissions.at(-1).listening.playbackRates), submittedRates, "review playback does not rewrite assessment history");
	await page.evaluate(() => window.show("explain", "recall-1"));
	await page.waitForSelector('[data-testid="answer-field"] [contenteditable]');
	assert.equal(await page.evaluate(() => document.body.textContent.includes("我想要一杯热茶。")), false);
	await page.type('[data-testid="answer-field"] [contenteditable]', "Hot tea");
	assert.equal(await submit(), true);
	await slow(); await waitSlow();
	assert.equal(await submit(), true);
	await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
	await page.click('button[type="submit"]'); await page.waitForSelector('[data-testid="listening-transcript"]');
	assert.equal(await page.evaluate(() => window.submissions.at(-1).text), "Hot tea");
	assert.equal(await page.evaluate(() => window.submissions.at(-1).correct), undefined);
	assert.deepEqual(await page.evaluate(() => window.submissions.at(-1).listening.playbackRates), [0.75]);
	// A new question, even with identical spoken content, must require listening again.
	await page.evaluate(() => { window.failAudio = true; window.show("quiz", "failure-1"); });
	await page.waitForSelector('[data-testid="question-dock"]');
	await play(); await page.waitForFunction(() => document.querySelector('[data-testid="listening-play"]').textContent.includes("Retry"));
	assert.equal(await page.$('[data-testid="listening-continue"]'), null);
	await play(); await page.waitForSelector('[data-testid="listening-continue"]');
	assert.equal(await submit(), true);
	await page.click('[data-testid="listening-continue"]'); await page.waitForSelector('[data-testid="listening-failed-card"]');
	const failure = await page.evaluate(() => window.submissions.at(-1));
	assert.equal(failure.audioFailure, true); assert.equal(failure.correct, undefined); assert.equal(failure.dontKnow, false);
	assert.equal(await page.evaluate(() => document.body.textContent.includes("我想要一杯热茶。")), false);
	// Decoder errors can fire both onerror and a rejected play() promise.
	await page.evaluate(() => { window.failAudio = false; window.corruptAudio = true; window.show("explain", "corrupt-audio"); });
	await page.waitForSelector('[data-testid="question-dock"]');
	await play(); await page.waitForFunction(() => document.querySelector('[data-testid="listening-play"]').textContent.includes("Retry"));
	assert.equal(await page.$('[data-testid="listening-continue"]'), null, "a corrupt first attempt still needs a retry");
	await play(); await page.waitForSelector('[data-testid="listening-continue"]');
	await page.click('[data-testid="listening-continue"]'); await page.waitForSelector('[data-testid="listening-failed-card"]');
	// Dictation and read-aloud must be coordinated with the listening player.
	await page.evaluate(() => { window.corruptAudio = false; window.show("quiz", "coordination"); });
	await page.waitForSelector('[data-testid="listening-play"]'); await play(); await waitPlaying();
	await page.evaluate(() => window.setDictationActive(true));
	assert.equal(await page.evaluate(() => window.audioElements.every(audio => audio.paused)), true);
	assert.equal(await page.$eval('[data-testid="listening-play"]', button => button.disabled), true);
	assert.equal(await page.$eval('[data-testid="listening-slow"]', button => button.disabled), true);
	await page.evaluate(() => window.setDictationActive(false));
	await play(); await waitPlaying();
	await page.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector("#readable")); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
	await page.waitForSelector('[data-testid="speech-popup"]');
	await page.click('[data-testid="speech-popup"] button');
	await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="speech-popup"] [role="status"]')].some(el => el.textContent === "Reading…"));
	assert.equal(await page.evaluate(() => window.audioElements.filter(audio => !audio.paused).length), 1);
	assert.deepEqual(errors, []);
	console.log("PASS: real listening MCQ/free recall, 1×/0.75× pitch-preserved playback, restart-on-switch, unchanged fetch count, assistance history, transcript reveal, full-playback gate, Stop/replay, failure recovery, and dictation/read-aloud coordination. Synthetic audio; zero provider calls.");
} finally {
	await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true });
}
