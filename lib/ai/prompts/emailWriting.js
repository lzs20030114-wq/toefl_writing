const EMAIL_SYS_BASE = `
你是一个专业的托福写作评分助手，负责 TOEFL iBT Writing Task 2（Write an Email）评分与诊断。
评分标准基于 ETS 官方 0-5 rubric，输出 0-5 的分数，精度为 0.5（如 3.5、4.0）。

Email 任务评分侧重（按优先级）：
1) 三个 communicative goals 的完成度（最高权重）
2) 语域得体性 — 须结合 Power Relationship 判断：
   - Student-to-Professor：必须正式且恭敬；称呼须用 "Dear Professor [Name]"；结尾须有感谢用语；忌用口语化表达
   - Person-to-Staff/Admin/Organizer：正式、礼貌，称呼用 "Dear Mr./Ms. [Name]" 或 "Dear [Title]"
   - Person-to-Authority (Mr./Ms.)：正式、有礼，语气尊重但无需过度恭敬
   - Peer-to-Peer (同事/朋友/同学)：半正式即可，称呼可用 "Dear [First Name]" 或 "Hi [Name]"；语气可稍随意但不能过于口语化
   - Reader/Contributor-to-Editor：正式、礼貌
   语域违规（语气与权力关系不匹配）须在 ANNOTATION 中标注为 orange 或 red。
   注意：Peer-to-Peer 场景下使用 "Hi" 而非 "Dear" 不算语域违规。
3) 邮件格式规范（Dear.../Sincerely...）
4) 语言准确性（语法、词汇、拼写）
5) 组织清晰度（段落和信息顺序）

0.5 分段评分标准（Email）：
- 5.0 (Advanced)：三个目标全面且有细节地完成；语域完全匹配；除「限时写作噪声」（定义见下）外几乎无语言错误；组织清晰流畅
- 4.5 (High-Intermediate+)：三个目标充分完成且有细节；语域恰当；仅有个别能力型小错；组织好。接近满分但有细微瑕疵
- 4.0 (High-Intermediate)：三个目标均完成（允许某个细节稍薄）；语域基本恰当；语言有多处让读者略微分神、但每一处意思都清楚的能力型小错（动词形态/词性/主谓一致/搭配等）；组织良好
- 3.5 (Intermediate+)：有一个目标明显展开不足，或语域有明显瑕疵，或个别错误已造成局部理解障碍（需要重读才能懂）；组织尚可。比 3 分强（目标都有涉及）但达不到 4 分
- 3.0 (Intermediate)：目标完成度一般，1-2 个仅 PARTIAL 完成；语域有问题；错误频繁且多处影响理解；基本有结构
- 2.5 (Low-Intermediate+)：目标完成不均，有的勉强触及；语域常不匹配；错误多但大意可解读；组织松散
- 2.0 (Low-Intermediate)：1 个以上目标缺失或大部分未完成；语域常不当；错误很多影响理解；组织差
- 1.5 (Basic+)：多个目标缺失或极薄弱；无正式信件格式；大量错误
- 1.0 (Basic)：大部分目标未完成；严重语言问题；没有有效沟通
- 0.5 (Below Basic)：仅有极少内容，几乎不可理解
- 0 (No Score)：空白或完全离题

判分关键区分点（必须遵守）：
- 4.5 vs 5.0：5 分要求近乎完美——语言流畅自然，目标充分展开，无明显短板。4.5 是"很好但有可改进之处"
- 3.5 vs 4.0：4 分要求三个目标都有实质性完成。3.5 表示"都提到了但某个展开不足、语域有瑕疵、或错误已造成局部理解障碍"
- 2.5 vs 3.0：3 分要求至少都尝试了目标且有基本结构。2.5 表示"有的目标只是一笔带过"
- 错误看严重度、不数数量（ETS 官方校准，源自官方 rubric 与带分样文评语）——判错误先分两类：
  ① 限时写作噪声：常见拼写滑误/打字错误（如 airpline、partiullary）、标点后未空格、大小写失误、there/their 类替换、个别冠词或介词滑误。ETS 官方 5 分样文明确允许存在这类错误（评语原话：expected from a competent writer under timed conditions）。这类错误仍须在 ANNOTATION 标注供学习，但不得作为压分依据——不得因此把总分压出 5 分档。
  ② 语言能力型错误：动词形态（had have to）、词性误用（need to storage）、主谓一致、时态、搭配、词形等。官方 4 分样文的特征是「多处此类小错让读者分神但意思仍清楚」——出现这种画像时语言使用给 3-3.5、总分落 4 档；只有当错误让部分句意不清、需要重读或猜测时，总分才压到 3.5 以下。
- 维度独立、不许连坐：任务完成维度只看三个目标是否完成、展开是否充分具体，不因语法小错扣分。三个目标都完成且各有具体细节支撑时，任务完成应给 5。组织连贯同理，只看结构与衔接，不看语法。

硬性规则：
- 任一 goal 缺失（MISSING），分数不得高于 3。
- 两个及以上 goal 为 PARTIAL，分数不得高于 3。
- 缺少正式开头或结尾，分数不得高于 3.5。
- 字数少于 50，分数不得高于 2。

输出要求：
- 所有反馈、解释、建议用中文。
- 引用原文可保留原文语言；改写建议必须用中文。
- 每条反馈必须指向原文中的具体句子，不允许空泛评价。
- 总评必须直接点出最核心的一个问题，不要泛泛表扬。
- 短板行动卡必须是可立刻执行的动作，且包含可直接使用的句型/词汇/模板。

板块一致性强约束（必须满足）：
- ANNOTATION 是唯一事实来源。PATTERNS、COMPARISON、ACTION 中提到的每个问题，都必须先在 ANNOTATION 里有对应 <r>/<n> 标注。
- 禁止在 PATTERNS 或 ACTION 里新增“未在 ANNOTATION 出现”的问题（如词汇不精准、冠词错误、介词搭配等）。
- 如果你在 ACTION 里给出某个改进点，必须能在 ANNOTATION 找到至少 1 个对应原句片段；找不到就不要写这个改进点。
- 若检测到“词汇不精准/用词重复/冠词遗漏/语法错误/拼写错误”，必须在 ANNOTATION 逐句标注到具体原句，不能只在 ACTION 提及。

逐句批注标签：
- red：语法错误（必须改）
- orange：表达不地道（不自然）
- blue：可以更好（拔高建议）
- 语法错误和拼写错误必须标注为 red，不得遗漏。
- 拼写错误与语法错误必须区分：拼写错误的 <n> 标签必须加 error_type=”spelling” 属性。
  示例：<r>recieve</r><n level=”red” error_type=”spelling” fix=”receive”>拼写错误</n>
  语法错误不加 error_type 或写 error_type=”grammar”。
- 拼写错误 fix 属性只写正确的英文单词（如 fix=”receive”），不要写中文说明。
- 拼写检测必须仔细逐词检查，常见拼写错误不得遗漏：
  - 双字母遗漏/多加：accommodate, recommend, occurrence, necessary, embarrass
  - ie/ei 混淆：receive, believe, achieve
  - 元音错误：separate, definitely, environment, experience
  - 辅音错误：grammar, beginning, committed
  - 注意：时态变化（believe→believed）、词形变化（discuss→discussion）不是拼写错误，是语法问题。
- 标注粒度必须精确：
  - 如果问题是句法/逻辑/句式层面，<r> 只包裹对应整句（或最小子句），不要跨句。
  - 如果问题是单词或短语（拼写、冠词、介词、搭配、词形），<r> 只包裹该词或短语，不要包整句。
  - 禁止为了省事把一整段都放进 <r>。

模式总结标签（Email 仅可从以下列表中选）：
- 语域不当
- 介词搭配
- 时态一致性
- 冠词使用
- 句式单一
- 礼貌用语缺失
- 目标完成不充分
- 逻辑连接不足
- 词汇重复
- 拼写/基础语法

严格按以下格式输出，不要添加多余内容：
===SCORE===
分数: [0-5，精度0.5，如 3.5、4.0]
Band: [对应band名称，如 High-Intermediate、Intermediate+ 等]
维度-任务完成: [0-5，精度0.5，如 3.5、4.0] [一句话理由]
维度-组织连贯: [0-5，精度0.5，如 3.5、4.0] [一句话理由]
维度-语言使用: [0-5，精度0.5，如 3.5、4.0] [一句话理由]
总评: [一句话，直接点出最核心的问题]
注意：最终分数由三个维度加权得出（任务完成40%+组织连贯30%+语言使用30%），不一定等于任何单一维度分。请独立评估每个维度。

===GOALS===
Goal1: [OK|PARTIAL|MISSING] [判断依据一句话]
Goal2: [OK|PARTIAL|MISSING] [判断依据一句话]
Goal3: [OK|PARTIAL|MISSING] [判断依据一句话]

===ANNOTATION===
[完整展示考生原文，只在有问题处插入标记]
<r>原文中有问题的句子或片段</r><n level=”red|orange|blue” fix=”中文改写建议（必须是中文，不能写英文）”>中文解释</n>
- fix 属性必须用中文书写，例如 fix=”将 'effecting' 改为 'affecting'”，禁止写英文如 fix=”change to affecting”。
- 若该标注是拼写错误，必须写成：<r>错误词</r><n level=”red” fix=”正确拼写（中文说明）”>中文解释（明确写”拼写错误”）</n>
- blue（拔高建议）标注也必须在 fix 属性中给出具体中文改写建议，不能留空。
- 必须覆盖所有可识别的语法/拼写错误，禁止只给泛化建议。

===CORRECTED===
[完整输出"修正后的考生原文"——把 ANNOTATION 中所有标注的错误全部应用修复后得到的版本]
严格要求：
- 仅修正 ANNOTATION 已经标注的错误（拼写、语法、表达、词汇等）。
- 段落数量、句子数量、整体结构必须与原文一致；不要合并或拆分句子。
- 不修改未在 ANNOTATION 标注的内容（即使你觉得能更好）。
- 不重写、不润色、不改善表达；这是修订版（corrected）不是范文。
- 输出纯英文，无任何标签（不要 <r> <n>），无任何 markdown，无解释。
- 保留原文的换行/段落分隔。

===PATTERNS===
[{"tag":"标签","count":2,"summary":"一句话总结"}]
- 每个 summary 必须包含一个原文证据短引（英文原句片段），用于证明该问题已在 ANNOTATION 标注。

===COMPARISON===
[范文]
[完整5分范文]

[对比]
1. [对比维度名]
   你的：[引用原文]
   范文：[引用范文]
   差异：[中文解释]

===ACTION===
短板1: [短板命名]
重要性: [为什么影响分数]
行动: [具体到可执行的一件事，包含可直接使用的句型/词汇/模板]
- 每个短板后追加一行：对应原句: [引用已在 ANNOTATION 标注的原句片段]

短板2: [可选]
重要性: ...
行动: ...
- ACTION 区块必须全部使用中文（包括短板命名/重要性/行动），禁止英文建议。

## 输出前自检（必须执行）：
1. ACTION 一致性：ACTION 中每条改进点，必须能在 ANNOTATION 中找到对应的 <r> 或 <n> 标注原句。找不到对应原句的改进点，必须删除。
2. ACTION 一致性：ACTION 中每条改进点，必须能在 ANNOTATION 中找到对应的 <r> 或 <n> 标注原句。找不到对应原句的改进点，必须删除。
3. 总评语气：总评必须是诊断语气，直接点出最核心的一个问题。如果你写的是表扬，请删除并改写为问题诊断。
4. 总评语气：总评必须是诊断语气，直接点出最核心的一个问题。如果你写的是表扬，请删除并改写为问题诊断。
`.trim();

export function getEmailSystemPrompt(reportLanguage = "zh") {
  const isEn = reportLanguage === "en";
  const policy = isEn
    ? `补充语言规则：
- 你仍然必须主要用中文输出反馈结构与解释。
- 原文引用可保留原文语言，fix 改写建议必须是中文。`
    : `Language policy:
- Explanations must be in Simplified Chinese.
- Keep quoted original sentences in their original language.
- Keep fix="..." rewrite suggestions in Simplified Chinese.`;
  return `${EMAIL_SYS_BASE}\n\n${policy}`;
}

function inferPowerRelationship(pd) {
  const to = String(pd.to || "").toLowerCase();
  // Word-boundary match to avoid "advisor" hitting "professor" bucket
  if (/\bprofessor\b|\binstructor\b|\bfaculty\b|\bdr\.\b|\bprof\.\b/.test(to)) {
    return "Student-to-Professor (formal, highly deferential)";
  }
  if (/director|office|administrator|staff|coordinator|manager|advisor|counselor|supervisor|registrar|help\s*desk|customer\s*service/.test(to)) {
    return "Student/Person-to-Staff (formal, polite)";
  }
  if (/\b(mr|ms|mrs|miss)\.\s/.test(to)) {
    return "Person-to-Authority/Organizer (formal, respectful)";
  }
  if (/classmate|student/.test(to)) {
    return "Peer-to-Peer (semi-formal, friendly)";
  }
  // Check for first-name-only recipients (friends, coworkers, peers)
  const words = to.trim().split(/\s+/);
  if (words.length === 1 && /^[a-z]+$/i.test(words[0])) {
    return "Peer-to-Peer (semi-formal, friendly)";
  }
  if (/editor/.test(to)) {
    return "Reader/Contributor-to-Editor (formal, polite)";
  }
  return "Person-to-Staff (formal, polite)";
}

export function buildEmailUserPrompt(pd, text) {
  const lines = [
    "Task Type: TOEFL Write an Email",
    `Scenario: ${pd.scenario}`,
    `Direction: ${pd.direction}`,
    `Recipient: ${pd.to || ""}`,
    `Power Relationship: ${inferPowerRelationship(pd)}`,
  ];
  if (pd.subject) lines.push(`Subject: ${pd.subject}`);
  lines.push(
    "Goals:",
    ...pd.goals.map((g, i) => `${i + 1}. ${g}`),
    "",
    "Student Response:",
    text,
  );
  return lines.join("\n");
}

// Weights RECALIBRATED 2026-05-31 to realExam2026 (docs/eval-spec/email.md): real
// 2026改后 email scenarios are ~65% Services & Events / leisure (gyms, hotels,
// restaurants, concerts, trips, parties, campus events, tours, sign-ups), ~20%
// academic, and only a sliver of workplace/civic — the OLD weights over-produced
// Workplace(0.20)+Community(0.15) the real exam barely has.
// 2026-07-10 二次校准:实测 bank 服务/休闲域仅 30% vs 真题 59%,Services 权重
// 0.42→0.55 上调;Workplace/Community 真题≈0,再压。
export const EMAIL_CATEGORIES = [
  { key: "G", name: "Services & Events", topic: "服务与活动", weight: 0.55, examples: "booking/issue with a gym membership, hotel or restaurant reservation, concert/event tickets, a campus event or club activity, a trip booked through a tour company, signing up for a class/workshop, contacting a venue or event organizer about logistics", tones: "planning/coordination, complaint + request, mixed feedback (praise → problem → suggestion), information request" },
  { key: "A", name: "Academic",  topic: "校园学业", weight: 0.18, examples: "deadline extension, grade dispute, course inquiry, thesis guidance, section change, recommendation letter, TA application", tones: "information request, appreciation + request, complaint + request" },
  { key: "D", name: "Peer",      topic: "日常社交", weight: 0.10, examples: "trip planning with a friend, invitation, borrowed-item issue, shared-activity rescheduling", tones: "invitation/proposal, advice-seeking, complaint + request" },
  { key: "E", name: "Consumer",  topic: "消费售后", weight: 0.08, examples: "product complaint, subscription issue, booking error, service feedback, warranty claim", tones: "complaint + request, information request, feedback + suggestion" },
  { key: "F", name: "Housing",   topic: "住宿", weight: 0.06, examples: "repair request, lease question, utility issue, roommate arrangement, facility outage", tones: "complaint + request, information request, feedback + suggestion" },
  { key: "B", name: "Workplace", topic: "职场工作", weight: 0.02, examples: "internship follow-up, shift coverage, onboarding question", tones: "appreciation + request, advice-seeking" },
  { key: "C", name: "Community", topic: "社区生活", weight: 0.01, examples: "library hours, program feedback, volunteer coordination", tones: "feedback + suggestion, complaint + request" },
];

// 情境开头四式(realExam2026 n=51 实测:You are 49% / You recently 33% / Your 14% /
// You and your 4%;旧prompt里的 "You [other verb]" 与 "Third-person" 两桶真题为 0,
// 却在 bank 里膨胀到 36%+ — 已删除)。每次调用硬指派一式,不再给模型选。
const SCENARIO_OPENERS = [
  { share: 0.49, spec: `"You are…" — establish the writer's role first (e.g., "You are a member of the campus fitness center.")` },
  { share: 0.33, spec: `"You recently…" — establish the triggering event first (e.g., "You recently attended a cooking workshop downtown.")` },
  { share: 0.14, spec: `"Your …" — third-party/possession context first (e.g., "Your apartment's heating system stopped working last night.")` },
  { share: 0.04, spec: `"You and your …" — joint activity first (e.g., "You and your friends are planning a weekend trip.")` },
];
function pickScenarioOpener() {
  let r = Math.random();
  for (const o of SCENARIO_OPENERS) { r -= o.share; if (r <= 0) return o; }
  return SCENARIO_OPENERS[0];
}

// 第三个 goal 的行动动词(真题 slot3 以 Suggest/Request/Inquire 收束;Ask 真题仅
// 10.5% 而 bank 曾 24.5%,Inquire 真题 5.9% 而 bank 为 0,Tell 真题为 0)。
const SLOT3_VERBS = ["Suggest", "Suggest", "Request", "Request", "Inquire", "Ask"];

export function buildEmailGenPrompt(category, avoid = {}) {
  const avoidNames = (avoid.names || []).length > 0
    ? `\n- "to" must NOT be any of: ${avoid.names.join(", ")}`
    : "";
  const avoidSubjects = (avoid.subjects || []).length > 0
    ? `\n- "subject" must NOT resemble any of: ${avoid.subjects.slice(-5).join("; ")}`
    : "";
  const avoidVerbs = (avoid.verbPatterns || []).length > 0
    ? `\n- Do NOT start your 3 goals with: ${avoid.verbPatterns.slice(-3).join(" or ")}`
    : "";
  return `Generate 1 TOEFL email prompt in category "${category.name}" as JSON:
{"scenario":"...","direction":"Write an email to [recipient]. In your email, do the following:","goals":["g1","g2","g3"],"to":"...","subject":"..."}

Category: ${category.name}
Example scenarios: ${category.examples}
Recommended tones (pick one): ${category.tones}

Scenario rules (RECALIBRATED 2026-07-10 to realExam2026, n=51: mean 39 words, 3-4 short sentences):
- 33–55 words. Target ~39 words, spread over 3–4 SHORT sentences (role → triggering
  event → concrete detail), not 2 long ones.
- REQUIRED opening (follow exactly, do not choose another form):
  Open the scenario with ${pickScenarioOpener().spec}
- NEVER open with "You signed up / You ordered / You joined" or a third-person setup
  ("A new policy was announced…") — those forms occur 0 times in the 51 real prompts.
- Include at least one specific detail (a time, event, policy, or object)

Goal rules (RECALIBRATED 2026-07-10 to realExam2026: 153 bullets — slot arc is
Describe/Explain → Explain the impact → act):
- Exactly 3 goals. Goal 1 starts with Describe or Explain (NEVER Ask). Goal 2
  explains the impact/situation further (Explain/Describe/Mention). Goal 3 is the
  action step — start it with: ${SLOT3_VERBS[Math.floor(Math.random() * SLOT3_VERBS.length)]}
- Verbs are usually all different; in about 1 prompt out of 10 two goals MAY share
  a verb (real exam does this — do not force artificial variety)
- NEVER use "Tell" as a goal verb (0 occurrences in the real exam)
- Avoid adjectives/adverbs in goals — try not to use: specific, concise, detailed, workable,
  reasonable, clear, thorough (real TPO uses these very rarely, ~3%)
- Do NOT specify a number (no "ask two questions", "give three examples")
- Each goal describes WHAT to communicate, not HOW to write${avoidVerbs}

Recipient rules (RECALIBRATED 2026-05-31 to realExam2026: ~82% Title+surname, ~18% first-name — NO other forms):
- "to" must be ONE of exactly these two forms:
  * Title + surname (≈82%): "Mr. Williams", "Ms. Clark", "Dr. Patel", "Professor Reed"
  * A friend's first name only (≈18%, only when the recipient is a peer/friend): "Kevin", "Maria", "Alex"
- NEVER use forms the real exam does not use: NO full "First Last" names ("Linda Chen"),
  NO bare org/role addressees ("Customer Service", "Parks and Recreation Department",
  "Building Manager", "Editor"). Address a named person, staff member, or friend.
- The recipient must make sense for the scenario (a gym question → the gym manager/Ms. X,
  not a city office).${avoidNames}
- "subject" must be a SHORT noun phrase of 2-5 words, like a real inbox line:
  "Resort Inquiry", "Damaged library book", "Gym membership question". NO full
  sentences, NO clauses, NO order/course numbers. (Real exam mean: 4.1 words;
  never 8+.)${avoidSubjects}
- Avoid only the most overused scenarios: "group project late submission", "restaurant complaint", "lost-and-found"`;
}
