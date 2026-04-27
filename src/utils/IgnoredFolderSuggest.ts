import { App, TAbstractFile, TFolder } from "obsidian";
import { TextInputSuggest } from "./suggest";
import type RapidNotes from "../main";

export class IgnoredFolderSuggest extends TextInputSuggest<TFolder> {
    constructor(
        app: App,
        inputEl: HTMLInputElement,
        private plugin: RapidNotes,
        private settingTab: { display(): void }
    ) {
        super(app, inputEl);
    }

    getSuggestions(inputStr: string): TFolder[] {
        const abstractFiles = this.app.vault.getAllLoadedFiles();
        const lowerCaseInputStr = inputStr.toLowerCase();
        const ignoredFolders = this.plugin.settings.ignoredFolders;

        const folders: TFolder[] = [];

        abstractFiles.forEach((file: TAbstractFile) => {
            if (!(file instanceof TFolder)) return;
            if (file.path === "") return;

            // Exclude already ignored folders or children of ignored folders
            const isIgnored = ignoredFolders.some(
                (ignored) =>
                    file.path === ignored ||
                    file.path.startsWith(ignored + "/")
            );
            if (isIgnored) return;

            if (file.path.toLowerCase().contains(lowerCaseInputStr)) {
                folders.push(file);
            }
        });

        return folders;
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.path);
    }

    selectSuggestion(folder: TFolder): void {
        if (!this.plugin.settings.ignoredFolders.includes(folder.path)) {
            this.plugin.settings.ignoredFolders.push(folder.path);
            this.plugin.saveSettings();
        }
        this.inputEl.value = "";
        this.inputEl.trigger("input");
        this.settingTab.display();
        this.close();
    }
}
