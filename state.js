export const EXTENSION_KEY = 'virtual_prompt_folders';
const STORAGE_KEY = 'st-virtual-prompt-folders-by-preset';

export const config = {
    selectors: {
        promptManager: '#completion_prompt_manager',
        promptHeader: '.completion_prompt_manager_header',
        promptList: '#completion_prompt_manager_list',
        promptListItem: 'li.completion_prompt_manager_prompt',
        promptTokens: '.prompt_manager_prompt_tokens',
    },
    classNames: {
        toolbar: 'vpf-toolbar',
        folder: 'vpf-folder',
        folderSummary: 'vpf-folder-summary',
        folderContent: 'vpf-folder-content',
        folderTitle: 'vpf-folder-title',
        promptInFolder: 'vpf-prompt-in-folder',
        promptAtRoot: 'vpf-prompt-at-root',
    },
};

export const state = {
    enabled: true,
    folders: [],
    rootOrder: [],
    openStates: {},

    editingFolderId: null,
    isProcessing: false,
    isDragging: false,
};

let cachedSavePreset = null;

export function log() {}

export function createId(prefix = 'folder') {
    const randomPart = Math.random().toString(36).slice(2, 9);
    return `${prefix}_${Date.now().toString(36)}_${randomPart}`;
}

export function getPromptId(item) {
    return item?.dataset?.pmIdentifier || item?.dataset?.identifier || '';
}

export function getCurrentPresetName() {
    const select = document.querySelector('#settings_preset_openai');
    const selected = select?.querySelector?.(':checked');
    return selected?.textContent?.trim() || 'default';
}

export function setCachedSavePreset(fn) {
    cachedSavePreset = typeof fn === 'function' ? fn : null;
}

function normalizeOrderEntry(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') {
        const [type, ...rest] = entry.split(':');
        const id = rest.join(':');
        return type && id ? { type, id } : null;
    }

    const type = entry.type === 'folder' ? 'folder' : entry.type === 'prompt' ? 'prompt' : '';
    const id = entry.id || entry.identifier || entry.uuid || '';
    return type && id ? { type, id } : null;
}

function normalizeFolder(folder) {
    if (!folder) return null;
    const id = folder.id || folder.uuid || createId();
    const name = String(folder.name || folder.title || '新建文件夹').trim() || '新建文件夹';
    const children = Array.isArray(folder.children) ? folder.children.filter(Boolean) : [];

    return {
        id,
        name,
        open: folder.open !== false,
        children: [...new Set(children)],
    };
}

export function normalizeFolderData(data) {
    if (!data) return null;

    const folders = Array.isArray(data.folders)
        ? data.folders.map(normalizeFolder).filter(Boolean)
        : [];
    const rootOrder = Array.isArray(data.rootOrder)
        ? data.rootOrder.map(normalizeOrderEntry).filter(Boolean)
        : [];

    return {
        version: 1,
        enabled: data.enabled ?? true,
        folders,
        rootOrder,
        openStates: data.openStates ?? {},
    };
}

function readLocalStore() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

function writeLocalStore(store) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
        console.warn('[VirtualPromptFolders] Local backup save failed:', error);
    }
}

function getLocalData(presetName = getCurrentPresetName()) {
    return normalizeFolderData(readLocalStore()[presetName]);
}

function saveLocalData(presetName, data) {
    const store = readLocalStore();
    store[presetName] = data;
    writeLocalStore(store);
}

export function loadFromPreset(data) {
    const normalized = normalizeFolderData(data);

    state.enabled = normalized?.enabled ?? true;
    state.folders = normalized?.folders ?? [];
    state.rootOrder = normalized?.rootOrder ?? [];
    state.openStates = normalized?.openStates ?? {};
    state.editingFolderId = null;

    log('Loaded virtual folder data', getStateForSave());
}

export function getStateForSave() {
    return {
        version: 1,
        enabled: state.enabled,
        folders: state.folders.map(folder => ({
            id: folder.id,
            name: folder.name,
            open: folder.open !== false,
            children: [...new Set(folder.children || [])],
        })),
        rootOrder: state.rootOrder.map(entry => ({ type: entry.type, id: entry.id })),
        openStates: { ...state.openStates },
    };
}

export async function saveToPreset() {
    const folderData = getStateForSave();
    const fallbackName = getCurrentPresetName();
    saveLocalData(fallbackName, folderData);

    try {
        const [
            { oai_settings, openai_settings, openai_setting_names },
            { getRequestHeaders },
        ] = await Promise.all([
            import('../../../../scripts/openai.js'),
            import('../../../../script.js'),
        ]);

        const activePresetName = oai_settings.preset_settings_openai || fallbackName;
        oai_settings.extensions ??= {};
        oai_settings.extensions[EXTENSION_KEY] = folderData;

        const presetIndex = openai_setting_names[activePresetName];
        if (presetIndex !== undefined) {
            openai_settings[presetIndex].extensions ??= {};
            openai_settings[presetIndex].extensions[EXTENSION_KEY] = folderData;
        }

        saveLocalData(activePresetName, folderData);

        if (cachedSavePreset) {
            await cachedSavePreset(activePresetName, oai_settings, false);
            return;
        }

        if (presetIndex === undefined) {
            console.warn('[VirtualPromptFolders] Preset not found, saved local backup only:', activePresetName);
            return;
        }

        const response = await fetch('/api/presets/save', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                apiId: 'openai',
                name: activePresetName,
                preset: openai_settings[presetIndex],
            }),
        });

        if (!response.ok) {
            console.warn('[VirtualPromptFolders] Preset save failed, local backup is kept:', response.status, response.statusText);
        }
    } catch (error) {
        console.warn('[VirtualPromptFolders] Preset save failed, local backup is kept:', error);
    }
}

let saveTimer = null;

export function saveToPresetSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveToPreset().catch(error => console.warn('[VirtualPromptFolders] Save failed:', error));
    }, 350);
}

export async function getCurrentPresetFolderData() {
    const fallbackName = getCurrentPresetName();

    try {
        const { oai_settings, openai_settings, openai_setting_names } = await import('../../../../scripts/openai.js');
        const presetName = oai_settings.preset_settings_openai || fallbackName;
        const presetIndex = openai_setting_names[presetName];
        const extensions = presetIndex === undefined ? null : openai_settings[presetIndex]?.extensions;
        const presetData = normalizeFolderData(extensions?.[EXTENSION_KEY]);
        return presetData ?? getLocalData(presetName) ?? null;
    } catch (error) {
        console.warn('[VirtualPromptFolders] Falling back to local folder backup:', error);
        return getLocalData(fallbackName) ?? null;
    }
}
