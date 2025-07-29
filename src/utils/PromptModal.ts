import {
    App,
    Modal,
    Instruction,
    TFile,
} from "obsidian";
import { RapidNotesSettings } from "../main";

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

    constructor(
        app: App,
        private placeholder: string,
        private promptClass: string,
        private escapeSymbol: string,
        private instructions: Instruction[],
        private settings: RapidNotesSettings
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
            instructionsHeadingEl.innerText = "Prefixed folders:";

            const instructionsFooterEl = document.createElement('div');
            instructionsFooterEl.className = 'prompt-instructions';
            instructionsFooterEl.innerHTML = `Use <code>${this.escapeSymbol}</code> to escape the prefix.`;

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
            const inputValue = this.inputEl.value.trim();
            this.updateExistingNotesHint(inputValue);
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
            const prefix = prefixedFolder.prefix?.trim();
            if (prefix) {
                const expectedPrefix = prefix + separator;
                if (inputValue.startsWith(expectedPrefix)) {
                    return inputValue.substring(expectedPrefix.length);
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
        
        // 1. Exact phrase match (100 points) - highest priority
        if (filenameLower.includes(searchLower)) {
            return 100;
        }
        
        // 2. Word sequence match (80 points) - words appear in order
        if (this.isWordSequenceMatch(filenameLower, searchLower)) {
            return 80;
        }
        
        // 3. Word set match (60 points) - all words present, any order
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
            return;
        }

        // Minimum search length to avoid performance issues and noise
        if (inputValue.trim().length < 2) {
            this.existingNotesHintEl.style.display = 'none';
            this.matchingFilesEl.style.display = 'none';
            return;
        }

        // Get all markdown files in the vault
        const markdownFiles = this.app.vault.getMarkdownFiles();
        
        // Remove prefix from user input if present
        const cleanInputValue = this.removeInputPrefix(inputValue);
        const searchTerm = cleanInputValue !== inputValue ? cleanInputValue : inputValue;

        let matchingFiles: TFile[] = [];
        let matchedFilesWithScores: Array<{file: TFile, score: number}> = [];

        if (this.settings.useFuzzyMatching) {
            // Use fuzzy matching with scoring
            matchedFilesWithScores = markdownFiles
                .map(file => ({
                    file,
                    score: this.calculateMatchScore(file.basename, searchTerm)
                }))
                .filter(result => result.score > 0)
                .sort((a, b) => b.score - a.score); // Sort by score (highest first)

            matchingFiles = matchedFilesWithScores.map(result => result.file);
        } else {
            // Use simple substring matching (original behavior)
            matchingFiles = markdownFiles.filter(file => {
                const filename = file.basename.toLowerCase();
                const inputLower = inputValue.toLowerCase();
                const cleanInputLower = cleanInputValue.toLowerCase();
                
                // Check matching scenarios:
                // 1. Original input matches filename
                // 2. Clean input (without prefix) matches filename
                return filename.includes(inputLower) || 
                       filename.includes(cleanInputLower);
            });

            // Create scores for consistent display logic
            matchedFilesWithScores = matchingFiles.map(file => ({
                file,
                score: 100 // All matches get same score in simple mode
            }));
        }

        if (matchingFiles.length > 0) {
            this.existingNotesHintEl.style.display = 'block';
            
            // Show the search term and match count
            this.existingNotesHintEl.innerHTML = `<span class="existing-notes-count">${matchingFiles.length}</span> existing note(s) found matching "${searchTerm}"`;
            
            // Show matching files list (limit based on settings)
            const limit = this.settings.existingNotesLimit || 3;
            const filesToShow = matchingFiles.slice(0, limit);
            this.matchingFilesEl.innerHTML = '';
            this.matchingFilesEl.style.display = 'block';
            
            filesToShow.forEach((file, index) => {
                const fileEl = document.createElement('div');
                fileEl.className = 'matching-file-item';
                
                // Find the score for this file to show match quality
                const result = matchedFilesWithScores.find(r => r.file === file);
                const score = result?.score || 0;
                
                // Show quality indicators only in fuzzy matching mode
                let qualityIcon = '';
                if (this.settings.useFuzzyMatching) {
                    const matchQuality = score >= 100 ? '💯' : 
                                       score >= 80 ? '🎯' : 
                                       score >= 60 ? '✨' : '📝';
                    qualityIcon = `${matchQuality} `;
                }
                
                // Show filename with match quality indicator (if enabled)
                const displayName = file.basename;
                
                fileEl.innerHTML = `
                    <span class="file-name">${qualityIcon}${displayName}</span>
                    <span class="file-path">${file.path}</span>
                `;
                
                // Click to open existing file
                fileEl.addEventListener('click', () => {
                    this.submitted = true;
                    this.app.workspace.openLinkText(file.path, '', true);
                    this.close();
                });
                
                this.matchingFilesEl.appendChild(fileEl);
            });
            
            if (matchingFiles.length > limit) {
                const moreEl = document.createElement('div');
                moreEl.className = 'matching-file-more';
                moreEl.textContent = `... and ${matchingFiles.length - limit} more`;
                this.matchingFilesEl.appendChild(moreEl);
            }
        } else {
            this.existingNotesHintEl.style.display = 'none';
            this.matchingFilesEl.style.display = 'none';
        }
    }

    listenInput(evt: KeyboardEvent) {
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