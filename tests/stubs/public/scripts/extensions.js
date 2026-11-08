import { chat, chat_metadata, characters, this_chid, eventSource, event_types } from '../script.js';
export const extension_settings = {};
export const modules = [];
export function getContext() { return { chat, chat_metadata, characters, characterId: this_chid, eventSource, event_types, name1: 'User', name2: characters[this_chid]?.name || 'Char', saveChat: async () => {}, saveMetadata: async () => {}, extensionSettings: extension_settings }; }
export async function renderExtensionTemplateAsync() { return ''; }
export async function doExtrasFetch() { return { ok: false }; }
export function getApiUrl() { return ''; }
