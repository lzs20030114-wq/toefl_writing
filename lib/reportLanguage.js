export const REPORT_LANGUAGE = {
  ZH: "zh",
  EN: "en",
};

export function normalizeReportLanguage(lang) {
  return lang === REPORT_LANGUAGE.EN ? REPORT_LANGUAGE.EN : REPORT_LANGUAGE.ZH;
}

export function getReportLanguageLabel(lang) {
  return normalizeReportLanguage(lang) === REPORT_LANGUAGE.EN ? "English" : "中文";
}
