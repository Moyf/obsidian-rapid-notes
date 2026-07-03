// Credits go to SilentVoid13's Templater Plugin: https://github.com/SilentVoid13/Templater

import { App, FuzzyMatch, FuzzySuggestModal, TFile } from "obsidian";

export class SuggesterModal<T> extends FuzzySuggestModal<T> {
    private resolve: (value: T) => void;
    private reject: () => void;
    private submitted = false;

    constructor(
        app: App,
        private text_items: string[] | ((item: T) => string),
        private items: T[],
        placeholder: string,
        limit?: number
    ) {
        super(app);
        this.setPlaceholder(placeholder);
        limit && (this.limit = limit);
    }

    getItems(): T[] {
        return this.items;
    }

    onClose(): void {
        if (!this.submitted) {
            this.reject();
        }
    }

    selectSuggestion(
        value: FuzzyMatch<T>,
        evt: MouseEvent | KeyboardEvent
    ): void {
        this.submitted = true;
        this.close();
        this.onChooseSuggestion(value, evt);
    }

    getItemText(item: T): string {
        if (this.text_items instanceof Function) {
            return this.text_items(item);
        }
        return (
            this.text_items[this.items.indexOf(item)] || "Undefined Text Item"
        );
    }

    onChooseItem(item: T): void {
        this.resolve(item);
    }

    async openAndGetValue(
        resolve: (value: T) => void,
        reject: () => void
    ): Promise<void> {
        this.resolve = resolve;
        this.reject = reject;
        this.open();
    }
}

/**
 * Result returned by FolderOrNoteChooserModal.
 * - mode "folder": user chose a folder path string
 * - mode "note":   user chose a TFile to convert to a FolderNote
 */
export type FolderOrNoteChoice =
    | { mode: "folder"; folderPath: string }
    | { mode: "note"; file: TFile };

/**
 * Texts needed by the chooser modal, injected by the caller so this file
 * stays free of i18n imports.
 */
export interface FolderOrNoteChooserTexts {
    /** Placeholder when in folder-selection mode, e.g. "Choose folder (Press Tab to choose note)" */
    folderPlaceholder: string;
    /** Placeholder when in note-selection mode, e.g. "Choose note to convert to FolderNote" */
    notePlaceholder: string;
}

/**
 * A folder-chooser modal that supports pressing Tab to switch to a note-picker
 * mode. In note mode the user selects an existing TFile; the caller is then
 * responsible for calling convertNoteToFolderNote on it.
 *
 * The modal only exposes the note-mode toggle when `notePicker` is truthy.
 * Pass `notePicker: undefined` (or omit it) to behave exactly like
 * SuggesterModal<string> — the Tab key is not intercepted.
 */
export class FolderOrNoteChooserModal extends FuzzySuggestModal<string | TFile> {
    private resolve!: (value: FolderOrNoteChoice) => void;
    private reject!: () => void;
    private submitted = false;

    /** Whether we are currently showing notes instead of folders. */
    private noteMode = false;

    private folderItems: string[];
    private noteItems: TFile[];

    constructor(
        app: App,
        folders: string[],
        private readonly texts: FolderOrNoteChooserTexts,
        /** When undefined Tab switching is disabled (FN not available / feature off). */
        private readonly notePicker: TFile[] | undefined,
    ) {
        super(app);
        this.folderItems = folders;
        this.noteItems = notePicker ?? [];
        this.setPlaceholder(texts.folderPlaceholder);

        // Register Tab via the Obsidian scope system so it's actually intercepted.
        // (SuggestModal has no onKeydown hook — all key handling goes through this.scope.)
        if (notePicker !== undefined) {
            this.scope.register([], "Tab", (evt) => {
                evt.preventDefault();
                this.toggleMode();
                return false;
            });
        }
    }

    /** Switch between folder and note mode. */
    private toggleMode(): void {
        this.noteMode = !this.noteMode;
        this.setPlaceholder(
            this.noteMode ? this.texts.notePlaceholder : this.texts.folderPlaceholder,
        );
        // Wipe the search input so the new list is shown in full.
        this.inputEl.value = "";
        // Trigger a re-render of suggestions.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).updateSuggestions();
    }

    // ── FuzzySuggestModal overrides ────────────────────────────────────────

    getItems(): (string | TFile)[] {
        return this.noteMode ? this.noteItems : this.folderItems;
    }

    getItemText(item: string | TFile): string {
        if (item instanceof TFile) {
            return item.path;
        }
        return item;
    }

    onChooseItem(item: string | TFile): void {
        if (item instanceof TFile) {
            this.resolve({ mode: "note", file: item });
        } else {
            this.resolve({ mode: "folder", folderPath: item });
        }
    }

    selectSuggestion(
        value: FuzzyMatch<string | TFile>,
        evt: MouseEvent | KeyboardEvent,
    ): void {
        this.submitted = true;
        this.close();
        this.onChooseSuggestion(value, evt);
    }

    onClose(): void {
        if (!this.submitted) {
            this.reject();
        }
    }

    async openAndGetValue(
        resolve: (value: FolderOrNoteChoice) => void,
        reject: () => void,
    ): Promise<void> {
        this.resolve = resolve;
        this.reject = reject;
        this.open();
    }
}
