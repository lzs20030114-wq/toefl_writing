// Client-side bridge to (re)open the first-set survey on demand.
//
// FirstSetSurveyTrigger is mounted globally (app/layout.js) and owns the modal
// state. The homepage "填写题库体验问卷" entry can't reach that state directly, so
// it dispatches this window event; the trigger listens and force-opens the modal,
// bypassing the auto-gate (the user may have already dismissed/answered this round).
export const FIRST_SET_SURVEY_OPEN_EVENT = "first-set-survey:open";

export function openFirstSetSurvey() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FIRST_SET_SURVEY_OPEN_EVENT));
}
