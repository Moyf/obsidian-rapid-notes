import { App, TFile } from 'obsidian';

interface AliasIndex {
    // normalized alias -> matches with original alias value
    [normalizedAlias: string]: AliasEntry[];
}

interface AliasEntry {
    path: string;
    alias: string;
}

interface AliasMatch {
    path: string;
    alias: string;
    score: number;
}

/**
 * Indexer for note aliases to enable fast alias-based searching
 */
export class AliasIndexer {
    private index: AliasIndex = {};
    private aliasesByPath: Record<string, string[]> = {};
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Get all aliases for a specific file
     */
    private getFileAliases(file: TFile): string[] {
        const fileCache = this.app.metadataCache.getFileCache(file);

        if (!fileCache || !fileCache.frontmatter) {
            return [];
        }

        const aliases = fileCache.frontmatter.aliases;

        // aliases can be a string or an array of strings
        if (typeof aliases === 'string') {
            return [aliases];
        } else if (Array.isArray(aliases)) {
            return aliases.filter(a => typeof a === 'string');
        }

        return [];
    }

    /**
     * Rebuild the alias index from scratch
     */
    public rebuildIndex(): void {
        this.index = {};
        this.aliasesByPath = {};

        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            const aliases = this.getFileAliases(file);

            for (const alias of aliases) {
                const trimmedAlias = alias.trim();
                const normalizedAlias = trimmedAlias.toLowerCase();

                if (!trimmedAlias) {
                    continue;
                }

                if (!this.index[normalizedAlias]) {
                    this.index[normalizedAlias] = [];
                }

                this.index[normalizedAlias].push({
                    path: file.path,
                    alias: trimmedAlias
                });

                if (!this.aliasesByPath[file.path]) {
                    this.aliasesByPath[file.path] = [];
                }

                if (!this.aliasesByPath[file.path].includes(normalizedAlias)) {
                    this.aliasesByPath[file.path].push(normalizedAlias);
                }
            }
        }
    }

    public removeFile(path: string): void {
        const normalizedAliases = this.aliasesByPath[path];
        if (!normalizedAliases?.length) {
            return;
        }

        for (const normalizedAlias of normalizedAliases) {
            const currentEntries = this.index[normalizedAlias];
            if (!currentEntries?.length) {
                continue;
            }

            const filteredEntries = currentEntries.filter(entry => entry.path !== path);
            if (filteredEntries.length) {
                this.index[normalizedAlias] = filteredEntries;
            } else {
                delete this.index[normalizedAlias];
            }
        }

        delete this.aliasesByPath[path];
    }

    public upsertFile(file: TFile): void {
        this.removeFile(file.path);

        const aliases = this.getFileAliases(file);
        if (!aliases.length) {
            return;
        }

        for (const alias of aliases) {
            const trimmedAlias = alias.trim();
            const normalizedAlias = trimmedAlias.toLowerCase();

            if (!trimmedAlias) {
                continue;
            }

            if (!this.index[normalizedAlias]) {
                this.index[normalizedAlias] = [];
            }

            this.index[normalizedAlias].push({
                path: file.path,
                alias: trimmedAlias
            });

            if (!this.aliasesByPath[file.path]) {
                this.aliasesByPath[file.path] = [];
            }

            if (!this.aliasesByPath[file.path].includes(normalizedAlias)) {
                this.aliasesByPath[file.path].push(normalizedAlias);
            }
        }
    }

    public renameFile(oldPath: string, newPath: string): void {
        const normalizedAliases = this.aliasesByPath[oldPath];
        if (!normalizedAliases?.length) {
            return;
        }

        for (const normalizedAlias of normalizedAliases) {
            const currentEntries = this.index[normalizedAlias];
            if (!currentEntries?.length) {
                continue;
            }

            this.index[normalizedAlias] = currentEntries.map(entry => {
                if (entry.path === oldPath) {
                    return {
                        ...entry,
                        path: newPath
                    };
                }

                return entry;
            });
        }

        this.aliasesByPath[newPath] = normalizedAliases;
        delete this.aliasesByPath[oldPath];
    }

    /**
     * Search files by alias
     */
    public searchByAlias(query: string): string[] {
        return this.searchByAliasWithMatch(query).map(match => match.path);
    }

    private isWordSequenceMatch(text: string, query: string): boolean {
        const queryWords = query.split(/\s+/).filter(word => word.length > 0);
        let lastIndex = 0;

        for (const word of queryWords) {
            const foundIndex = text.indexOf(word, lastIndex);
            if (foundIndex === -1) {
                return false;
            }
            lastIndex = foundIndex + word.length;
        }

        return queryWords.length > 0;
    }

    private isWordSetMatch(text: string, query: string): boolean {
        const queryWords = query.split(/\s+/).filter(word => word.length > 0);
        return queryWords.length > 0 && queryWords.every(word => text.includes(word));
    }

    private calculateAliasScore(alias: string, query: string): number {
        const normalizedAlias = alias.toLowerCase().trim();
        const normalizedQuery = query.toLowerCase().trim();

        if (!normalizedAlias || !normalizedQuery) {
            return 0;
        }

        if (normalizedAlias === normalizedQuery) {
            return 120;
        }

        if (normalizedAlias.includes(normalizedQuery)) {
            return 100;
        }

        if (this.isWordSequenceMatch(normalizedAlias, normalizedQuery)) {
            return 90;
        }

        if (this.isWordSetMatch(normalizedAlias, normalizedQuery)) {
            return 80;
        }

        const compactAlias = normalizedAlias.replace(/\s+/g, '');
        const compactQuery = normalizedQuery.replace(/\s+/g, '');

        if (compactAlias.includes(compactQuery) && compactQuery.length > 0) {
            return 70;
        }

        return 0;
    }

    public searchByAliasWithMatch(query: string): AliasMatch[] {
        const normalizedQuery = query.toLowerCase().trim();

        if (!normalizedQuery) {
            return [];
        }

        const bestMatchByPath = new Map<string, AliasMatch>();

        for (const normalizedAlias in this.index) {
            const matches = this.index[normalizedAlias];
            for (const match of matches) {
                const score = this.calculateAliasScore(match.alias, normalizedQuery);
                if (score <= 0) {
                    continue;
                }

                const candidate: AliasMatch = {
                    path: match.path,
                    alias: match.alias,
                    score
                };

                const currentBest = bestMatchByPath.get(match.path);
                if (!currentBest || candidate.score > currentBest.score) {
                    bestMatchByPath.set(match.path, candidate);
                }
            }
        }

        return Array.from(bestMatchByPath.values())
            .sort((a, b) => b.score - a.score || a.alias.localeCompare(b.alias));
    }
}
