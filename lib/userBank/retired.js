// Personal-bank imports are retired. Existing questions and audio remain readable.
export function userBankRetiredResponse() {
  return Response.json({
    ok: false,
    code: "USER_BANK_RETIRED",
    error: "个人题库导入功能已下线，已有题目和练习记录仍可使用。",
  }, { status: 410 });
}
