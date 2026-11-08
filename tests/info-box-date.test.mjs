import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ext } from './helpers/env.mjs';

const { splitInfoBoxDate } = await ext('src/utils/infoBoxDate.js');
const parts = (weekday, month, year) => ({ weekday, month, year });

test('dates the reader already handled stay the same', () => {
    assert.deepEqual(splitInfoBoxDate('Sunday, March 16, 1247'), parts('Sunday', 'March 16', '1247'));
    assert.deepEqual(splitInfoBoxDate('Sunday, 16 March 1247'), parts('Sunday', '16 March', '1247'));
    assert.deepEqual(splitInfoBoxDate('March 16, 1247'), parts('', 'March 16', '1247'));
    assert.deepEqual(splitInfoBoxDate('Sunday'), parts('Sunday', '', ''));
    assert.deepEqual(splitInfoBoxDate('Moonday, 3rd of Frostfall, Year 412'), parts('Moonday', '3rd of Frostfall', 'Year 412'));
    assert.deepEqual(splitInfoBoxDate('Sunday, March 16'), parts('Sunday', 'March 16', ''));
    assert.deepEqual(splitInfoBoxDate(''), parts('', '', ''));
});

test('a month or season followed by a year is the month, not the weekday', () => {
    assert.deepEqual(splitInfoBoxDate('March, 1247'), parts('', 'March', '1247'));
    assert.deepEqual(splitInfoBoxDate('Late Autumn, 1247'), parts('', 'Late Autumn', '1247'));
    assert.deepEqual(splitInfoBoxDate('Frostfall, Year 412'), parts('', 'Frostfall', 'Year 412'));
});

test('a weekday followed by only a year is still the weekday', () => {
    assert.deepEqual(splitInfoBoxDate('Sunday, 1247'), parts('Sunday', '', '1247'));
    assert.deepEqual(splitInfoBoxDate('Moonday, Year 412'), parts('Moonday', '', 'Year 412'));
    assert.deepEqual(splitInfoBoxDate('Воскресенье, 1247'), parts('Воскресенье', '', '1247'));
    assert.deepEqual(splitInfoBoxDate('dimanche, 1247'), parts('dimanche', '', '1247'));
});

test('a date written without commas still finds its weekday', () => {
    assert.deepEqual(splitInfoBoxDate('Sunday 16 March 1247'), parts('Sunday', '16 March', '1247'));
});
