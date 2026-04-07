import { App, Modal, Notice } from 'obsidian';

export class KeywordsModal extends Modal {
    private resolve: (keywords: string[]) => void;
    private keywords: string[];
    private keywordElements: HTMLDivElement[] = [];

    constructor(
        app: App,
        keywords: string[],
        onSubmit: (keywords: string[]) => void
    ) {
        super(app);
        this.keywords = [...keywords];
        this.resolve = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Manage Keywords' });

        // Create keywords container
        const keywordsContainer = contentEl.createEl('div', { cls: 'keywords-editor-container' });

        // Render existing keywords
        this.keywords.forEach((keyword, index) => {
            this.renderKeyword(keywordsContainer, keyword, index);
        });

        // Add new keyword input
        const addKeywordContainer = contentEl.createEl('div', { cls: 'add-keyword-container' });
        const input = addKeywordContainer.createEl('input', {
            type: 'text',
            placeholder: 'Type keyword and press Enter'
        });

        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                const newKeyword = input.value.trim();
                if (newKeyword) {
                    if (this.keywords.includes(newKeyword)) {
                        new Notice('Keyword already exists!');
                        return;
                    }
                    if (/\s/.test(newKeyword)) {
                        new Notice('Keywords cannot contain spaces!');
                        return;
                    }
                    this.keywords.push(newKeyword);
                    this.renderKeyword(keywordsContainer, newKeyword, this.keywords.length - 1);
                    input.value = '';
                }
            }
        });

        // Buttons
        const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });

        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'mod-cancel'
        });
        if (cancelButton) {
            (cancelButton as any).onclick = () => this.close();
        }

        const saveButton = buttonContainer.createEl('button', {
            text: 'Save',
            cls: 'mod-cta'
        });
        (saveButton as any).onclick = () => {
            this.resolve(this.keywords);
            this.close();
        };
    }

    renderKeyword(container: HTMLElement, keyword: string, index: number) {
        const keywordEl = container.createEl('div', {
            cls: 'keyword-tag',
            text: keyword
        });

        const removeBtn = keywordEl.createEl('span', {
            cls: 'keyword-remove',
            text: '×'
        });

        (removeBtn as any).onclick = () => {
            this.keywords.splice(index, 1);
            keywordEl.remove();
            // Update indices of remaining elements
            this.updateKeywordIndices();
        };

        this.keywordElements.push(keywordEl);
    }

    updateKeywordIndices() {
        const container = this.contentEl.querySelector('.keywords-editor-container');
        const keywordTags = container?.querySelectorAll('.keyword-tag');
        if (keywordTags) {
            keywordTags.forEach((tag, index) => {
                const removeBtn = tag.querySelector('.keyword-remove');
                if (removeBtn) {
                    (removeBtn as any).onclick = () => {
                        this.keywords.splice(index, 1);
                        tag.remove();
                        this.updateKeywordIndices();
                    };
                }
            });
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
