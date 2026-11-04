/** Real Chromium Selection/media smoke. Synthetic audio only; never calls ElevenLabs. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
const root = path.resolve(import.meta.dirname, "..");
const directory = await mkdtemp(path.join(os.tmpdir(), "lh-speech-browser-"));
// Render the real thinking component, so this smoke catches missing eligibility
// markers without bundling the unrelated Markdown plugins into the fixture.
const thinkingMarkup = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
import React from 'react'; globalThis.React = React;
import {renderToStaticMarkup} from 'react-dom/server';
import {Reasoning,ReasoningContent} from './components/ai-elements/reasoning.tsx';
console.log(renderToStaticMarkup(React.createElement(Reasoning,{open:true},React.createElement(ReasoningContent,null,'我在思考这个问题。'))));
`], { cwd: root, encoding: "utf8" }).trim();
const source = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {SpeechSelection} from './components/speech-selection';
import {setDictationActive} from './components/dictation-state';
import {PathInput} from './components/path-input';
window.setDictationActive=setDictationActive; window.draftChanges=0;
const root=createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();
root.render(<div data-speech-scope><SpeechSelection/><div id="thinking" dangerouslySetInnerHTML={{__html: ${JSON.stringify(thinkingMarkup)}}}/><p id="passage" className="lh-prose">我想要<strong>一杯热茶</strong>。</p><button role="radio"><span className="lh-prose" id="option">我要米饭。</span></button><p className="lh-prose" id="other">再见。</p><p className="lh-prose" id="code">文字<code>skip()</code></p><PathInput id="draft-thinking" data-speech-content="" value="我想再试一次。" onValueChange={()=>window.draftChanges++}/><textarea defaultValue="draft"/></div>);`;
const coreFixture = path.join(directory, 'core.ts');
await writeFile(coreFixture, `export * from ${JSON.stringify(path.join(root, 'src/core/speech.ts'))}; export * from ${JSON.stringify(path.join(root, 'src/core/file-paths.ts'))};`);
const result = await build({ stdin: { contents: source, resolveDir: root, loader: "tsx" }, bundle: true, write: false, alias: { "@/src/core": coreFixture }, jsx: "automatic", platform: "browser", define: { "process.env.NODE_ENV": '"development"' } });
const bundle = result.outputFiles[0].contents;
// Three-second low-volume tone exercises native HTMLAudioElement without paid synthesis.
const samples = 24000, wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF"); wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/8000)*20),44+i*2);
const requests=[];
const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);return;}
 if(req.url==='/api/speech'){let body='';for await(const chunk of req)body+=chunk;requests.push(JSON.parse(body));res.setHeader('Content-Type','audio/wav');res.end(wav);return;}
 res.setHeader('Content-Type','text/html');res.end('<html><head><style>body{background:#141414;color:#e6e6e6;font:20px system-ui;padding:40px}.lh-prose{user-select:text}button{font:inherit} [data-testid=speech-popup]{position:fixed;background:#1c1c1c;border:1px solid #434343;padding:12px;max-width:280px} </style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,userDataDir:directory});
 const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('#passage');
 async function select(selector){await page.evaluate(selector=>{document.activeElement?.blur();const range=document.createRange();range.selectNodeContents(document.querySelector(selector));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);},selector);await page.waitForSelector('[data-testid=speech-popup]');}
 const read=async()=>{await page.evaluate(()=>Array.from(document.querySelectorAll('[data-testid=speech-popup] button')).find(b=>b.textContent==='Read').click());};
 await select('#passage');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Read');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent==='Reading…');assert.deepEqual(requests,[{text:'我想要一杯热茶。'}]);
 await page.evaluate(()=>Array.from(document.querySelectorAll('[data-testid=speech-popup] button')).find(b=>b.textContent==='Stop').click());await read();
 await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent==='Reading…');assert.equal(requests.length,1);
 await page.evaluate(()=>window.setDictationActive(true));await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent?.includes('Stop dictation'));
 assert.equal(await page.evaluate(()=>Array.from(document.querySelectorAll('[data-testid=speech-popup] button')).find(b=>b.textContent==='Read').disabled),true);
 await page.evaluate(()=>window.setDictationActive(false));await select('#option');await read();await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent==='Reading…');assert.equal(requests.at(-1).text,'我要米饭。');
 await select('#code');assert.equal(await page.evaluate(()=>Array.from(document.querySelectorAll('[data-testid=speech-popup] button')).find(b=>b.textContent==='Read').disabled),true);
 await select('#thinking [data-speech-content] p');await read();await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent==='Reading…');assert.equal(requests.at(-1).text,'我在思考这个问题。');
 await page.click('[aria-label="Close read controls"]');
 await page.focus('#draft-thinking');
 await page.keyboard.press('Home'); await page.keyboard.down('Shift'); await page.keyboard.press('End'); await page.keyboard.up('Shift');
 await page.waitForSelector('[data-testid=speech-popup]');
 await page.click('[data-testid=speech-popup] button');
 await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent==='Reading…');
 assert.equal(requests.at(-1).text,'我想再试一次。');
 assert.equal(await page.$eval('#draft-thinking',el=>el.textContent),'我想再试一次。');
 assert.equal(await page.evaluate(()=>window.draftChanges),0);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'draft-thinking');
 await page.evaluate(()=>window.unmount());assert.equal(await page.$('[data-testid=speech-popup]'),null);assert.deepEqual(errors,[]);
 console.log('PASS: real selection across emphasis, keyboard Read, native audio, replay, dictation, question option text, code rejection, real thinking content, editable thinking without draft changes, and unmount.');
}finally{await browser?.close();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}
