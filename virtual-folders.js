import {
    config,
    createId,
    getPromptId,
    saveToPreset,
    saveToPresetSoon,
    state,
} from './state.js';

const dragState = {
    kind: '',
    element: null,
    listContainer: null,
    moved: false,
};

export function getPromptItems(listContainer) {
    return Array.from(listContainer?.querySelectorAll(config.selectors.promptListItem) ?? []);
}

function getDirectPromptItems(container) {
    return Array.from(container?.children ?? []).filter(child => child.matches?.(config.selectors.promptListItem));
}

function getFolder(folderId) {
    return state.folders.find(folder => folder.id === folderId) || null;
}

export function getFolderCount() {
    return state.folders.length;
}

function notifyLayoutChanged() {
    document.dispatchEvent(new CustomEvent('vpf:layout-changed'));
}

function isPromptEnabled(item) {
    return !item.classList.contains('completion_prompt_manager_prompt_disabled');
}

function cleanPromptItem(item) {
    item.classList.remove(
        config.classNames.promptInFolder,
        config.classNames.promptAtRoot,
        'vpf-dragging',
        'vpf-drop-before',
        'vpf-drop-after',
    );
}

export function flattenPromptList(listContainer) {
    if (!listContainer || state.isProcessing) return [];

    state.isProcessing = true;
    try {
        const promptItems = getPromptItems(listContainer);
        listContainer.innerHTML = '';
        promptItems.forEach(item => {
            cleanPromptItem(item);
            listContainer.appendChild(item);
        });
        return promptItems;
    } finally {
        state.isProcessing = false;
    }
}

function normalizeLayout(promptItems) {
    const itemById = new Map();
    promptItems.forEach(item => {
        const id = getPromptId(item);
        if (id && !itemById.has(id)) {
            itemById.set(id, item);
        }
    });

    const assignedChildren = new Set();
    const folders = state.folders.map(folder => {
        const children = [];
        (folder.children || []).forEach(id => {
            if (!itemById.has(id) || assignedChildren.has(id)) return;
            children.push(id);
            assignedChildren.add(id);
        });

        return {
            ...folder,
            open: state.openStates[folder.id] ?? folder.open ?? true,
            children,
        };
    });

    const folderById = new Map(folders.map(folder => [folder.id, folder]));
    const usedFolders = new Set();
    const rootPrompts = new Set();
    const rootOrder = [];

    const pushFolder = id => {
        if (!folderById.has(id) || usedFolders.has(id)) return;
        rootOrder.push({ type: 'folder', id });
        usedFolders.add(id);
    };

    const pushPrompt = id => {
        if (!itemById.has(id) || assignedChildren.has(id) || rootPrompts.has(id)) return;
        rootOrder.push({ type: 'prompt', id });
        rootPrompts.add(id);
    };

    state.rootOrder.forEach(entry => {
        if (entry.type === 'folder') pushFolder(entry.id);
        if (entry.type === 'prompt') pushPrompt(entry.id);
    });

    folders.forEach(folder => pushFolder(folder.id));
    itemById.forEach((_, id) => pushPrompt(id));

    state.folders = folders;
    state.rootOrder = rootOrder;

    return { itemById, folders, rootOrder };
}

function button(icon, title, className = '') {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `vpf-icon-btn ${className}`.trim();
    element.title = title;
    element.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    return element;
}

function setFolderOpen(folderId, details, shouldOpen, animate = true) {
    const folder = getFolder(folderId);
    if (!folder || !details || details.dataset.vpfAnimating === '1') return;

    folder.open = shouldOpen;
    state.openStates[folderId] = shouldOpen;
    saveToPresetSoon();

    const content = details.querySelector(`:scope > .${config.classNames.folderContent}`);
    if (!content || !animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        details.open = shouldOpen;
        return;
    }

    details.dataset.vpfAnimating = '1';
    content.style.overflow = 'hidden';
    content.style.transition = 'max-height 170ms ease, opacity 150ms ease, transform 170ms ease';

    if (shouldOpen) {
        details.open = true;
        content.style.maxHeight = '0px';
        content.style.opacity = '0';
        content.style.transform = 'translateY(-3px)';
        requestAnimationFrame(() => {
            content.style.maxHeight = `${content.scrollHeight}px`;
            content.style.opacity = '1';
            content.style.transform = 'translateY(0)';
        });
    } else {
        content.style.maxHeight = `${content.scrollHeight}px`;
        content.style.opacity = '1';
        content.style.transform = 'translateY(0)';
        requestAnimationFrame(() => {
            content.style.maxHeight = '0px';
            content.style.opacity = '0';
            content.style.transform = 'translateY(-3px)';
        });
    }

    window.setTimeout(() => {
        if (!shouldOpen) details.open = false;
        content.style.overflow = '';
        content.style.transition = '';
        content.style.maxHeight = '';
        content.style.opacity = '';
        content.style.transform = '';
        delete details.dataset.vpfAnimating;
    }, 210);
}

function commitFolderName(folderId, rawName, listContainer) {
    const folder = getFolder(folderId);
    if (!folder) return;

    const name = String(rawName || '').trim();
    folder.name = name || '新建文件夹';
    state.editingFolderId = null;
    buildVirtualFolders(listContainer);
    saveToPresetSoon();
}

function createTitleNode(folder, listContainer) {
    if (state.editingFolderId !== folder.id) {
        const title = document.createElement('span');
        title.className = config.classNames.folderTitle;
        title.textContent = folder.name;
        return title;
    }

    const input = document.createElement('input');
    input.className = 'vpf-folder-title-input';
    input.value = folder.name;
    input.setAttribute('aria-label', '文件夹名称');

    let cancelled = false;
    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitFolderName(folder.id, input.value, listContainer);
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            cancelled = true;
            state.editingFolderId = null;
            buildVirtualFolders(listContainer);
        }
    });
    input.addEventListener('blur', () => {
        if (!cancelled) {
            commitFolderName(folder.id, input.value, listContainer);
        }
    });

    requestAnimationFrame(() => {
        input.focus();
        input.select();
    });

    return input;
}

function removeFolder(folderId, listContainer) {
    readLayoutFromDOM(listContainer);

    const folder = getFolder(folderId);
    if (!folder) return;

    const replacement = folder.children.map(id => ({ type: 'prompt', id }));
    let replaced = false;

    state.rootOrder = state.rootOrder.flatMap(entry => {
        if (entry.type === 'folder' && entry.id === folderId) {
            replaced = true;
            return replacement;
        }
        return [entry];
    });

    if (!replaced) state.rootOrder.push(...replacement);

    state.folders = state.folders.filter(item => item.id !== folderId);
    delete state.openStates[folderId];
    buildVirtualFolders(listContainer);
    notifyLayoutChanged();
    saveToPresetSoon();
    toastr.info('已解散文件夹，条目已保留');
}

function createFolderDOM(folder, childItems, listContainer) {
    const enabledCount = childItems.filter(isPromptEnabled).length;

    const details = document.createElement('details');
    details.className = config.classNames.folder;
    details.open = folder.open !== false;
    details.dataset.folderId = folder.id;
    details.dataset.folderName = folder.name;

    const summary = document.createElement('summary');
    summary.className = config.classNames.folderSummary;
    summary.draggable = true;
    summary.title = '拖动可移动整个文件夹';

    const chevron = button('fa-angle-right', '展开/收起', 'vpf-chevron');
    chevron.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        setFolderOpen(folder.id, details, !details.open, true);
    });

    const folderMark = document.createElement('span');
    folderMark.className = 'vpf-folder-mark';
    folderMark.innerHTML = '<i class="fa-solid fa-layer-group"></i>';

    const textBlock = document.createElement('span');
    textBlock.className = 'vpf-folder-text';
    textBlock.appendChild(createTitleNode(folder, listContainer));

    const meta = document.createElement('span');
    meta.className = 'vpf-folder-meta';
    meta.textContent = `${enabledCount}/${childItems.length}`;
    meta.title = `已启用条目/全部条目：${enabledCount}/${childItems.length}`;
    textBlock.appendChild(meta);

    const spacer = document.createElement('span');
    spacer.className = 'vpf-folder-spacer';

    const editButton = button('fa-pen', '重命名文件夹');
    editButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        state.editingFolderId = folder.id;
        buildVirtualFolders(listContainer);
    });

    const removeButton = button('fa-trash', '解散文件夹，保留条目');
    removeButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        removeFolder(folder.id, listContainer);
    });

    summary.addEventListener('click', event => {
        if (isInteractiveTarget(event.target)) return;
        event.preventDefault();
        setFolderOpen(folder.id, details, !details.open, true);
    });

    summary.append(chevron, folderMark, textBlock, spacer, editButton, removeButton);
    details.appendChild(summary);

    const content = document.createElement('div');
    content.className = config.classNames.folderContent;
    childItems.forEach(item => {
        item.classList.add(config.classNames.promptInFolder);
        item.draggable = true;
        content.appendChild(item);
    });
    details.appendChild(content);

    return details;
}

function isInteractiveTarget(target) {
    return Boolean(target?.closest?.([
        'button',
        'input',
        'select',
        'textarea',
        '.prompt-manager-inspect-action',
        '.prompt-manager-edit-action',
        '.prompt-manager-toggle-action',
        '.prompt-manager-detach-action',
    ].join(',')));
}

export function buildVirtualFolders(listContainer) {
    if (!listContainer || state.isProcessing) return;

    state.isProcessing = true;
    try {
        const promptItems = getPromptItems(listContainer);
        promptItems.forEach(cleanPromptItem);

        listContainer.innerHTML = '';

        if (!state.enabled) {
            promptItems.forEach(item => listContainer.appendChild(item));
            return;
        }

        const { itemById, rootOrder } = normalizeLayout(promptItems);

        rootOrder.forEach(entry => {
            if (entry.type === 'prompt') {
                const item = itemById.get(entry.id);
                if (!item) return;
                item.classList.add(config.classNames.promptAtRoot);
                item.draggable = true;
                listContainer.appendChild(item);
                return;
            }

            const folder = getFolder(entry.id);
            if (!folder) return;
            const childItems = folder.children.map(id => itemById.get(id)).filter(Boolean);
            listContainer.appendChild(createFolderDOM(folder, childItems, listContainer));
        });
    } catch (error) {
        console.error('[VirtualPromptFolders] Build failed:', error);
    } finally {
        state.isProcessing = false;
    }
}

export function readLayoutFromDOM(listContainer) {
    if (!listContainer) return;

    const existingFolders = new Map(state.folders.map(folder => [folder.id, folder]));
    const folders = [];
    const rootOrder = [];

    Array.from(listContainer.children).forEach(node => {
        if (node.matches?.(`.${config.classNames.folder}`)) {
            const id = node.dataset.folderId;
            const existing = existingFolders.get(id);
            if (!id || !existing) return;

            const content = node.querySelector(`:scope > .${config.classNames.folderContent}`);
            const children = getDirectPromptItems(content).map(getPromptId).filter(Boolean);
            const name = node.dataset.folderName || existing.name;
            folders.push({
                ...existing,
                name,
                open: node.open,
                children: [...new Set(children)],
            });
            rootOrder.push({ type: 'folder', id });
            return;
        }

        if (node.matches?.(config.selectors.promptListItem)) {
            const id = getPromptId(node);
            if (id) rootOrder.push({ type: 'prompt', id });
        }
    });

    state.folders = folders;
    state.rootOrder = rootOrder;
}

export function createFolder(listContainer) {
    if (!listContainer) return;

    readLayoutFromDOM(listContainer);

    const folder = {
        id: createId(),
        name: '新建文件夹',
        open: true,
        children: [],
    };

    state.folders.push(folder);
    state.rootOrder.push({ type: 'folder', id: folder.id });
    state.openStates[folder.id] = true;
    state.editingFolderId = folder.id;
    buildVirtualFolders(listContainer);
    notifyLayoutChanged();
    saveToPresetSoon();
}

export function toggleAllFolders(listContainer, shouldOpen) {
    state.folders.forEach(folder => {
        folder.open = shouldOpen;
        state.openStates[folder.id] = shouldOpen;
    });

    buildVirtualFolders(listContainer);
    saveToPreset().catch(error => console.warn('[VirtualPromptFolders] Save failed:', error));
}

export async function clearAllFolders(listContainer) {
    if (!listContainer) return;

    const promptItems = flattenPromptList(listContainer);
    state.folders = [];
    state.rootOrder = [];
    state.openStates = {};
    state.editingFolderId = null;
    await syncPromptOrderFromItems(promptItems);
    notifyLayoutChanged();
    await saveToPreset();
}

export function setEnabled(listContainer, enabled) {
    state.enabled = enabled;
    if (enabled) {
        buildVirtualFolders(listContainer);
    } else {
        flattenPromptList(listContainer);
    }
    saveToPresetSoon();
}

function clearDropHints(listContainer) {
    listContainer?.querySelectorAll?.('.vpf-drop-before, .vpf-drop-after, .vpf-drop-into').forEach(element => {
        element.classList.remove('vpf-drop-before', 'vpf-drop-after', 'vpf-drop-into');
    });
}

function getPlacement(element, clientY) {
    const rect = element.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function moveBeforeAfter(element, target, placement) {
    if (!element || !target || element === target) return;
    const parent = target.parentElement;
    if (!parent) return;

    if (placement === 'before') {
        if (element.nextElementSibling !== target) {
            parent.insertBefore(element, target);
            dragState.moved = true;
        }
        target.classList.add('vpf-drop-before');
        return;
    }

    const next = target.nextElementSibling;
    if (next !== element) {
        parent.insertBefore(element, next);
        dragState.moved = true;
    }
    target.classList.add('vpf-drop-after');
}

function placePromptOverFolder(promptItem, folder, event) {
    const summary = folder.querySelector(`:scope > .${config.classNames.folderSummary}`);
    const content = folder.querySelector(`:scope > .${config.classNames.folderContent}`);
    if (!summary || !content) return;

    const rect = summary.getBoundingClientRect();
    const topThird = rect.top + rect.height * 0.28;
    const bottomThird = rect.top + rect.height * 0.72;

    if (event.clientY < topThird) {
        moveBeforeAfter(promptItem, folder, 'before');
        return;
    }

    if (event.clientY > bottomThird) {
        moveBeforeAfter(promptItem, folder, 'after');
        return;
    }

    folder.open = true;
    content.appendChild(promptItem);
    folder.classList.add('vpf-drop-into');
    dragState.moved = true;
}

function handleFolderDragOver(listContainer, event) {
    const targetFolder = event.target.closest?.(`.${config.classNames.folder}`);
    const targetRootPrompt = event.target.closest?.(config.selectors.promptListItem);

    clearDropHints(listContainer);

    if (targetFolder?.parentElement === listContainer) {
        moveBeforeAfter(dragState.element, targetFolder, getPlacement(targetFolder, event.clientY));
        return;
    }

    if (targetRootPrompt?.parentElement === listContainer) {
        moveBeforeAfter(dragState.element, targetRootPrompt, getPlacement(targetRootPrompt, event.clientY));
    }
}

function handlePromptDragOver(listContainer, event) {
    const promptItem = dragState.element;
    const targetPrompt = event.target.closest?.(config.selectors.promptListItem);
    const targetFolder = event.target.closest?.(`.${config.classNames.folder}`);

    clearDropHints(listContainer);

    if (targetPrompt && targetPrompt !== promptItem) {
        moveBeforeAfter(promptItem, targetPrompt, getPlacement(targetPrompt, event.clientY));
        return;
    }

    if (targetFolder?.parentElement === listContainer) {
        placePromptOverFolder(promptItem, targetFolder, event);
        return;
    }

    if (event.target === listContainer) {
        listContainer.appendChild(promptItem);
        dragState.moved = true;
    }
}

async function syncPromptOrderFromItems(promptItems) {
    try {
        const { promptManager } = await import('../../../../scripts/openai.js');
        const character = promptManager?.activeCharacter;
        const currentOrder = promptManager?.getPromptOrderForCharacter?.(character);

        if (!character || !Array.isArray(currentOrder) || currentOrder.length === 0) {
            return false;
        }

        const idToEntry = new Map(currentOrder.map(entry => [entry.identifier, entry]));
        const seenIds = new Set();
        const nextOrder = [];

        promptItems.forEach(item => {
            const id = getPromptId(item);
            const entry = idToEntry.get(id);
            if (!entry || seenIds.has(id)) return;
            nextOrder.push(entry);
            seenIds.add(id);
        });

        currentOrder.forEach(entry => {
            if (!entry?.identifier || seenIds.has(entry.identifier)) return;
            nextOrder.push(entry);
        });

        if (nextOrder.length === 0) return false;

        if (promptManager.removePromptOrderForCharacter && promptManager.addPromptOrderForCharacter) {
            promptManager.removePromptOrderForCharacter(character);
            promptManager.addPromptOrderForCharacter(character, nextOrder);
        } else {
            currentOrder.splice(0, currentOrder.length, ...nextOrder);
        }

        await promptManager.saveServiceSettings?.();
        return true;
    } catch (error) {
        console.warn('[VirtualPromptFolders] Prompt order sync failed:', error);
        return false;
    }
}

async function commitDrag(listContainer) {
    const moved = dragState.moved;
    const element = dragState.element;

    state.isDragging = false;
    element?.classList.remove('vpf-dragging');
    listContainer?.classList.remove('vpf-drag-active');
    document.body.classList.remove('vpf-drag-active');
    clearDropHints(listContainer);

    dragState.kind = '';
    dragState.element = null;
    dragState.listContainer = null;
    dragState.moved = false;

    if (!moved || !listContainer) return;

    readLayoutFromDOM(listContainer);
    await syncPromptOrderFromItems(getPromptItems(listContainer));
    buildVirtualFolders(listContainer);
    notifyLayoutChanged();
    await saveToPreset();
}

export function setupVirtualDrag(listContainer) {
    if (!listContainer || listContainer.dataset.vpfDragBound === '1') return;

    listContainer.dataset.vpfDragBound = '1';

    listContainer.addEventListener('dragstart', event => {
        if (!state.enabled || state.editingFolderId) return;

        const summary = event.target.closest?.(`.${config.classNames.folderSummary}`);
        const folder = summary?.closest?.(`.${config.classNames.folder}`);
        const promptItem = event.target.closest?.(config.selectors.promptListItem);

        if (summary && folder && !isInteractiveTarget(event.target)) {
            dragState.kind = 'folder';
            dragState.element = folder;
        } else if (promptItem && !isInteractiveTarget(event.target)) {
            dragState.kind = 'prompt';
            dragState.element = promptItem;
        } else {
            return;
        }

        state.isDragging = true;
        dragState.listContainer = listContainer;
        dragState.moved = false;

        dragState.element.classList.add('vpf-dragging');
        listContainer.classList.add('vpf-drag-active');
        document.body.classList.add('vpf-drag-active');

        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', getPromptId(promptItem) || folder?.dataset.folderId || '');
        event.stopPropagation();
    });

    listContainer.addEventListener('dragover', event => {
        if (!state.isDragging || dragState.listContainer !== listContainer) return;

        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';

        if (dragState.kind === 'folder') {
            handleFolderDragOver(listContainer, event);
        }

        if (dragState.kind === 'prompt') {
            handlePromptDragOver(listContainer, event);
        }
    });

    listContainer.addEventListener('drop', event => {
        if (!state.isDragging || dragState.listContainer !== listContainer) return;
        event.preventDefault();
        event.stopPropagation();
    });

    listContainer.addEventListener('dragend', () => {
        if (!state.isDragging || dragState.listContainer !== listContainer) return;
        commitDrag(listContainer).catch(error => console.warn('[VirtualPromptFolders] Drag commit failed:', error));
    });
}
