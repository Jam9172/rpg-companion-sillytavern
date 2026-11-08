import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, st, quietly } from './helpers/env.mjs';

const { repairJSON } = await ext('src/utils/jsonRepair.js');

test('repairJSON does not evaluate text that is not JSON', async () => {
    globalThis.__evaluated = undefined;
    for (const text of ['{a: (globalThis.__evaluated = true)}', '{a: f()}', '[globalThis.__evaluated = 1]', '{a: undefined}']) {
        assert.equal(await quietly(() => repairJSON(text)), null, text);
    }
    assert.equal(globalThis.__evaluated, undefined);
});

test('repairJSON still reads bare keys and single-quoted strings', () => {
    assert.deepEqual(repairJSON(`{mood: 'calm', n: 2, list: ['a', "b's"], nested: {ok: true}}`),
        { mood: 'calm', n: 2, list: ['a', "b's"], nested: { ok: true } });
    assert.deepEqual(repairJSON(`{name: 'Zandik\\'s Office', say: 'a "quote"'}`), { name: "Zandik's Office", say: 'a "quote"' });
    assert.deepEqual(repairJSON('{"a": [1, 2,], }'), { a: [1, 2] });
});

test('opening a chat does not evaluate braces in the latest reply', async () => {
    const script = await st('script.js');
    const { extensionSettings } = await ext('src/core/state.js');
    const { onChatLoaded } = await ext('src/systems/integration/sillytavern.js');
    for (const enabled of [true, false]) {
        extensionSettings.enabled = enabled;
        const mes = 'The door opens. {mood: (globalThis.__evaluated = "yes")}';
        script.chat.length = 0;
        script.chat.push({ name: 'Innkeeper', is_user: false, is_system: false, mes, swipes: [mes], swipe_id: 0, extra: {} });
        globalThis.__evaluated = undefined;
        await quietly(async () => { try { await onChatLoaded(); } catch { /* the panel isn't there to render */ } });
        assert.equal(globalThis.__evaluated, undefined, `enabled=${enabled}`);
    }
});
