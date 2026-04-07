import {
    App,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    TFolder,
    Vault,
    normalizePath,
    Editor,
    EditorPosition
} from 'obsidian';
import * as ObsidianApi from 'obsidian';
import { FolderSuggest } from './utils/FolderSuggester';
import { PromptModal } from './utils/PromptModal';
import { SuggesterModal } from './utils/SuggesterModal';
import { arraymove } from './utils/Utils';
import { KeywordsModal } from './utils/KeywordsModal';
import { AliasIndexer } from './utils/AliasIndexer';
import { getLocale } from './i18n';
import Sortable, { SortableOptions } from 'sortablejs';
// @ts-ignore
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
const SortableLib = (Sortable as any);

export enum NotePlacement {
    sameTab,
    newTab = "tab",
    newPane = "split",
    newWindow = "window"
}
export interface PrefixFolderTuple {
    ruleName: string;
    prefix: string;
    filenamePrefix: string;
    folder: string;
    addCommand: boolean;
}

export interface FoldersByPath {
    [path: string]: TFolder;
}

export interface FoldersByPrefix {
    [prefix: string]: PrefixFolderTuple;
}

export interface RapidNotesSettings {
    prefixedFolders: Array<PrefixFolderTuple>;
    forceFileCreation: boolean;
    showModalSuggestions: boolean;
    capitalizeFilename: boolean;
    escapeSymbol: string;
    realPrefixSeparator: string;
    showExistingNotesHint: boolean;
    existingNotesLimit: number;
    useFuzzyMatching: boolean;
    hideUnmatchedRules: boolean;
}

const DEFAULT_SETTINGS = {
    prefixedFolders: [],
    forceFileCreation: false,
    showModalSuggestions: true,
    capitalizeFilename: true,
    escapeSymbol: "/",
    realPrefixSeparator: "",
    showExistingNotesHint: true,
    existingNotesLimit: 3,
    useFuzzyMatching: true,
    hideUnmatchedRules: false
};

const PLACEHOLDER_RESOLVERS = [
    (string: string) => string.replace(
        /\{\{date:([^\}]+)\}\}/gi,
        (_, format) => {
            return window.moment().format(format);
        }
    )
];

export default class RapidNotes extends Plugin {
    settings: RapidNotesSettings;
    aliasIndexer: AliasIndexer;
    aliasIndexReady = false;

    ensureAliasIndexReady() {
        if (this.aliasIndexReady) {
            return;
        }

        this.aliasIndexer.rebuildIndex();
        this.aliasIndexReady = true;
    }

    async onload() {
        console.log(`Loading ${this.manifest.name} plugin`);
        await this.loadSettings();
        this.aliasIndexer = new AliasIndexer(this.app);

        this.addCommands(this);

        this.registerEvent(this.app.metadataCache.on("changed", (file) => {
            if (!this.aliasIndexReady) {
                return;
            }
            this.aliasIndexer.upsertFile(file);
        }));

        this.registerEvent(this.app.metadataCache.on("deleted", (file) => {
            if (!this.aliasIndexReady) {
                return;
            }
            this.aliasIndexer.removeFile(file.path);
        }));

        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
            if (!this.aliasIndexReady) {
                return;
            }
            if (file instanceof TFile) {
                this.aliasIndexer.renameFile(oldPath, file.path);
            }
        }));

        this.app.vault.on("rename", (file, oldPath) => {
            const oldItemIndex = this.settings.prefixedFolders.findIndex(prefixedFolder => prefixedFolder.folder === oldPath);
            if (oldItemIndex >= 0) {
                this.settings.prefixedFolders[oldItemIndex].folder = file.path;
                new Notice(`Rapid notes: ${oldPath} was being used as a prefixed folder, path was updated.`);
                if(this.settings.prefixedFolders[oldItemIndex].addCommand) {
                    new Notice(`Rapid notes: The custom command needs an Obsidian relaunch to work properly.`);
                }
                this.saveSettings();
            };
        });

        this.app.vault.on("delete", file => {
            const oldItemIndex = this.settings.prefixedFolders.findIndex(prefixedFolder => prefixedFolder.folder === file.path);
            if (oldItemIndex >= 0) {
                new Notice(`Rapid notes: ${file.path} was being used as a prefixed folder. The entry will no longer work, remove or update manually.`);
                if(this.settings.prefixedFolders[oldItemIndex].addCommand) {
                    this.settings.prefixedFolders[oldItemIndex].addCommand = false;
                    new Notice(`Rapid notes: The custom command will be removed after Obsidian relaunches.`);
                }
                this.saveSettings();
            };
        });

        this.addSettingTab(new RapidNotesSettingsTab(this.app, this));
    }

    onunload() {
        console.log(`Unloading ${this.manifest.name} plugin`);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    addCommands(plugin: RapidNotes) {
        const locale = getLocale();
        const commandNameForFolder = (folder: string, suffix: string = "") => {
            const baseName = locale.commandNewNoteInFolderTemplate
                ? locale.commandNewNoteInFolderTemplate.replace("{folder}", folder)
                : `${locale.commandNewNoteInFolderPrefix} ${folder}`;
            return `${baseName}${suffix ? ` ${suffix}` : ""}`;
        };
        const folderCommandIdBase = (folder: string) => {
            let hash = 2166136261;
            for (let i = 0; i < folder.length; i++) {
                hash ^= folder.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            const hashText = (hash >>> 0).toString(16).padStart(8, "0");
            return `new-prefixed-note-folder-${hashText}`;
        };

        plugin.addCommand({
            id: "new-prefixed-note",
            name: locale.commandNewNoteCurrentTab,
            callback: async () => {
                const promptValue = await this.promptNewNote();
                if(promptValue) {
                    const { folderPath, filename } = await this.parseFilename(promptValue);
                    this.openNote(folderPath, filename, NotePlacement.sameTab);
                }
            }
        });
        plugin.addCommand({
            id: "new-prefixed-note-new-tab",
            name: locale.commandNewNoteNewTab,
            callback: async () => {
                const promptValue = await this.promptNewNote();
                if(promptValue) {
                    const { folderPath, filename } = await this.parseFilename(promptValue);
                    this.openNote(folderPath, filename, NotePlacement.newTab);
                }
            }
        });
        plugin.addCommand({
            id: "new-prefixed-note-new-background-tab",
            name: locale.commandNewNoteBackgroundTab,
            callback: async () => {
                const promptValue = await this.promptNewNote();
                if(promptValue) {
                    const { folderPath, filename } = await this.parseFilename(promptValue);
                    this.openNote(folderPath, filename, NotePlacement.newTab, false);
                }
            }
        });
        plugin.addCommand({
            id: "new-prefixed-note-new-pane",
            name: locale.commandNewNoteNewPane,
            callback: async () => {
                const promptValue = await this.promptNewNote();
                if(promptValue) {
                    const { folderPath, filename } = await this.parseFilename(promptValue);
                    this.openNote(folderPath, filename, NotePlacement.newPane);
                }
            }
        });
        plugin.addCommand({
            id: "new-prefixed-note-new-window",
            name: locale.commandNewNoteNewWindow,
            callback: async () => {
                const promptValue = await this.promptNewNote();
                if(promptValue) {
                    const { folderPath, filename } = await this.parseFilename(promptValue);
                    this.openNote(folderPath, filename, NotePlacement.newWindow);
                }
            }
        });
        plugin.settings.prefixedFolders.forEach((prefixedFolder) => {
            let fullPrefix = prefixedFolder.filenamePrefix;
            if(fullPrefix) {
                fullPrefix += plugin.settings.realPrefixSeparator;
            }

            if(prefixedFolder.addCommand && prefixedFolder.folder) {
                const commandIdBase = folderCommandIdBase(prefixedFolder.folder);
                plugin.addCommand({
                    id: commandIdBase,
                    name: commandNameForFolder(prefixedFolder.folder),
                    callback: async () => {
                        const promptValue = await this.promptNewNote(prefixedFolder.folder);
                        this.openNote(prefixedFolder.folder, fullPrefix + promptValue, NotePlacement.sameTab);
                    }
                });
                plugin.addCommand({
                    id: commandIdBase + "-new-tab",
                    name: commandNameForFolder(prefixedFolder.folder, locale.commandOpenInNewTabSuffix),
                    callback: async () => {
                        const promptValue = await this.promptNewNote(prefixedFolder.folder);
                        this.openNote(prefixedFolder.folder, fullPrefix + promptValue, NotePlacement.newTab);
                    }
                });
                plugin.addCommand({
                    id: commandIdBase + "-new-background-tab",
                    name: commandNameForFolder(prefixedFolder.folder, locale.commandOpenInBackgroundTabSuffix),
                    callback: async () => {
                        const promptValue = await this.promptNewNote(prefixedFolder.folder);
                        this.openNote(prefixedFolder.folder, fullPrefix + promptValue, NotePlacement.newTab, false);
                    }
                });
                plugin.addCommand({
                    id: commandIdBase + "-new-pane",
                    name: commandNameForFolder(prefixedFolder.folder, locale.commandOpenInNewPaneSuffix),
                    callback: async () => {
                        const promptValue = await this.promptNewNote(prefixedFolder.folder);
                        this.openNote(prefixedFolder.folder, fullPrefix + promptValue, NotePlacement.newPane);
                    }
                });
                plugin.addCommand({
                    id: commandIdBase + "-new-window",
                    name: commandNameForFolder(prefixedFolder.folder, locale.commandOpenInNewWindowSuffix),
                    callback: async () => {
                        const promptValue = await this.promptNewNote(prefixedFolder.folder);
                        this.openNote(prefixedFolder.folder, fullPrefix + promptValue, NotePlacement.newWindow);
                    }
                });
            }
        });

        plugin.addCommand({
            id: "new-prefixed-note-inline-new-tab",
            name: locale.commandNewInlineNoteNewTab,
            editorCallback: async (editor: Editor) => {
                this.triggerInlineReplacement(editor, NotePlacement.newTab);
            },
        });
        plugin.addCommand({
            id: "new-prefixed-note-inline-background-tab",
            name: locale.commandNewInlineNoteBackgroundTab,
            editorCallback: async (editor: Editor) => {
                this.triggerInlineReplacement(editor, NotePlacement.newTab, false);
            },
        });
        plugin.addCommand({
            id: "new-prefixed-note-inline-new-pane",
            name: locale.commandNewInlineNoteNewPane,
            editorCallback: async (editor: Editor) => {
                this.triggerInlineReplacement(editor, NotePlacement.newPane);
            },
        });
        plugin.addCommand({
            id: "new-prefixed-note-inline-new-window",
            name: locale.commandNewInlineNoteNewWindow,
            editorCallback: async (editor: Editor) => {
                this.triggerInlineReplacement(editor, NotePlacement.newWindow);
            },
        });
    }

    async promptNewNote(folder: string = "") {
        let placeholder = "New note";
        let modalSuggestions = Array();
        let showSuggestions = this.settings.showModalSuggestions;

        if(folder) {
            placeholder += ` in ${folder}`;
            showSuggestions = false;
        }
        if(showSuggestions) {
            modalSuggestions = this.settings.prefixedFolders.map((item)=>{ 
                // Use ruleName if available, otherwise use folder path
                const displayName = item.ruleName?.trim() ? item.ruleName : this.resolvePlaceholderValues(item.folder);
                return {"command": item.prefix, "purpose": displayName };
            });
        }

        if (this.settings.showExistingNotesHint) {
            this.ensureAliasIndexReady();
        }

        const escapeSymbol = this.settings.escapeSymbol || "/";
        const prompt = new PromptModal(
            this.app,
            placeholder,
            "rapid-notes-modal",
            escapeSymbol,
            modalSuggestions,
            this.settings,
            this.aliasIndexer
        );
        const promptValue: string = await new Promise((resolve) => prompt.openAndGetValue((resolve), ()=>{}));
        return promptValue.trim();
    }

    checkPrefix(filename: string) {
        let folderPath = "";
        const prefixedFolders = this.getFoldersByPrefix(this.settings.prefixedFolders);
        const separator = " ";
        const separatorIndex = filename.indexOf(separator);
        if (separatorIndex >= 0) {
            const prefix = filename.substring(0, separatorIndex);
            if (prefix in prefixedFolders) {
                // Prefix match found
                folderPath = prefixedFolders[prefix].folder;
                filename = filename.substring(separatorIndex + separator.length);

                // Check if a prefix needs to be added to the note, and add it correctly if the value is a path
                const filenamePrefix = prefixedFolders[prefix].filenamePrefix?.trim();
                if(filenamePrefix) {
                    const lastSlashIndex = filename.lastIndexOf("/");
                    if (lastSlashIndex >= 0) {
                        filename = filename.slice(0, lastSlashIndex + 1) + filenamePrefix + this.settings.realPrefixSeparator + filename.slice(lastSlashIndex + 1);
                    } else {
                        filename = filenamePrefix + this.settings.realPrefixSeparator + filename;
                    }
                }
            }
        }
        return {
            folderPath: folderPath,
            filename: filename
        }
    }

    resolvePlaceholderValues(string: string): string {
        return PLACEHOLDER_RESOLVERS.reduce(
            (resolved, resolver) => resolver(resolved),
            string
        );
    }

    async parseFilename(filename: string) {
        var folderPath = "";
        const escapeSymbol = this.settings.escapeSymbol || "/";
        if (filename.charAt(0) === escapeSymbol) {
            // Prompt value is escaped, no prefix check needed
            filename = filename.substring(1);
        } else {
            ({ folderPath, filename } = this.checkPrefix(filename));
        }
        folderPath = this.resolvePlaceholderValues(folderPath);
        filename = this.resolvePlaceholderValues(filename);
        if (!folderPath) {
            let folders:TFolder[] = this.getFolders();
            const activeFile:TFile|null = this.app.workspace.getActiveFile();
            const preferredFolder:TFolder = this.app.fileManager.getNewFileParent(activeFile?.path || "");

            folders = folders.filter((folder) => folder.path !== preferredFolder.path);
            folders.unshift(preferredFolder);
            const folderPaths = folders.map((folder) => folder.path);
            const suggester = new SuggesterModal(this.app, folderPaths, folderPaths, "Choose folder");
            folderPath = await new Promise((resolve) => suggester.openAndGetValue(resolve, ()=>{}));
        }
        return {
            folderPath: folderPath,
            filename: filename
        }
    }

    async openNote(path: string, filename: string, placement: NotePlacement, active:boolean=true) {
        const folder:TFolder = this.getFolders().find(folder => folder.path === path) || await this.app.vault.createFolder(path);
        const fullFilePath = normalizePath(path + "/" + filename + ".md");

        let file = this.app.vault.getAbstractFileByPath(fullFilePath) as TFile;
        if (file instanceof TFolder) {
            new Notice(`${fullFilePath} found but it's a folder`);
            return;
        } else if(file === null || this.settings.forceFileCreation) {
            // Create note if it doesn't exist
            if(this.settings.capitalizeFilename) {
                filename = filename.split('/').map(substring => substring.charAt(0).toUpperCase() + substring.slice(1)).join('/');
            }
            file = await this.app.fileManager.createNewMarkdownFile(folder, filename);
        }
        this.app.workspace.getLeaf(placement || false).openFile(file, {
            state: { mode: "source" },
            active: active
        });
        return file;
    }

    getFoldersByPrefix(foldersArray: PrefixFolderTuple[]): FoldersByPrefix {
        return foldersArray.reduce((acc: FoldersByPrefix, tuple: PrefixFolderTuple) => ({...acc, [tuple.prefix]: tuple}), {});
    }

    getFolders(): TFolder[] {
        const folders: Set<TFolder> = new Set();
        Vault.recurseChildren(this.app.vault.getRoot(), (file) => {
            if (file instanceof TFolder) {
                folders.add(file);
            }
        });
        return Array.from(folders);
    }

    async triggerInlineReplacement(editor: Editor, notePlacement: NotePlacement, active?: boolean) {
        if (editor.somethingSelected()) {
            const selection = editor.getSelection().trim();
            const [selectionFilename, alias] = selection.split("|");
            const {folderPath, filename} = await this.parseFilename(selectionFilename);
            const file = await this.openNote(folderPath, filename, notePlacement, active);
            if(file instanceof TFile) {
                const replaceText = this.app.fileManager.generateMarkdownLink(file, "", "", alias || filename);
                editor.replaceSelection(replaceText);
            }

        } else {
            const range = editor.getCursor();
            const line = editor.getLine(range.line);
            const match = this.getLinkAtCurrentPosition(line, range.ch);

            if(match) {
                const {folderPath, filename} = await this.parseFilename(match.filename);
                const file = await this.openNote(folderPath, filename, notePlacement, active);
                if(file instanceof TFile) {
                    const replaceText = this.app.fileManager.generateMarkdownLink(file, "", "", match.alias || filename);
                    // Replace text in editor
                    const editorPositionStart: EditorPosition = {
                        line: range.line,
                        ch: match.start
                    };
                    const editorPositionEnd: EditorPosition = {
                        line: range.line,
                        ch: match.end
                    };
                    editor.replaceRange(replaceText, editorPositionStart, editorPositionEnd);
                    editor.setCursor({ ch: match.start + replaceText.length, line: range.line });
                }
            }
        }
    }

    getLinkAtCurrentPosition(line: string, position: number) {
        const matches = [];
        const regex = /\[{2}(.+?)(\|(.*?))?\]{2}/g;
        let match;
        while ((match = regex.exec(line)) !== null) {
            matches.push({
                fullMatch: match[0],
                filename: match[1],
                alias: match[3],
                start: match.index,
                end: regex.lastIndex
            });
        }
        return matches.find(match => position >= match.start && position <= match.end) || null;
    }

    cleanEmptyEntries() {
        this.settings.prefixedFolders = this.settings.prefixedFolders.filter((entry) => {
            return entry.folder !== '' || entry.prefix !== '' || entry.filenamePrefix !== '';
        });
    }
}

class RapidNotesSettingsTab extends PluginSettingTab {
    plugin: RapidNotes;

    constructor(app: App, plugin: RapidNotes) {
        super(app, plugin);
        this.plugin = plugin;
        (this as unknown as { icon?: string }).icon = getLocale().settingsIcon;
    }

    private createSettingGroup(title?: string): {
        addSetting: (cb: (setting: Setting) => void) => void;
        addCustomContainer: (cls?: string) => HTMLElement;
    } {
        const SettingGroupCtor = (ObsidianApi as unknown as {
            SettingGroup?: new (containerEl: HTMLElement) => {
                setHeading: (text: string | DocumentFragment) => unknown;
                addSetting: (cb: (setting: Setting) => void) => unknown;
            };
        }).SettingGroup;

        const hasApiMethods = Boolean(
            SettingGroupCtor &&
            typeof SettingGroupCtor.prototype?.setHeading === "function" &&
            typeof SettingGroupCtor.prototype?.addSetting === "function"
        );

        if (hasApiMethods && SettingGroupCtor) {
            const group = new SettingGroupCtor(this.containerEl);
            const headingText = (title || "").trim();
            if (headingText) {
                const heading = document.createDocumentFragment();
                const titleEl = document.createElement("div");
                titleEl.textContent = headingText;
                heading.appendChild(titleEl);
                group.setHeading(heading);
            }

            return {
                addSetting: (cb) => {
                    group.addSetting(cb);
                },
                addCustomContainer: (cls = "") => {
                    let block: HTMLElement | null = null;
                    group.addSetting((setting) => {
                        setting.infoEl.empty();
                        setting.controlEl.empty();
                        setting.infoEl.style.display = "none";
                        setting.controlEl.style.display = "none";
                        setting.settingEl.style.display = "block";
                        setting.settingEl.addClass("rapid-notes-group-custom-content");
                        if (cls) {
                            block = setting.settingEl.createDiv({ cls });
                        } else {
                            block = setting.settingEl.createDiv();
                        }
                    });
                    return block || this.containerEl;
                }
            };
        }

        const wrapper = this.containerEl.createDiv({ cls: "rapid-notes-settings-group" });
        const headingText = (title || "").trim();
        if (headingText) {
            wrapper.createEl("h3", { text: headingText, cls: "rapid-notes-settings-group-title" });
        }
        return {
            addSetting: (cb) => {
                cb(new Setting(wrapper));
            },
            addCustomContainer: (cls = "") => wrapper.createDiv({ cls })
        };
    }

    private createRulesDescription(locale: ReturnType<typeof getLocale>): DocumentFragment {
        const fragment = document.createDocumentFragment();
        const list = document.createElement("ul");
        list.className = "rapid-notes-rule-help-list";
        const lines: Array<[string, string]> = [
            [locale.addRulesPrefixLabel, locale.addRulesPrefixDesc],
            [locale.addRulesFilenamePrefixLabel, locale.addRulesFilenamePrefixDesc],
            [locale.addRulesFolderLabel, locale.addRulesFolderDesc],
            [locale.addRulesRuleNameLabel, locale.addRulesRuleNameDesc],
            [locale.addRulesToggleLabel, locale.addRulesToggleDesc]
        ];

        lines.forEach(([label, description]) => {
            const row = document.createElement("li");
            row.className = "rapid-notes-rule-help-row";
            const labelEl = document.createElement("strong");
            labelEl.textContent = `${label}: `;
            row.appendChild(labelEl);
            row.append(description);
            list.appendChild(row);
        });

        fragment.appendChild(list);

        const hint = document.createElement("p");
        hint.className = "rapid-notes-rule-help-note";
        hint.textContent = locale.addRulesImportant;
        fragment.appendChild(hint);
        return fragment;
    }

    hide(): void {
        this.plugin.cleanEmptyEntries();
    }

    display(): void {
        const locale = getLocale();
        (this as unknown as { icon?: string }).icon = locale.settingsIcon;

        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: locale.settingsTitle });
        containerEl.createEl("p", { text: locale.settingsIntro, cls: "rapid-notes-settings-intro" });

        const generalGroup = this.createSettingGroup();
        generalGroup.addSetting((setting) => {
            setting
                .setName(locale.forceFileCreationName)
                .addToggle((toggle) => {
                    toggle
                        .setValue(this.plugin.settings.forceFileCreation)
                        .onChange((forceFileCreation) => {
                            this.plugin.settings.forceFileCreation = forceFileCreation;
                            this.plugin.saveSettings();
                        });
                });
        });

        generalGroup.addSetting((setting) => {
            setting
                .setName(locale.escapeSymbolName)
                .setDesc(locale.escapeSymbolDesc)
                .addText((cb) => {
                    cb
                        .setPlaceholder("/")
                        .setValue(this.plugin.settings.escapeSymbol)
                        .onChange((escapeSymbol) => {
                            this.plugin.settings.escapeSymbol = escapeSymbol.trim() || "/";
                            this.plugin.saveSettings();
                        });
                });
        });

        generalGroup.addSetting((setting) => {
            setting
                .setName(locale.capitalizeFilenameName)
                .addToggle((toggle) => {
                    toggle
                        .setValue(this.plugin.settings.capitalizeFilename)
                        .onChange((capitalizeFilename) => {
                            this.plugin.settings.capitalizeFilename = capitalizeFilename;
                            this.plugin.saveSettings();
                        });
                });
        });

        const suggestionsGroup = this.createSettingGroup(locale.groupSuggestionsTitle);
        suggestionsGroup.addSetting((setting) => {
            setting
                .setName(locale.showModalSuggestionsName)
                .addToggle((toggle) => {
                    toggle
                        .setValue(this.plugin.settings.showModalSuggestions)
                        .onChange((showModalSuggestions) => {
                            this.plugin.settings.showModalSuggestions = showModalSuggestions;
                            this.plugin.saveSettings();
                            this.display();
                        });
                });
        });

        if (this.plugin.settings.showModalSuggestions) {
            suggestionsGroup.addSetting((setting) => {
                setting
                    .setName(locale.hideUnmatchedRulesName)
                    .setDesc(locale.hideUnmatchedRulesDesc)
                    .addToggle((toggle) => {
                        toggle
                            .setValue(this.plugin.settings.hideUnmatchedRules)
                            .onChange((hideUnmatchedRules) => {
                                this.plugin.settings.hideUnmatchedRules = hideUnmatchedRules;
                                this.plugin.saveSettings();
                            });
                    });
            });
        }

        suggestionsGroup.addSetting((setting) => {
            setting
                .setName(locale.showExistingNotesHintName)
                .setDesc(locale.showExistingNotesHintDesc)
                .addToggle((toggle) => {
                    toggle
                        .setValue(this.plugin.settings.showExistingNotesHint)
                        .onChange((showExistingNotesHint) => {
                            this.plugin.settings.showExistingNotesHint = showExistingNotesHint;
                            this.plugin.saveSettings();
                            this.display();
                        });
                });
        });

        if (this.plugin.settings.showExistingNotesHint) {
            suggestionsGroup.addSetting((setting) => {
                setting
                    .setName(locale.existingNotesLimitName)
                    .setDesc(locale.existingNotesLimitDesc)
                    .addSlider((slider) => {
                        slider
                            .setLimits(1, 10, 1)
                            .setValue(this.plugin.settings.existingNotesLimit)
                            .setDynamicTooltip()
                            .onChange((existingNotesLimit) => {
                                this.plugin.settings.existingNotesLimit = existingNotesLimit;
                                this.plugin.saveSettings();
                            });
                    });
            });

            suggestionsGroup.addSetting((setting) => {
                setting
                    .setName(locale.useFuzzyMatchingName)
                    .setDesc(locale.useFuzzyMatchingDesc)
                    .addToggle((toggle) => {
                        toggle
                            .setValue(this.plugin.settings.useFuzzyMatching)
                            .onChange((useFuzzyMatching) => {
                                this.plugin.settings.useFuzzyMatching = useFuzzyMatching;
                                this.plugin.saveSettings();
                            });
                    });
            });
        }

        const rulesGroup = this.createSettingGroup(locale.groupRulesTitle);
        rulesGroup.addSetting((setting) => {
            setting
                .setName(locale.separatorName)
                .setDesc(locale.separatorDesc)
                .addText((cb) => {
                    cb
                        .setValue(this.plugin.settings.realPrefixSeparator ?? "")
                        .onChange((realPrefixSeparator) => {
                            this.plugin.settings.realPrefixSeparator = realPrefixSeparator;
                            this.plugin.saveSettings();
                        });
                });
        });

        rulesGroup.addSetting((setting) => {
            setting
                .setClass("rapid-notes-add-prefix-entry")
                .setName(locale.addRulesName)
                .setDesc(this.createRulesDescription(locale))
                .addButton((button) => {
                    button
                        .setTooltip(locale.addRulesTooltip)
                        .setButtonText(locale.addRuleButtonText)
                        .setCta()
                        .onClick(() => {
                            this.plugin.cleanEmptyEntries();
                            this.plugin.settings.prefixedFolders.unshift({
                                ruleName: "",
                                folder: "",
                                prefix: "",
                                filenamePrefix: "",
                                addCommand: false
                            });
                            this.display();
                        });
                });
        });

        const rulesList = rulesGroup.addCustomContainer("rapid-notes-rules-container");

        this.plugin.settings.prefixedFolders.forEach((prefixedFolder, index) => {
            const entryEl = rulesList.createDiv({ cls: "rapid-notes-rule-entry" });
            entryEl.setAttribute("data-index", String(index));

            const dragHandle = entryEl.createEl("span", {
                cls: "rapid-notes-drag-handle",
                attr: { "aria-label": locale.dragHandleAriaLabel, "data-tooltip-position": "top" }
            });
            dragHandle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;

            const prefixInput = entryEl.createEl("input", {
                cls: "rapid-notes-field rapid-notes-field--prefix",
                attr: { type: "text", placeholder: locale.inputPrefixPlaceholder, spellcheck: "false" }
            });
            prefixInput.value = prefixedFolder.prefix;
            prefixInput.addEventListener("change", () => {
                const newPrefix = prefixInput.value;
                if (newPrefix && this.plugin.settings.prefixedFolders.some((entry, entryIndex) => entryIndex !== index && entry.prefix === newPrefix)) {
                    new Notice(locale.noticePrefixAlreadyUsed);
                    prefixInput.value = prefixedFolder.prefix;
                    return;
                }
                if (newPrefix && /\s/.test(newPrefix)) {
                    new Notice(locale.noticePrefixContainsSpace);
                    prefixInput.value = prefixedFolder.prefix;
                    return;
                }
                this.plugin.settings.prefixedFolders[index].prefix = newPrefix;
                this.plugin.saveSettings();
            });

            const filenamePrefixInput = entryEl.createEl("input", {
                cls: "rapid-notes-field rapid-notes-field--filename-prefix",
                attr: { type: "text", placeholder: locale.inputFilenamePrefixPlaceholder, spellcheck: "false" }
            });
            filenamePrefixInput.value = prefixedFolder.filenamePrefix;
            filenamePrefixInput.addEventListener("change", () => {
                this.plugin.settings.prefixedFolders[index].filenamePrefix = filenamePrefixInput.value.trim();
                this.plugin.saveSettings();
            });

            const folderWrapper = entryEl.createDiv({ cls: "rapid-notes-field rapid-notes-field--folder search-input-container" });
            const folderInput = folderWrapper.createEl("input", {
                attr: { type: "search", placeholder: locale.inputFolderPlaceholder, spellcheck: "false", enterkeyhint: "search" }
            });
            folderWrapper.createDiv({ cls: "search-input-clear-button" }).addEventListener("click", () => {
                folderInput.value = "";
                this.plugin.settings.prefixedFolders[index].folder = "";
                this.plugin.saveSettings();
            });
            new FolderSuggest(this.app, folderInput);
            folderInput.value = prefixedFolder.folder;
            folderInput.addEventListener("change", () => {
                const newFolder = folderInput.value;
                if (newFolder && this.plugin.settings.prefixedFolders.some((entry, entryIndex) => entryIndex !== index && entry.folder === newFolder)) {
                    new Notice(locale.noticeFolderAlreadyUsed);
                    folderInput.value = prefixedFolder.folder;
                    return;
                }
                this.plugin.settings.prefixedFolders[index].folder = newFolder;
                this.plugin.saveSettings();
            });

            const ruleNameInput = entryEl.createEl("input", {
                cls: "rapid-notes-field rapid-notes-field--rule-name",
                attr: { type: "text", placeholder: locale.inputRuleNamePlaceholder, spellcheck: "false" }
            });
            ruleNameInput.value = prefixedFolder.ruleName;
            ruleNameInput.addEventListener("change", () => {
                this.plugin.settings.prefixedFolders[index].ruleName = ruleNameInput.value.trim();
                this.plugin.saveSettings();
            });

            const toggleWrapper = entryEl.createDiv({ cls: "rapid-notes-field rapid-notes-field--toggle" });
            new ObsidianApi.ToggleComponent(toggleWrapper)
                .setTooltip(locale.registerCommandAriaLabel)
                .setValue(prefixedFolder.addCommand)
                .onChange((checked) => {
                    this.plugin.settings.prefixedFolders[index].addCommand = checked;
                    this.plugin.saveSettings();
                    new Notice(locale.addRulesImportant);
                });

            const deleteBtn = entryEl.createDiv({
                cls: "rapid-notes-field rapid-notes-delete-btn clickable-icon",
                attr: { "aria-label": locale.deleteButtonAriaLabel }
            });
            deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
            deleteBtn.addEventListener("click", () => {
                this.plugin.settings.prefixedFolders.splice(index, 1);
                this.plugin.saveSettings();
                this.display();
            });
        });

        if (this.plugin.settings.prefixedFolders.length > 0) {
            const SortableClass = SortableLib.default || SortableLib;
            SortableClass.create(rulesList, {
                handle: ".rapid-notes-drag-handle",
                animation: 150,
                ghostClass: "sortable-ghost",
                dragClass: "sortable-drag",
                onEnd: (evt: { oldIndex: number | undefined; newIndex: number | undefined }) => {
                    const oldIndex = evt.oldIndex;
                    const newIndex = evt.newIndex;
                    if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) {
                        return;
                    }
                    const item = this.plugin.settings.prefixedFolders.splice(oldIndex, 1)[0];
                    this.plugin.settings.prefixedFolders.splice(newIndex, 0, item);
                    this.plugin.saveSettings();
                    this.display();
                }
            });
        }
    }
}
