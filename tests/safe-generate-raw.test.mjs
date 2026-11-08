import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, st, quietly } from './helpers/env.mjs';

const script = await st('script.js');
const { safeGenerateRaw } = await ext('src/utils/responseExtractor.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GENERATE = '/api/backends/chat-completions/generate';

// Backend stand-in: streaming requests get an SSE body over 1 s; others get an Anthropic-style
// extended-thinking reply (an empty first block, then the text) echoing the request's `say`
function backend(url, init = {}) {
    const body = JSON.parse(init.body || '{}');
    if (body.stream) {
        let n = 0;
        const stream = new ReadableStream({ async pull(c) { if (n) await sleep(200); if (n++ >= 5) return c.close(); c.enqueue(new TextEncoder().encode(`data: {"n":${n}}\n\n`)); } });
        return Promise.resolve(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
    }
    const content = [{ type: 'thinking', thinking: '...' }, { type: 'text', text: `reply to: ${body.say}` }];
    return Promise.resolve(new Response(JSON.stringify({ content }), { headers: { 'content-type': 'application/json' } }));
}

// generateRaw stand-in: sends its prompt to the backend, waits, then fails the way SillyTavern does when
// the first content block is empty
script.__set('generateRaw', async ({ prompt, ms = 0 }) => {
    const say = prompt[prompt.length - 1].content;
    const response = await window.fetch(GENERATE, { method: 'POST', body: JSON.stringify({ messages: prompt, say, stream: false }) });
    await response.json();
    await sleep(ms);
    throw new Error('No message generated');
});
const ask = (say, ms) => quietly(() => safeGenerateRaw({ prompt: [{ role: 'user', content: say }], ms }));

async function timeToStreamResponse() {
    const t = Date.now();
    const response = await window.fetch(GENERATE, { method: 'POST', body: JSON.stringify({ stream: true }) });
    const ms = Date.now() - t;
    await response.text();
    return ms;
}

test('a streaming reply is not held back while a background request runs', async () => {
    window.fetch = backend;
    const background = ask('Summarise the scene in one short line please.', 1500);
    await sleep(50);
    assert.ok(await timeToStreamResponse() < 300);
    assert.equal(await background, 'reply to: Summarise the scene in one short line please.');
    assert.equal(window.fetch, backend);
});

test('overlapping requests put fetch back and each gets its own reply', async () => {
    for (const [msA, msB] of [[300, 600], [600, 300]]) {
        window.fetch = backend;
        const A = ask('First request, about the tavern and its keeper.', msA);
        await sleep(100);
        const B = ask('Second request, about the harbour and its captain.', msB);
        assert.deepEqual(await Promise.all([A, B]), [
            'reply to: First request, about the tavern and its keeper.',
            'reply to: Second request, about the harbour and its captain.',
        ]);
        assert.equal(window.fetch, backend, `finish order ${msA}/${msB}`);
        assert.ok(await timeToStreamResponse() < 300);
    }
});

test('fetch wrapped by someone else meanwhile is left as they set it', async () => {
    window.fetch = backend;
    const call = ask('A request while another extension wraps fetch.', 200);
    await sleep(20);
    const theirs = (...args) => backend(...args);
    window.fetch = theirs;
    await call;
    assert.equal(window.fetch, theirs);
});

test('overlapping requests that share chat lines still each get their own reply', async () => {
    window.fetch = backend;
    // generateRaw stand-in whose backend reply names the request's first (instruction) message
    script.__set('generateRaw', async ({ prompt, ms = 0 }) => {
        const response = await window.fetch(GENERATE, { method: 'POST', body: JSON.stringify({ messages: prompt, say: prompt[0].content, stream: false }) });
        await response.json();
        await sleep(ms);
        throw new Error('No message generated');
    });
    const chat = { role: 'user', content: 'Mira lowers her voice and says the harbour is closed tonight.' };
    const trackers = quietly(() => safeGenerateRaw({ prompt: [{ role: 'system', content: 'Update the trackers for this scene as JSON.' }, chat], ms: 400 }));
    await sleep(100);
    const cast = quietly(() => safeGenerateRaw({ prompt: [{ role: 'system', content: 'Update the cast ledger for the characters here.' }, chat], ms: 100 }));
    assert.deepEqual(await Promise.all([trackers, cast]), [
        'reply to: Update the trackers for this scene as JSON.',
        'reply to: Update the cast ledger for the characters here.',
    ]);
});
