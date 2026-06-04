import { eventSource, event_types } from '../../../../script.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import {
    config,
    EXTENSION_KEY,
    getCurrentPresetFolderData,
    getStateForSave,
    loadFromPreset,
    saveToPresetSoon,
    setCachedSavePreset,
    state,
} from './state.js';
import {
    buildVirtualFolders,
    clearAllFolders,
    createFolder,
    flattenPromptList,
    getFolderCount,
    setEnabled,
    setupVirtualDrag,
    toggleAllFolders,
} from './virtual-folders.js';

let initializedLists = new WeakSet();

function iconButton(icon, title, onClick, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `vpf-toolbar-btn ${className}`.trim();
    button.title = title;
    button.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    button.addEventListener('click', onClick);
    return button;
}

function syncEnabledButton(button) {
    button.classList.toggle('is-off', !state.enabled);
    button.innerHTML = `<i class="fa-solid ${state.enabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>`;
    button.title = state.enabled ? '停用虚拟文件夹' : '启用虚拟文件夹';
}

function createToolbar(listContainer) {
    const header = document.querySelector(config.selectors.promptHeader);
    if (!header) return;

    header.querySelector(`.${config.classNames.toolbar}`)?.remove();

    const toolbar = document.createElement('div');
    toolbar.className = config.classNames.toolbar;

    const createButton = iconButton('fa-folder-plus', '新建文件夹', () => {
        createFolder(listContainer);
        updateToolbarHint(toolbar);
    }, 'is-primary');

    const expandButton = iconButton('fa-up-right-and-down-left-from-center', '全部展开', () => {
        toggleAllFolders(listContainer, true);
    });

    const collapseButton = iconButton('fa-down-left-and-up-right-to-center', '全部收起', () => {
        toggleAllFolders(listContainer, false);
    });

    const resetButton = iconButton('fa-rotate-left', '清空文件夹，恢复普通条目列表', async () => {
        const confirmed = await callGenericPopup(
            '<div>确定清空当前预设的全部虚拟文件夹吗？所有提示词条目会恢复为普通列表。</div>',
            POPUP_TYPE.CONFIRM,
            '',
            { okButton: '清空文件夹', cancelButton: '取消' },
        );

        if (!confirmed) return;
        await clearAllFolders(listContainer);
        updateToolbarHint(toolbar);
        toastr.info('已清空文件夹，恢复为普通条目列表');
    }, 'is-danger');

    const enabledButton = iconButton('fa-toggle-on', '启用/停用虚拟文件夹', () => {
        setEnabled(listContainer, !state.enabled);
        syncEnabledButton(enabledButton);
        updateToolbarHint(toolbar);
    });
    syncEnabledButton(enabledButton);

    const hint = document.createElement('span');
    hint.className = 'vpf-toolbar-hint';
    toolbar.append(createButton, expandButton, collapseButton, resetButton, enabledButton, hint);
    header.appendChild(toolbar);
    updateToolbarHint(toolbar);
}

function updateToolbarHint(toolbar = document.querySelector(`.${config.classNames.toolbar}`)) {
    const hint = toolbar?.querySelector?.('.vpf-toolbar-hint');
    if (!hint) return;
    hint.textContent = `${getFolderCount()} 个文件夹`;
}

async function initialize(listContainer) {
    const promptManagerContainer = listContainer.closest(config.selectors.promptManager);
    if (!promptManagerContainer) return;

    const folderData = await getCurrentPresetFolderData();
    loadFromPreset(folderData);

    createToolbar(listContainer);
    buildVirtualFolders(listContainer);
    setupVirtualDrag(listContainer);
    updateToolbarHint();

    initializedLists.add(listContainer);
}

const bodyObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;

            if (node.matches(config.selectors.promptList)) {
                if (!initializedLists.has(node)) initialize(node);
                return;
            }

            const list = node.querySelector?.(config.selectors.promptList);
            if (list && !initializedLists.has(list)) {
                initialize(list);
                return;
            }
        }
    }
});

bodyObserver.observe(document.body, { childList: true, subtree: true });

const initialList = document.querySelector(config.selectors.promptList);
if (initialList) {
    initialize(initialList);
}

document.addEventListener('vpf:layout-changed', () => updateToolbarHint());

eventSource.on(event_types.OAI_PRESET_CHANGED_BEFORE, ({ savePreset }) => {
    setCachedSavePreset(savePreset);
    const listContainer = document.querySelector(config.selectors.promptList);
    if (listContainer) flattenPromptList(listContainer);
});

eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, async () => {
    const folderData = await getCurrentPresetFolderData();
    loadFromPreset(folderData);

    const listContainer = document.querySelector(config.selectors.promptList);
    if (!listContainer) return;

    createToolbar(listContainer);
    buildVirtualFolders(listContainer);
    setupVirtualDrag(listContainer);
    updateToolbarHint();
});

eventSource.on(event_types.OAI_PRESET_EXPORT_READY, preset => {
    preset.extensions ??= {};
    preset.extensions[EXTENSION_KEY] = getStateForSave();
});

eventSource.on(event_types.OAI_PRESET_IMPORT_READY, ({ data }) => {
    const folderData = data?.extensions?.[EXTENSION_KEY];
    if (folderData) {
        loadFromPreset(folderData);
        saveToPresetSoon();
    }
});
