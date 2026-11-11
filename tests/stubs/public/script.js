// Stub of SillyTavern public/script.js for the test harness
const handlers = {};
export const eventSource = {
  on(t, f) { (handlers[t] ||= []).push(f); }, once(t, f) { this.on(t, f); },
  off(t, f) { handlers[t] = (handlers[t] || []).filter(x => x !== f); },
  async emit(t, ...a) { for (const f of handlers[t] || []) await f(...a); },
  removeListener(t, f) { this.off(t, f); }, makeFirst(t, f) { (handlers[t] ||= []).unshift(f); }, makeLast(t, f) { this.on(t, f); },
  _handlers: handlers,
};
export const event_types = new Proxy({}, { get: (_, k) => String(k) });
export const chat = [];
export const chat_metadata = {};
export const characters = [];
export let this_chid = undefined;
export let main_api = 'openai';
export let online_status = 'Connected';
export let user_avatar = 'user.png';
export const extension_prompt_types = { NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 };
export const extension_prompt_roles = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };
export let generateRawImpl = async () => '';
export async function generateRaw(o) { return generateRawImpl(o); }
export async function generateQuietPrompt() { return ''; }
export async function Generate() {}
export function getCurrentChatDetails() { return {}; }
export function getCurrentChatId() { return 'chat1'; }
export function getRequestHeaders() { return {}; }
export function getThumbnailUrl(type, file) { return `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`; }
export async function reloadCurrentChat() {}
export function saveChatDebounced() {}
export function saveSettingsDebounced() {}
// Like SillyTavern: one slot per key, an empty value clears it
export const extension_prompts = {};
export function setExtensionPrompt(key, value, position, depth, scan = false, role = 0) {
  extension_prompts[key] = { value: String(value ?? ''), position, depth, scan, role };
}
export function substituteParams(s) { return s; }
export function substituteParamsExtended(s) { return s; }
export function updateMessageBlock() {}
export function __set(name, value) {
  if (name === 'this_chid') this_chid = value; else if (name === 'main_api') main_api = value;
  else if (name === 'generateRaw') generateRawImpl = value; else throw new Error('unknown ' + name);
}
