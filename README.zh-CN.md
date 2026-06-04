# Virtual Prompt Folders

一个给 SillyTavern OpenAI 预设提示词管理器使用的“虚拟文件夹”扩展。

## 这个版本的核心区别

旧版折叠逻辑通常会把某个普通 prompt 条目当作文件夹标题。这个扩展不会这样做：

- 文件夹是插件自己的虚拟对象，不是普通 prompt 条目。
- prompt 条目可以拖进文件夹，也可以拖出来。
- 文件夹可以作为整体拖动排序。
- 删除文件夹只会解散文件夹，里面的 prompt 条目会保留。
- 清空文件夹会恢复为普通条目列表。

## 安装

把 `ST-VirtualPromptFolders` 文件夹放到：

```text
SillyTavern/public/scripts/extensions/third-party/
```

然后重启 SillyTavern，或在扩展面板重新加载扩展。

建议不要和其他 prompt 折叠类扩展同时启用，避免多个扩展同时重排同一个提示词列表。

## 使用

1. 打开 OpenAI 预设提示词管理器。
2. 点击顶部文件夹加号按钮新建文件夹。
3. 直接拖动普通 prompt 条目到文件夹中。
4. 拖动文件夹标题可以移动整个文件夹。
5. 点击文件夹标题可以展开或收起。
6. 点击重置按钮可以清空当前预设的全部虚拟文件夹。

配置会保存到当前预设的 `extensions.virtual_prompt_folders` 中，并额外写入浏览器本地缓存。

## 备注

- 文件夹本身不会发送给模型。
- 文件夹展开/收起只影响显示，不会禁用里面的 prompt。
- 拖动完成后，扩展会尝试把视觉顺序同步回 SillyTavern 的 prompt 顺序。
