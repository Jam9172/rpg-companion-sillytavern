import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, quietly } from './helpers/env.mjs';

const { extensionSettings } = await ext('src/core/state.js');
const { applyLocks, setItemLock, isItemLocked } = await ext('src/systems/generation/lockManager.js');
const send = (data) => quietly(() => JSON.parse(applyLocks(JSON.stringify(data), 'userStats')));

test('locking Stats keeps each stat\'s id, name and value', async () => {
    extensionSettings.lockedItems = {};
    setItemLock('userStats', 'stats', true);
    const sent = await send({ stats: [{ id: 'health', name: 'Health', value: 80 }, { id: 'arousal', name: 'Arousal', value: 0 }] });
    assert.deepEqual(sent.stats, [
        { id: 'health', name: 'Health', value: 80, locked: true },
        { id: 'arousal', name: 'Arousal', value: 0, locked: true },
    ]);
});

test('locking Stats in the older {name: value} shape keeps 0 as a value', async () => {
    extensionSettings.lockedItems = {};
    setItemLock('userStats', 'stats', true);
    const sent = await send({ stats: { health: 80, arousal: 0 } });
    assert.deepEqual(sent.stats, { health: { value: 80, locked: true }, arousal: { value: 0, locked: true } });
});
