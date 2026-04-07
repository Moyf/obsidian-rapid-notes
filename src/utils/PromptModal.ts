import {
    App,
    Modal,
    Instruction,
    TFile,
} from "obsidian";
import { RapidNotesSettings } from "../main";
import { getLocale } from "../i18n";
import { AliasIndexer } from "./AliasIndexer";

export class PromptModal extends Modal {
    private resolve: (value: string) => void;
    private reject: () => void;
    private submitted = false;
    private searchTimeout: NodeJS.Timeout | null = null;

    inputEl: HTMLInputElement;
    inputListener: EventListener;
    inputChangeListener: EventListener;
    existingNotesHintEl: HTMLDivElement;
    matchingFilesEl: HTMLDivElement;
    instructionElements: HTMLDivElement[] = [];
    visibleMatchingFiles: TFile[] = [];
    selectedMatchIndex = -1;
    hasNavigatedSuggestions = false;
    locale = getLocale();

    constructor(
        app: App,
        private placeholder: string,
        private promptClass: string,
        private escapeSymbol: string,
        private instructions: Instruction[],
        private settings: RapidNotesSettings,
        private aliasIndexer?: AliasIndexer
    ) {
        super(app);

        // Create input
        this.inputEl = document.createElement('input');
        this.inputEl.type = 'text';
        this.inputEl.placeholder = placeholder;
        this.inputEl.className = 'prompt-input';

        this.modalEl.className = `prompt ${this.promptClass}`;
        this.modalEl.innerHTML = '';
        this.modalEl.appendChild(this.inputEl);

        // Create existing notes hint element
        this.existingNotesHintEl = document.createElement('div');
        this.existingNotesHintEl.className = 'existing-notes-hint';
        this.existingNotesHintEl.style.display = 'none';
        this.modalEl.appendChild(this.existingNotesHintEl);

        // Create matching files list element
        this.matchingFilesEl = document.createElement('div');
        this.matchingFilesEl.className = 'matching-files-list';
        this.matchingFilesEl.style.display = 'none';
        this.modalEl.appendChild(this.matchingFilesEl);

        if(instructions.length) {
            // Suggestions block
            const instructionsHeadingEl = document.createElement('div');
            instructionsHeadingEl.className = 'prompt-instructions prompt-instructions-heading';
            instructionsHeadingEl.innerText = this.locale.promptPrefixedFoldersHeading;

            const instructionsFooterEl = document.createElement('div');
            instructionsFooterEl.className = 'prompt-instructions';
            instructionsFooterEl.innerHTML = this.locale.promptEscapePrefixHelpText
                .replace("{symbol}", this.escapeSymbol);

            const instructionsListEl = document.createElement('div');
            instructionsListEl.className = 'prompt-instructions';
            const children = instructions.map((instruction) => {
                const child = document.createElement('div');
                child.className = 'prompt-instruction';

                const command = document.createElement('span');
                command.className = 'prompt-instruction-command';
                command.innerText = instruction.command;
                child.appendChild(command);

                const purpose = document.createElement('span');
                purpose.innerText = instruction.purpose;
                child.appendChild(purpose);

                return child;
            });
            for (const child of children) {
                instructionsListEl.appendChild(child);
                this.instructionElements.push(child);
            }
            this.modalEl.appendChild(instructionsHeadingEl);
            this.modalEl.appendChild(instructionsListEl);
            this.modalEl.appendChild(instructionsFooterEl);
        }

        this.inputListener = this.listenInput.bind(this);
        this.inputChangeListener = this.onInputChange.bind(this);
    }

    onInputChange() {
        // Clear existing timeout
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }
        
        // Add debounce to improve performance
        this.searchTimeout = setTimeout(() => {
            const inputValue = this.inputEl.value;
            this.updateExistingNotesHint(inputValue.trim());
            this.updateInstructionHighlighting(inputValue);
        }, 200); // 200ms debounce
    }

    /**
     * Remove prefix from user input for comparison
     * This handles cases where user types "插件 A" and we want to search for "A"
     */
    removeInputPrefix(inputValue: string): string {
        const separator = this.settings.realPrefixSeparator || " ";
        
        // Check if the input starts with any configured prefix (not filenamePrefix)
        for (const prefixedFolder of this.settings.prefixedFolders) {
            const prefixes = prefixedFolder.prefix ? [prefixedFolder.prefix] : [];
            for (const prefix of prefixes) {
                if (prefix) {
                    const expectedPrefix = prefix.trim() + separator;
                    if (inputValue.startsWith(expectedPrefix)) {
                        return inputValue.substring(expectedPrefix.length);
                    }
                }
            }
        }
        
        return inputValue;
    }

    /**
     * Calculate match score for fuzzy matching
     * Higher score means better match
     */
    calculateMatchScore(filename: string, searchTerm: string): number {
        const filenameLower = filename.toLowerCase();
        const searchLower = searchTerm.toLowerCase();

        if (!searchLower.trim()) {
            return 0;
        }

        // 1. Exact title match
        if (filenameLower === searchLower) {
            return 140;
        }

        // 2. Title starts with query
        if (filenameLower.startsWith(searchLower)) {
            return 120;
        }
        
        // 3. Title contains query
        if (filenameLower.includes(searchLower)) {
            return 100;
        }
        
        // 4. Word sequence match - words appear in order
        if (this.isWordSequenceMatch(filenameLower, searchLower)) {
            return 80;
        }
        
        // 5. Word set match - all words present, any order
        if (this.isWordSetMatch(filenameLower, searchLower)) {
            return 60;
        }
        
        return 0; // No match
    }

    /**
     * Check if search words appear in sequence in the filename
     * e.g., "OB 插件" matches "OB相关插件" 
     */
    isWordSequenceMatch(filename: string, searchTerm: string): boolean {
        const searchWords = searchTerm.split(/\s+/).filter(word => word.length > 0);
        let lastIndex = 0;
        
        for (const word of searchWords) {
            const foundIndex = filename.indexOf(word.toLowerCase(), lastIndex);
            if (foundIndex === -1) {
                return false;
            }
            lastIndex = foundIndex + word.length;
        }
        return true;
    }

    /**
     * Check if all search words are present in filename (any order)
     * e.g., "OB 插件" matches "插件 for OB"
     */
    isWordSetMatch(filename: string, searchTerm: string): boolean {
        const searchWords = searchTerm.split(/\s+/).filter(word => word.length > 0);
        return searchWords.every(word => filename.includes(word.toLowerCase()));
    }

    updateExistingNotesHint(inputValue: string) {
        // Check if the feature is enabled
        if (!this.settings.showExistingNotesHint || !inputValue) {
            this.existingNotesHintEl.style.display = 'none';
            this.matchingFilesEl.style.display = 'none';
            this.visibleMatchingFiles = [];
            this.selectedMatchIndex = -1;
            this.hasNavigatedSuggestions = false;
            return;
        }

        // Minimum search length to avoid performance issues and noise
        if (inputValue.trim().length < 2) {
            this.existingNotesHintEl.style.display = 'none';
            this.matchingFilesEl.style.display = 'none';
            this.visibleMatchingFiles = [];
            this.selectedMatchIndex = -1;
            this.hasNavigatedSuggestions = false;
            return;
        }

        // Get all markdown files in the vault
        const markdownFiles = this.app.vault.getMarkdownFiles();
        
        // Remove prefix from user input if present
        const cleanInputValue = this.removeInputPrefix(inputValue);
        const searchTerm = cleanInputValue !== inputValue ? cleanInputValue : inputValue;

        const fileByPath = new Map(markdownFiles.map(file => [file.path, file]));
        const matchedFilesByPath = new Map<string, {
            file: TFile,
            score: number,
            matchType: 'title' | 'alias',
            matchedAlias?: string
        }>();

        if (this.settings.useFuzzyMatching) {
            markdownFiles.forEach(file => {
                const score = this.calculateMatchScore(file.basename, searchTerm);
                if (score > 0) {
                    matchedFilesByPath.set(file.path, {
                        file,
                        score,
                        matchType: 'title'
                    });
                }
            });
        } else {
            const inputLower = inputValue.toLowerCase();
            const cleanInputLower = cleanInputValue.toLowerCase();

            markdownFiles.forEach(file => {
                const filename = file.basename.toLowerCase();
                const isTitleMatch = filename.includes(inputLower) || filename.includes(cleanInputLower);
                if (isTitleMatch) {
                    const score = this.calculateMatchScore(file.basename, searchTerm);
                    matchedFilesByPath.set(file.path, {
                        file,
                        score: score > 0 ? score : 100,
                        matchType: 'title'
                    });
                }
            });
        }

        if (this.aliasIndexer) {
            const aliasMatches = this.aliasIndexer.searchByAliasWithMatch(searchTerm);
            aliasMatches.forEach(match => {
                const file = fileByPath.get(match.path);
                if (!file) {
                    return;
                }

                const existingMatch = matchedFilesByPath.get(match.path);
                if (!existingMatch || match.score > existingMatch.score) {
                    matchedFilesByPath.set(match.path, {
                        file,
                        score: match.score,
                        matchType: 'alias',
                        matchedAlias: match.alias
                    });
                }
            });
        }

        const matchedFilesWithScores = Array.from(matchedFilesByPath.values())
            .sort((a, b) => {
                if (b.score !== a.score) {
                    return b.score - a.score;
                }

                if (a.file.basename.length !== b.file.basename.length) {
                    return a.file.basename.length - b.file.basename.length;
                }

                return a.file.basename.localeCompare(b.file.basename);
            });

        const matchingFiles: TFile[] = matchedFilesWithScores.map(result => result.file);

        if (matchingFiles.length > 0) {
            this.existingNotesHintEl.style.display = 'block';
            
            // Show the search term and match count
            const foundMatchingText = this.locale.existingNotesFoundMatchingText
                .replace("{term}", searchTerm);
            this.existingNotesHintEl.innerHTML = `<span class="existing-notes-count">${matchingFiles.length}</span> ${foundMatchingText}`;
            
            // Show matching files list (limit based on settings)
            const limit = this.settings.existingNotesLimit || 3;
            const filesToShow = matchingFiles.slice(0, limit);
            this.visibleMatchingFiles = filesToShow;
            this.selectedMatchIndex = -1;
            this.hasNavigatedSuggestions = false;
            this.matchingFilesEl.innerHTML = '';
            this.matchingFilesEl.style.display = 'block';
            
            filesToShow.forEach((file, index) => {
                const fileEl = document.createElement('div');
                fileEl.className = 'matching-file-item';
                fileEl.dataset.index = index.toString();

                // Find the result for this file
                const result = matchedFilesWithScores.find(r => r.file === file);
                const matchType = result?.matchType || 'title';

                // Show icon based on match type
                // Alias 命中时，在 filename 位置直接显示命中的 alias
                const displayName = matchType === 'alias'
                    ? (result?.matchedAlias || searchTerm)
                    : file.basename;

                fileEl.innerHTML = `
                    <span class="file-name">${displayName}</span>
                    <span class="file-path">${file.path}</span>
                `;
                
                // Click to open existing file
                fileEl.addEventListener('click', () => {
                    this.openMatchingFile(file);
                });
                
                this.matchingFilesEl.appendChild(fileEl);
            });
            
            if (matchingFiles.length > limit) {
                const moreEl = document.createElement('div');
                moreEl.className = 'matching-file-more';
                moreEl.textContent = this.locale.matchingFilesMoreText
                    .replace("{count}", String(matchingFiles.length - limit));
                this.matchingFilesEl.appendChild(moreEl);
            }
        } else {
            this.existingNotesHintEl.style.display = 'none';
            this.matchingFilesEl.style.display = 'none';
            this.visibleMatchingFiles = [];
            this.selectedMatchIndex = -1;
            this.hasNavigatedSuggestions = false;
        }
    }

    private openMatchingFile(file: TFile) {
        this.submitted = true;
        this.app.workspace.openLinkText(file.path, '', true);
        this.close();
    }

    private updateSelectedMatchItem() {
        const items = this.matchingFilesEl.querySelectorAll('.matching-file-item');
        items.forEach((item, index) => {
            if (index === this.selectedMatchIndex) {
                item.addClass('is-selected');
                (item as HTMLElement).scrollIntoView({ block: 'nearest' });
            } else {
                item.removeClass('is-selected');
            }
        });
    }

    private moveSelection(direction: 1 | -1) {
        if (!this.visibleMatchingFiles.length) {
            return;
        }

        this.hasNavigatedSuggestions = true;

        if (this.selectedMatchIndex === -1) {
            this.selectedMatchIndex = direction === 1 ? 0 : this.visibleMatchingFiles.length - 1;
        } else {
            this.selectedMatchIndex = (this.selectedMatchIndex + direction + this.visibleMatchingFiles.length) % this.visibleMatchingFiles.length;
        }

        this.updateSelectedMatchItem();
    }

    /**
     * Update CSS classes for prompt instructions based on input prefix matching
     */
    updateInstructionHighlighting(inputValue: string) {
        if (!this.instructionElements.length) {
            return;
        }

        const separator = this.settings.realPrefixSeparator || " ";
        const instructionsListEl = this.instructionElements[0].parentElement as HTMLElement;
        
        // Only start matching detection if input contains the separator
        if (!inputValue.includes(separator)) {
            // No separator found, reset all elements to normal state
            instructionsListEl?.removeClass('hide-unmatched');
            this.instructionElements.forEach((element) => {
                element.removeClass('prefix-matched');
                element.removeClass('prefix-unmatched');
                element.style.display = '';
            });
            return;
        }

        // Find all matching prefixes based on input prefix logic
        const matchingPrefixes: string[] = [];
        
        // Extract the potential prefix from input (before separator)
        const separatorIndex = inputValue.indexOf(separator);
        const inputPrefix = inputValue.substring(0, separatorIndex);
        
        // Check which configured prefixes match the input prefix
        for (const prefixedFolder of this.settings.prefixedFolders) {
            const prefixes = prefixedFolder.prefix ? [prefixedFolder.prefix] : [];
            for (const configuredPrefix of prefixes) {
                if (configuredPrefix) {
                    const trimmedPrefix = configuredPrefix.trim();
                    // Check if the configured prefix starts with the input prefix
                    if (trimmedPrefix.startsWith(inputPrefix)) {
                        matchingPrefixes.push(trimmedPrefix);
                    }
                }
            }
        }

        // Set parent class based on hide setting
        if (this.settings.hideUnmatchedRules) {
            instructionsListEl?.addClass('hide-unmatched');
        } else {
            instructionsListEl?.removeClass('hide-unmatched');
        }

        // Update CSS classes for each instruction element
        this.instructionElements.forEach((element, index) => {
            const instruction = this.instructions[index];
            const isMatching = matchingPrefixes.includes(instruction.command);
            
            // Remove previous highlighting classes
            element.removeClass('prefix-matched');
            element.removeClass('prefix-unmatched');
            
            // Add appropriate highlighting class
            if (inputPrefix && matchingPrefixes.length > 0) {
                if (isMatching) {
                    element.addClass('prefix-matched');
                } else {
                    element.addClass('prefix-unmatched');
                }
                // Reset display style, let CSS handle visibility
                element.style.display = '';
            } else {
                // No prefix input or no matches, show all elements normally
                element.style.display = '';
            }
        });
    }

    listenInput(evt: KeyboardEvent) {
        if (evt.key === 'ArrowDown') {
            evt.preventDefault();
            this.moveSelection(1);
            return;
        }

        if (evt.key === 'ArrowUp') {
            evt.preventDefault();
            this.moveSelection(-1);
            return;
        }

        if (evt.key === 'Enter') {
            // prevent enter after note creation
            evt.preventDefault();
            this.enterCallback(evt);
        }
    }

    onOpen(): void {
        this.inputEl.focus();
        this.inputEl.addEventListener('keydown', this.inputListener);
        this.inputEl.addEventListener('input', this.inputChangeListener);
    }

    onClose(): void {
        // Clear search timeout to prevent memory leaks
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = null;
        }
        
        this.inputEl.removeEventListener('keydown', this.inputListener);
        this.inputEl.removeEventListener('input', this.inputChangeListener);
        this.contentEl.empty();
        if (!this.submitted) {
            // TOFIX: for some reason throwing Error on iOS causes the app to freeze.
            this.reject();
        }
    }

    private enterCallback(evt: KeyboardEvent) {
        if (evt.key === "Enter") {
            if (this.hasNavigatedSuggestions && this.selectedMatchIndex >= 0 && this.visibleMatchingFiles[this.selectedMatchIndex]) {
                this.openMatchingFile(this.visibleMatchingFiles[this.selectedMatchIndex]);
                return;
            }

            this.resolveAndClose(evt);
        }
    }

    private resolveAndClose(evt: Event | KeyboardEvent) {
        this.submitted = true;
        evt.preventDefault();
        this.resolve(this.inputEl.value);
        this.close();
    }

    async openAndGetValue(
        resolve: (value: string) => void,
        reject: () => void
    ): Promise<void> {
        this.resolve = resolve;
        this.reject = reject;
        this.open();
    }
}
