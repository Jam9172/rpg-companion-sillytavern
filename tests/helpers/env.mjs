// Test environment: loads the extension's real modules in Node.
//
// The extension imports SillyTavern's files by relative path (../../../../script.js and so on), so this
// builds a small stand-in SillyTavern tree in a temp folder: tests/stubs/ (our own minimal versions of the
// SillyTavern modules the extension imports, not SillyTavern's code) plus a copy of src/ and index.js at
// public/scripts/extensions/third-party/rpg/. It also gives the modules a browser-like global scope
// (jsdom, jQuery, a toastr stand-in).
//
// Each `node --test` file runs in its own process, so each gets its own fresh copy and module state.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import jquery from 'jquery';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'rpg-companion-test-'));
cpSync(join(REPO, 'tests/stubs'), ROOT, { recursive: true });
const EXT_DIR = join(ROOT, 'public/scripts/extensions/third-party/rpg');
for (const part of ['src', 'index.js']) cpSync(join(REPO, part), join(EXT_DIR, part), { recursive: true });
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }));

const dom = new JSDOM('<!doctype html><html><body><div id="chat"></div><div id="extensions_settings2"></div></body></html>', { url: 'http://127.0.0.1:8000/' });
globalThis.window = dom.window;
globalThis.self = globalThis;
for (const k of ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Image', 'getComputedStyle', 'MutationObserver', 'cancelAnimationFrame', 'localStorage', 'CustomEvent', 'Event', 'DOMParser', 'FileReader', 'Blob', 'ResizeObserver', 'IntersectionObserver', 'matchMedia', 'location', 'history', 'HTMLCanvasElement', 'KeyboardEvent', 'MouseEvent']) {
    if (!(k in globalThis) || globalThis[k] === undefined) {
        try { globalThis[k] = dom.window[k]; } catch { /* read-only global */ }
    }
}
globalThis.requestAnimationFrame ||= (f) => setTimeout(f, 0);
const $ = jquery.fn ? jquery : jquery(dom.window);
globalThis.$ = globalThis.jQuery = window.$ = window.jQuery = $;
globalThis.toastr = window.toastr = { info() {}, success() {}, warning() {}, error() {}, clear() {} };
window.fetch = globalThis.fetch;

/** Imports one of the extension's modules, e.g. ext('src/utils/jsonRepair.js'). */
export const ext = (path) => import(pathToFileURL(join(EXT_DIR, path)).href);
/** Imports one of the stand-in SillyTavern modules, e.g. st('script.js'). */
export const st = (path) => import(pathToFileURL(join(ROOT, 'public', path)).href);

/** Runs fn with console output muted (the extension logs a lot). */
export async function quietly(fn) {
    const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
    Object.assign(console, { log() {}, warn() {}, error() {}, info() {}, debug() {} });
    try { return await fn(); } finally { Object.assign(console, saved); }
}

/** Gives the extension the panel containers its renderers draw into (in the page they come from the template). */
export async function mountPanel() {
    const state = await ext('src/core/state.js');
    for (const name of ['Panel', 'UserStats', 'InfoBox', 'Thoughts', 'Inventory', 'Quests', 'MusicPlayer']) {
        state[`set${name}Container`]($('<div></div>').appendTo(document.body));
    }
}
