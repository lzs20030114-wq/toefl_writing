export const REPORT_LANGUAGE = {
  ZH: "zh",
  EN: "en",
};

const STORAGE_KEY = "toefl-report-language";

export function normalizeReportLanguage(lang) {
  return lang === REPORT_LANGUAGE.EN ? REPORT_LANGUAGE.EN : REPORT_LANGUAGE.ZH;
}

export function getReportLanguageLabel(lang) {
  return normalizeReportLanguage(lang) === REPORT_LANGUAGE.EN ? "English" : "中文";
}

export function readReportLanguage() {
  try {
    return normalizeReportLanguage(localStorage.getItem(STORAGE_KEY));
  } catch {
    return REPORT_LANGUAGE.ZH;
  }
}

export function saveReportLanguage(lang) {
  try {
    localStorage.setItem(STORAGE_KEY, normalizeReportLanguage(lang));
  } catch { /* ignore */ }
}
