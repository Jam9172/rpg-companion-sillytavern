import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, st } from './helpers/env.mjs';

test('the extension loads against the stand-in SillyTavern', async () => {
    const { extensionSettings } = await ext('src/core/state.js');
    const script = await st('script.js');
    assert.equal(typeof extensionSettings, 'object');
    assert.ok(Array.isArray(script.chat));
});
