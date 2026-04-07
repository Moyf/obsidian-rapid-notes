import { getLanguage } from "obsidian";
import en from "./locales/en";
import zhCn from "./locales/zh-cn";
import type { RapidNotesLocale } from "./types";

const locales: Record<string, RapidNotesLocale> = {
    en,
    "en-us": en,
    "en-gb": en,
    zh: zhCn,
    "zh-cn": zhCn,
    "zh-hans": zhCn
};

function resolveLanguage(): string {
    return (getLanguage?.() || "en").toLowerCase();
}

export function getLocale(): RapidNotesLocale {
    const language = resolveLanguage();
    return locales[language] || locales[language.split("-")[0]] || en;
}
