import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext, quietly } from './helpers/env.mjs';

const { migrateInfoBoxToJSON } = await ext('src/utils/jsonMigration.js');
const temperature = (line) => quietly(() => migrateInfoBoxToJSON(`Info Box\n---\n${line}`).temperature);

test('migrating an old Info Box keeps negative temperatures', async () => {
    assert.deepEqual(await temperature('Temperature: -5°C'), { value: -5, unit: 'C' });
    assert.deepEqual(await temperature('Temperature: −12°F'), { value: -12, unit: 'F' });
    assert.deepEqual(await temperature('Temperature: 21°C'), { value: 21, unit: 'C' });
});
