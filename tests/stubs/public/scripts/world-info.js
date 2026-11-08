export let __entries = []; export let __worlds = {};
export async function getSortedEntries() { return __entries; }
export async function loadWorldInfo(name) { return __worlds[name] || null; }
export function __setWI(entries, worlds) { __entries = entries; __worlds = worlds || {}; }
