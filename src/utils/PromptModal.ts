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
        const inputValue = this.inputEl.value.trim();
        this.updateExistingNotesHint(inputValue);
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

    updateExistingNotesHint(inputValue: string) {
        // Check if the feature is enabled
        if (!this.settings.showExistingNotesHint || !inputValue) {
            this.existingNotesHintEl.style.display = 'none';
            this.matchingFilesEl.style.display = 'none';
            return;
        }

        // Get all markdown files in the vault
        const markdownFiles = this.app.vault.getMarkdownFiles();
        
        // Remove prefix from user input if present
        const cleanInputValue = this.removeInputPrefix(inputValue);
        
        // Filter files that match the input (case-insensitive)
        const matchingFiles = markdownFiles.filter(file => {
            const filename = file.basename.toLowerCase();
            const inputLower = inputValue.toLowerCase();
            const cleanInputLower = cleanInputValue.toLowerCase();
            
            // Check matching scenarios:
            // 1. Original input matches filename
            // 2. Clean input (without prefix) matches filename
            return filename.includes(inputLower) || 
                   filename.includes(cleanInputLower);
        });

        if (matchingFiles.length > 0) {
            this.existingNotesHintEl.style.display = 'block';
            
            // Show the actual search term used (cleaned input if prefix was removed)
            const searchTerm = cleanInputValue !== inputValue ? cleanInputValue : inputValue;
            this.existingNotesHintEl.innerHTML = `<span class="existing-notes-count">${matchingFiles.length}</span> existing note(s) found matching "${searchTerm}"`;
            
            // Show matching files list (limit based on settings)
            const limit = this.settings.existingNotesLimit || 3;
            const filesToShow = matchingFiles.slice(0, limit);
            this.matchingFilesEl.innerHTML = '';
            this.matchingFilesEl.style.display = 'block';
            
            filesToShow.forEach((file, index) => {
                const fileEl = document.createElement('div');
                fileEl.className = 'matching-file-item';
                
                // Just show the original filename since files don't have prefixes
                const displayName = file.basename;
                
                fileEl.innerHTML = `
                    <span class="file-name">${displayName}</span>
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