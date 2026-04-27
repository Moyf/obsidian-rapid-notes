import { App, TAbstractFile, TFolder } from "obsidian";
import { TextInputSuggest } from "./suggest";
import type RapidNotes from "../main";

export class IgnoredFolderSuggest extends TextInputSuggest<TFolder> {
    private onChanged: (() => void) | null = null;

    constructor(
        app: App,
        inputEl: HTMLInputElement,
        private plugin: RapidNotes
    ) {
        super(app, inputEl);
    }

    setOnChanged(cb: () => void): this {
        this.onChanged = cb;
        return this;
    }

    getSuggestions(inputStr: string): TFolder[] {
        const abstractFiles = this.app.vault.getAllLoadedFiles();
        const lowerCaseInputStr = inputStr.toLowerCase();
        const ignoredFolders = this.plugin.settings.ignoredFolders;

        const folders: TFolder[] = [];

        abstractFiles.forEach((file: TAbstractFile) => {
            if (!(file instanceof TFolder)) return;
            if (file.path === "") return;

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
        if (this.onChanged) {
            this.onChanged();
        }
        this.close();
    }
}
