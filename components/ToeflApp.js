"use client";
import React, { useState, useEffect, useRef } from "react";

const BS_DATA = [
  // Set 1 (9 questions)
  { id:"bs1", prompt:"What did you think of the city tour?", chunks:["The tour guides","who showed","us around","the old city","were","fantastic"], answer:"The tour guides who showed us around the old city were fantastic", gp:"relative clause" },
  { id:"bs2", prompt:"Did your mom ask about your college plans?", chunks:["She wanted","to know","which colleges","I'm","considering"], answer:"She wanted to know which colleges I'm considering", gp:"indirect question" },
  { id:"bs3", prompt:"Do you want me to send you a copy?", chunks:["Do you","want","me","to send","you","a copy"], answer:"Do you want me to send you a copy", gp:"complex object" },
  { id:"bs4", prompt:"Where did you leave the keys?", chunks:["I think","I left","them","on the table","in the kitchen"], answer:"I think I left them on the table in the kitchen", gp:"PP order" },
  { id:"bs5", prompt:"Can you ask the professor about the deadline?", chunks:["Could you","find out","when","the assignment","is due"], answer:"Could you find out when the assignment is due", gp:"indirect question (no inversion)" },
  { id:"bs6", prompt:"How was the guest lecture yesterday?", chunks:["The speaker","made","some really","interesting points","about","climate change"], answer:"The speaker made some really interesting points about climate change", gp:"adverb placement" },
  { id:"bs7", prompt:"Did the advisor help with course selection?", chunks:["She recommended","that I","take","statistics","before","enrolling in","the research methods class"], answer:"She recommended that I take statistics before enrolling in the research methods class", gp:"subjunctive + gerund" },
  { id:"bs8", prompt:"Why didn't you submit the paper on time?", chunks:["I didn't","realize","that","the deadline","had been","moved up","by a week"], answer:"I didn't realize that the deadline had been moved up by a week", gp:"past perfect passive" },
  { id:"bs9", prompt:"What happened at the student council meeting?", chunks:["They decided","to postpone","the vote","until","more students","could attend"], answer:"They decided to postpone the vote until more students could attend", gp:"infinitive + temporal" },
  // Set 2 (9 questions)
  { id:"bs10", prompt:"Why is the library so crowded today?", chunks:["The students","who have","final exams","next week","are all","studying there"], answer:"The students who have final exams next week are all studying there", gp:"relative clause" },
  { id:"bs11", prompt:"Did you find out about the scholarship?", chunks:["I was told","that the application","had already","been submitted","on my behalf"], answer:"I was told that the application had already been submitted on my behalf", gp:"past perfect passive" },
  { id:"bs12", prompt:"What did the doctor say?", chunks:["She suggested","that I","get","more sleep","and reduce","my caffeine intake"], answer:"She suggested that I get more sleep and reduce my caffeine intake", gp:"subjunctive + parallel structure" },
  { id:"bs13", prompt:"How do you like your new apartment?", chunks:["The only thing","I don't like","is that","the neighbors","are sometimes","too noisy","at night"], answer:"The only thing I don't like is that the neighbors are sometimes too noisy at night", gp:"noun clause + adverb placement" },
  { id:"bs14", prompt:"Did the teacher explain the homework?", chunks:["She asked us","to read","the article","and write","a summary","by Friday"], answer:"She asked us to read the article and write a summary by Friday", gp:"complex object + parallel infinitive" },
  { id:"bs15", prompt:"What are you doing this weekend?", chunks:["I'm planning","to visit","the museum","that just opened","near the campus"], answer:"I'm planning to visit the museum that just opened near the campus", gp:"infinitive + relative clause" },
  { id:"bs16", prompt:"Why did you change your major?", chunks:["I realized","that I","was more interested","in psychology","than","in engineering"], answer:"I realized that I was more interested in psychology than in engineering", gp:"comparative structure" },
  { id:"bs17", prompt:"How was the group project?", chunks:["Despite","having different opinions","we managed","to finish","the project","on time"], answer:"Despite having different opinions we managed to finish the project on time", gp:"concessive + gerund" },
  { id:"bs18", prompt:"What did the email from the registrar say?", chunks:["It stated","that all students","must register","for courses","before","the end of","the month"], answer:"It stated that all students must register for courses before the end of the month", gp:"noun clause + modal" },
  // Set 3 (9 questions)
  { id:"bs19", prompt:"Why didn't you go to the party?", chunks:["By the time","I finished","my assignment","the party","had already","ended"], answer:"By the time I finished my assignment the party had already ended", gp:"past perfect + temporal clause" },
  { id:"bs20", prompt:"What makes this university special?", chunks:["Not only","does it","have","excellent professors","but it also","offers","great research opportunities"], answer:"Not only does it have excellent professors but it also offers great research opportunities", gp:"inversion + correlative conjunction" },
  { id:"bs21", prompt:"Did you talk to the financial aid office?", chunks:["They informed me","that my scholarship","would be renewed","provided that","I maintain","a 3.5 GPA"], answer:"They informed me that my scholarship would be renewed provided that I maintain a 3.5 GPA", gp:"conditional + passive" },
  { id:"bs22", prompt:"How did the interview go?", chunks:["The interviewer","asked me","what skills","I could bring","to the company"], answer:"The interviewer asked me what skills I could bring to the company", gp:"embedded question" },
  { id:"bs23", prompt:"What happened to the study abroad program?", chunks:["Had the university","received","enough funding","the program","would not","have been","canceled"], answer:"Had the university received enough funding the program would not have been canceled", gp:"inverted conditional (3rd)" },
  { id:"bs24", prompt:"Why do you prefer online classes?", chunks:["What I appreciate","most about","online learning","is the flexibility","it provides","for working students"], answer:"What I appreciate most about online learning is the flexibility it provides for working students", gp:"cleft sentence" },
  { id:"bs25", prompt:"Did you enjoy the conference?", chunks:["The keynote speaker","whose research","focuses on","artificial intelligence","gave","a fascinating","presentation"], answer:"The keynote speaker whose research focuses on artificial intelligence gave a fascinating presentation", gp:"non-restrictive relative clause" },
  { id:"bs26", prompt:"What did your roommate complain about?", chunks:["She said","that if","the heating","were fixed","she would not","have to","wear a coat","indoors"], answer:"She said that if the heating were fixed she would not have to wear a coat indoors", gp:"reported speech + subjunctive" },
  { id:"bs27", prompt:"How is the new cafeteria?", chunks:["Compared to","the old one","the new cafeteria","has","a much wider","selection of","healthy options"], answer:"Compared to the old one the new cafeteria has a much wider selection of healthy options", gp:"participial phrase + comparison" },
];

const EM_DATA = [
  { id:"em1", scenario:"You are a student in Professor Kim's sociology class. Last week, you submitted your midterm essay via the class website. Yesterday, you checked your grade and were surprised to see it was much lower than you expected. When you opened the file that was graded, you realized it was an older draft, not the final version.", direction:"Write an email to Professor Kim:", goals:["Explain the situation with your midterm essay submission","Ask if you can resubmit the correct version","Describe how this grade would affect your overall performance"], to:"Professor Kim", from:"You (Sociology 201)" },
  { id:"em2", scenario:"You recently saw a poster on campus for an international cultural exchange program. The program allows students to host visiting scholars and attend lectures by international faculty. You are interested but have questions.", direction:"Write an email to the International Programs Office:", goals:["Express your interest in the program","Ask specific questions about logistics","Suggest an idea for a cultural activity"], to:"International Programs Office", from:"You (student)" },
  { id:"em3", scenario:"You subscribe to a poetry magazine called Verse & Voice. You tried to submit a poem through their online form last week, but the form gave an error after you clicked Submit. You are not sure if your poem was received.", direction:"Write an email to the editor:", goals:["Tell the editor what you like about the magazine","Describe the technical problem","Ask about the status of your submission"], to:"Editor, Verse & Voice", from:"You (subscriber)" },
  { id:"em4", scenario:"You are a junior who recently completed an internship at a local environmental nonprofit. Your supervisor, Ms. Rivera, mentioned that the organization might offer a part-time position in the fall. You are very interested and want to follow up.", direction:"Write an email to Ms. Rivera:", goals:["Thank her for the internship experience and mention something specific you learned","Ask about the part-time position and your eligibility","Explain how the role fits your academic and career goals"], to:"Ms. Rivera, GreenFuture Nonprofit", from:"You (former intern)" },
  { id:"em5", scenario:"Your university library recently changed its weekend hours, closing two hours earlier than before. As a student who works during the week, weekends are your main study time. You and several classmates are concerned.", direction:"Write an email to the Library Director:", goals:["Explain why the old weekend hours were important to you","Describe the impact of the change on your studies","Propose a compromise or alternative solution"], to:"Library Director", from:"You (undergraduate student)" },
  { id:"em6", scenario:"You enrolled in a biology lab section that meets on Tuesdays and Thursdays. However, you just received your updated work schedule and now have a conflict on Thursdays. Another lab section is available on Wednesdays but is currently full.", direction:"Write an email to the Biology Department:", goals:["Explain the scheduling conflict you are facing","Request to be added to the Wednesday lab section","Describe the consequences if you cannot resolve this issue"], to:"Biology Department", from:"You (Biology 110)" },
  { id:"em7", scenario:"Your dormitory has been experiencing frequent Wi-Fi outages over the past two weeks. You have an important online exam coming up next Monday and are worried about connectivity. Other residents on your floor have the same complaint.", direction:"Write an email to the Campus IT Help Desk:", goals:["Describe the Wi-Fi problems you have been experiencing","Explain why reliable internet is urgent for you right now","Ask what steps are being taken and suggest a temporary solution"], to:"IT Help Desk", from:"You (Residence Hall student)" },
  { id:"em8", scenario:"You attended a guest lecture on campus last week by Dr. Thompson, a well-known marine biologist. The lecture inspired you and you are now considering changing your research topic for your senior thesis. You would like to contact Dr. Thompson for guidance.", direction:"Write an email to Dr. Thompson:", goals:["Express your appreciation for the lecture and mention a specific point that resonated with you","Explain how the lecture connects to your academic interests","Ask if Dr. Thompson would be willing to provide brief advice or recommend resources"], to:"Dr. Thompson", from:"You (senior, Environmental Science)" },
];

const AD_DATA = [
  { id:"ad1", professor:{ name:"Dr. Gupta", text:"This week we examine urban development. Some cities create car-free zones downtown to reduce pollution and encourage walking. Critics say this hurts businesses and limits access for people with mobility challenges. State whether you support or oppose car-free zones and explain why." }, students:[{ name:"Yuki", text:"I support car-free zones because they create a healthier environment. In my hometown in Japan, a shopping street closed to traffic became very popular. Shops reported higher sales because foot traffic increased." },{ name:"Carlos", text:"I think a complete ban is too extreme. Many people depend on cars. Cities should invest in public transit and bike lanes while allowing limited car access." }] },
  { id:"ad2", professor:{ name:"Dr. Chen", text:"Some universities require all students to take at least one computer science course, regardless of major. Supporters say coding is fundamental; opponents say it takes time from primary studies. What is your position?" }, students:[{ name:"Aisha", text:"I believe a programming requirement makes sense. Even journalism and biology rely on data analysis. Basic coding helps graduates be competitive." },{ name:"Marco", text:"I disagree with making it mandatory. Students already have heavy course loads. Forcing a music student to take programming causes unnecessary stress." }] },
  { id:"ad3", professor:{ name:"Dr. Patel", text:"Many universities now allow students to take most of their courses online. Some argue that online learning offers flexibility and accessibility, while others claim that in-person classes provide a richer educational experience. What do you think is the better approach for university education?" }, students:[{ name:"Lena", text:"Online learning is the future. I took several courses online and was able to work part-time simultaneously. The recorded lectures let me review material at my own pace." },{ name:"James", text:"I strongly prefer in-person classes. The discussions and group activities just don't work the same way over video. You also miss out on networking with classmates." }] },
  { id:"ad4", professor:{ name:"Dr. Williams", text:"Social media platforms have become a primary news source for many young people. Some experts say this democratizes information, while others warn about misinformation and echo chambers. Should universities teach media literacy as a required course? Share your opinion." }, students:[{ name:"Sofia", text:"Absolutely. I've seen so many of my friends share news articles without checking if they're true. A media literacy course would help students think critically about what they read online." },{ name:"Ryan", text:"I don't think it needs to be a separate required course. Critical thinking should be taught across all subjects. Adding another requirement just adds to students' workloads." }] },
  { id:"ad5", professor:{ name:"Dr. Nakamura", text:"Some companies have adopted a four-day work week, claiming it increases productivity and employee well-being. Others argue that reducing work hours leads to missed deadlines and lost revenue. Do you think the four-day work week is a good idea? Why or why not?" }, students:[{ name:"Emma", text:"I think a four-day work week is great for mental health. Studies show that well-rested employees make fewer mistakes. Companies in Iceland and Japan have seen positive results." },{ name:"David", text:"It depends on the industry. For office jobs it might work, but hospitals, restaurants, and service industries can't just close an extra day. It's not a one-size-fits-all solution." }] },
  { id:"ad6", professor:{ name:"Dr. Okafor", text:"Zoos have long been debated. Supporters argue they play a crucial role in conservation and education. Critics say keeping animals in enclosures is unethical, regardless of the purpose. Should modern zoos continue to exist? Take a position and explain your reasoning." }, students:[{ name:"Priya", text:"I believe well-managed zoos are essential for conservation. Many species would be extinct without captive breeding programs. Zoos also educate children about wildlife." },{ name:"Tom", text:"Even the best zoos can't replicate natural habitats. Animals in captivity show signs of stress and abnormal behavior. We should fund wildlife reserves instead." }] },
  { id:"ad7", professor:{ name:"Dr. Kim", text:"Some educators argue that students should be graded purely on exams, while others believe that participation, attendance, and group projects should also count toward the final grade. What grading approach do you think is most fair and effective?" }, students:[{ name:"Mei", text:"I think a mix is best. Exams test knowledge, but participation shows engagement. My best learning happened during group discussions, not just studying for tests." },{ name:"Alex", text:"Exams are the most objective measure. Participation grades are subjective—quiet students get penalized even if they understand the material. Grading should be based on demonstrated knowledge." }] },
  { id:"ad8", professor:{ name:"Dr. Santos", text:"With the rise of AI tools like ChatGPT, some professors have banned their use entirely in coursework, while others encourage students to use AI as a learning aid. What is your position on the use of AI tools in academic work?" }, students:[{ name:"Hannah", text:"AI tools should be allowed as long as students cite them. They help with brainstorming and understanding difficult concepts. Banning them entirely is unrealistic since they're everywhere." },{ name:"Kevin", text:"Using AI for assignments defeats the purpose of learning. If a student uses ChatGPT to write an essay, they haven't actually practiced writing. Schools should ban AI tools for graded work." }] },
];

function fmt(s) { return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
function wc(t) { return t.trim() ? t.trim().split(/\s+/).length : 0; }
function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

function loadHist() { try { return JSON.parse(localStorage.getItem("toefl-hist") || '{"sessions":[]}'); } catch { return { sessions: [] }; } }
function saveSess(s) { try { const h = loadHist(); h.sessions.push({ ...s, date: new Date().toISOString() }); if (h.sessions.length > 50) h.sessions = h.sessions.slice(-50); localStorage.setItem("toefl-hist", JSON.stringify(h)); } catch (e) { console.error(e); } }

async function callAI(system, message, maxTokens) {
  const r = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, message, maxTokens: maxTokens || 1200 }),
  });
  if (!r.ok) throw new Error("API error " + r.status);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.content;
}

const EMAIL_SYS = "You are a STRICT ETS TOEFL iBT 2026 Writing scorer. Score the email 0-5 with ZERO inflation. RUBRIC: 5(RARE)=CONSISTENT facility,PRECISE/IDIOMATIC,almost NO errors. 4=MOSTLY effective,ADEQUATE,FEW errors. 3=GENERALLY accomplishes but NOTICEABLE errors. 2=MOSTLY UNSUCCESSFUL. 1=UNSUCCESSFUL. Most score 3-4. BAND: 5=5.0-6.0,4=4.0-4.5,3=3.0-3.5,2=2.0-2.5,1=1.0-1.5. Find ALL weaknesses first. IMPORTANT: Write summary, weaknesses, strengths, grammar_issues, vocabulary_note, next_steps ALL in Chinese (简体中文). The sample model response should remain in English. Return ONLY JSON: {\"score\":0,\"band\":0.0,\"goals_met\":[false,false,false],\"summary\":\"中文总结...\",\"weaknesses\":[\"中文弱点...\"],\"strengths\":[\"中文优点...\"],\"grammar_issues\":[\"中文语法问题...\"],\"vocabulary_note\":\"中文词汇点评...\",\"next_steps\":[\"中文改进建议...\"],\"sample\":\"English model response\"}";

const DISC_SYS = "You are a STRICT ETS TOEFL iBT 2026 Writing scorer. Score the discussion post 0-5 with ZERO inflation. RUBRIC: 5(RARE)=VERY CLEAR,WELL-ELABORATED,PRECISE/IDIOMATIC. 4=RELEVANT,ADEQUATELY elaborated,FEW errors. 3=MOSTLY relevant,NOTICEABLE errors. 2=MOSTLY UNSUCCESSFUL. 1=UNSUCCESSFUL. Most score 3-4. BAND: 5=5.0-6.0,4=4.0-4.5,3=3.0-3.5,2=2.0-2.5,1=1.0-1.5. Find ALL weaknesses first. IMPORTANT: Write summary, weaknesses, strengths, grammar_issues, vocabulary_note, argument_quality, next_steps ALL in Chinese (简体中文). The sample model response should remain in English. Return ONLY JSON: {\"score\":0,\"band\":0.0,\"engages_professor\":false,\"engages_students\":false,\"summary\":\"中文总结...\",\"weaknesses\":[\"中文弱点...\"],\"strengths\":[\"中文优点...\"],\"grammar_issues\":[\"中文语法问题...\"],\"vocabulary_note\":\"中文词汇点评...\",\"argument_quality\":\"中文论证质量评价...\",\"next_steps\":[\"中文改进建议...\"],\"sample\":\"English model response\"}";

async function aiEval(type, pd, text) {
  const sys = type === "email" ? EMAIL_SYS : DISC_SYS;
  const up = type === "email"
    ? "Scenario: " + pd.scenario + "\nGoals:\n" + pd.goals.map((g, i) => (i + 1) + ". " + g).join("\n") + "\n\nStudent email:\n" + text
    : "Prof " + pd.professor.name + ": " + pd.professor.text + "\n\n" + pd.students.map(s => s.name + ": " + s.text).join("\n\n") + "\n\nStudent response:\n" + text;
  try {
    const raw = await callAI(sys, up, 1200);
    return JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());
  } catch (e) { console.error(e); return null; }
}

async function aiGen(type) {
  const prompts = {
    buildSentence: 'Generate 9 TOEFL 2026 Build a Sentence items as JSON array: [{"prompt":"context","chunks":["word","chunks"],"answer":"correct sentence","gp":"grammar point"}]',
    email: 'Generate 1 TOEFL 2026 email prompt as JSON: {"scenario":"...","direction":"Write an email:","goals":["g1","g2","g3"],"to":"...","from":"You"}',
    discussion: 'Generate 1 TOEFL 2026 discussion prompt as JSON: {"professor":{"name":"Dr. X","text":"..."},"students":[{"name":"A","text":"..."},{"name":"B","text":"..."}]}'
  };
  try {
    const raw = await callAI("Generate TOEFL 2026 questions. Output ONLY valid JSON.", prompts[type], 1500);
    return JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());
  } catch (e) { console.error(e); return null; }
}

const C = { nav: "#003366", navDk: "#002244", bg: "#f0f0f0", bdr: "#ccc", t1: "#333", t2: "#666", blue: "#0066cc", green: "#28a745", orange: "#ff8c00", red: "#dc3545", ltB: "#e8f0fe" };
const FONT = "'Segoe UI','Helvetica Neue',Arial,sans-serif";

function Btn({ children, onClick, disabled, variant }) {
  const colors = { primary: { bg: C.blue, c: "#fff" }, secondary: { bg: "#fff", c: C.blue }, success: { bg: C.green, c: "#fff" } };
  const s = colors[variant || "primary"] || colors.primary;
  return <button onClick={onClick} disabled={disabled} style={{ background: disabled ? "#ccc" : s.bg, color: disabled ? "#888" : s.c, border: "1px solid " + (disabled ? "#ccc" : s.bg), padding: "8px 24px", borderRadius: 4, fontSize: 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", fontFamily: FONT }}>{children}</button>;
}

function TopBar({ title, section, timeLeft, isRunning, qInfo, onExit }) {
  return (
    <div style={{ background: C.nav, color: "#fff", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 48, fontFamily: FONT, fontSize: 14, borderBottom: "3px solid " + C.navDk, position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}><span style={{ fontWeight: 700, fontSize: 15 }}>TOEFL iBT®</span><span style={{ opacity: 0.5 }}>|</span><span style={{ fontSize: 13 }}>{section}</span></div>
      <div style={{ fontSize: 13, opacity: 0.9 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {qInfo && <span style={{ fontSize: 12, opacity: 0.8 }}>{qInfo}</span>}
        {timeLeft !== undefined && <div style={{ background: timeLeft <= 60 ? "rgba(220,53,69,0.6)" : "rgba(255,255,255,0.13)", padding: "4px 12px", borderRadius: 4, fontFamily: "Consolas,monospace", fontSize: 16, fontWeight: 700 }}>{fmt(timeLeft)}</div>}
        <button onClick={onExit} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontFamily: FONT }}>Exit</button>
      </div>
    </div>
  );
}

function ScorePanel({ result, type }) {
  if (!result) return null;
  const sc = result.score >= 4 ? C.green : result.score >= 3 ? C.orange : C.red;
  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ background: C.nav, color: "#fff", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>ETS RUBRIC SCORE</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 36, fontWeight: 800 }}>{result.score}</span>
            <span style={{ fontSize: 16, opacity: 0.7 }}>/ 5</span>
            <span style={{ background: sc, padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600, marginLeft: 8 }}>Band {result.band}</span>
          </div>
        </div>
      </div>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ color: C.t1, fontSize: 14, lineHeight: 1.6, margin: 0 }}>{result.summary}</p>
        {type === "email" && result.goals_met && (
          <div style={{ background: C.ltB, borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>COMMUNICATIVE GOALS</div>
            {result.goals_met.map((m, i) => <div key={i} style={{ fontSize: 13, marginBottom: 3 }}><span style={{ color: m ? C.green : C.red, fontWeight: 700, marginRight: 6 }}>{m ? "✓" : "✗"}</span>Goal {i + 1}</div>)}
          </div>
        )}
        {type === "discussion" && (
          <div style={{ background: C.ltB, borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>ENGAGEMENT</div>
            <div style={{ fontSize: 13, marginBottom: 3 }}><span style={{ color: result.engages_professor ? C.green : C.red, fontWeight: 700, marginRight: 6 }}>{result.engages_professor ? "✓" : "✗"}</span>Professor</div>
            <div style={{ fontSize: 13 }}><span style={{ color: result.engages_students ? C.green : C.red, fontWeight: 700, marginRight: 6 }}>{result.engages_students ? "✓" : "✗"}</span>Peers</div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: "#f0fff4", border: "1px solid #c6f6d5", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 6 }}>STRENGTHS</div>
            {(result.strengths || []).map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>+ {s}</div>)}
          </div>
          <div style={{ background: "#fff5f5", border: "1px solid #fed7d7", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.red, marginBottom: 6 }}>WEAKNESSES</div>
            {(result.weaknesses || []).map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>→ {s}</div>)}
          </div>
        </div>
        {result.grammar_issues && result.grammar_issues.length > 0 && (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#b45309", marginBottom: 6 }}>LANGUAGE DIAGNOSTIC</div>
            {result.grammar_issues.map((g, i) => <div key={i} style={{ fontSize: 13, marginBottom: 3 }}>• {g}</div>)}
            {result.vocabulary_note && <div style={{ fontSize: 13, marginTop: 6 }}><b>Vocabulary:</b> {result.vocabulary_note}</div>}
            {result.argument_quality && <div style={{ fontSize: 13, marginTop: 4 }}><b>Argument:</b> {result.argument_quality}</div>}
          </div>
        )}
        {result.next_steps && result.next_steps.length > 0 && (
          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>WHAT TO DO NEXT</div>
            {result.next_steps.map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4 }}><b style={{ color: C.blue }}>{i + 1}.</b> {s}</div>)}
          </div>
        )}
        {result.sample && (
          <div style={{ background: "#f8f9fa", border: "1px solid " + C.bdr, borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, marginBottom: 6 }}>MODEL RESPONSE (Score 5)</div>
            <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0, fontStyle: "italic" }}>{result.sample}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function getRandomSet() {
  const sets = [BS_DATA.slice(0, 9), BS_DATA.slice(9, 18), BS_DATA.slice(18, 27)];
  return sets[Math.floor(Math.random() * sets.length)];
}

function BuildSentenceTask({ onExit }) {
  const [qs, setQs] = useState(() => getRandomSet());
  const [idx, setIdx] = useState(0);
  const [slots, setSlots] = useState([]);
  const [bank, setBank] = useState([]);
  const [results, setResults] = useState([]);
  const [phase, setPhase] = useState("instruction");
  const [tl, setTl] = useState(360);
  const [run, setRun] = useState(false);
  const [gen, setGen] = useState(false);
  const tr = useRef(null);

  const autoSubmitRef = useRef(false);
  const resultsRef = useRef([]);
  const idxRef = useRef(0);
  const slotsRef = useRef([]);

  function startTimer() {
    setPhase("active");
    setRun(true);
    initQ(0, qs);
    tr.current = setInterval(() => setTl(p => {
      if (p <= 1) {
        clearInterval(tr.current);
        setRun(false);
        autoSubmitRef.current = true;
        return 0;
      }
      return p - 1;
    }), 1000);
  }

  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { idxRef.current = idx; }, [idx]);
  useEffect(() => { slotsRef.current = slots; }, [slots]);

  useEffect(() => {
    if (tl === 0 && autoSubmitRef.current && phase === "active") {
      autoSubmitRef.current = false;
      // Submit current answer and all remaining as empty
      const curAnswer = slotsRef.current.map(x => x.text).join(" ");
      const curQ = qs[idxRef.current];
      const curOk = curAnswer.toLowerCase().replace(/[.,!?]/g, "").trim() === curQ.answer.toLowerCase().replace(/[.,!?]/g, "").trim();
      let nr = [...resultsRef.current, { q: curQ, userAnswer: curAnswer || "(no answer)", isCorrect: curOk }];
      for (let i = idxRef.current + 1; i < qs.length; i++) {
        nr.push({ q: qs[i], userAnswer: "(no answer)", isCorrect: false });
      }
      setResults(nr);
      setPhase("review");
      saveSess({ type: "bs", correct: nr.filter(r => r.isCorrect).length, total: nr.length, errors: nr.filter(r => !r.isCorrect).map(r => r.q.gp) });
    }
  }, [tl, phase, qs]);

  useEffect(() => () => clearInterval(tr.current), []);

  function initQ(i, q) { setBank(shuffle(q[i].chunks.map((c, j) => ({ text: c, id: i + "-" + j })))); setSlots([]); }
  function pick(it) { setSlots(p => [...p, it]); setBank(p => p.filter(x => x.id !== it.id)); }
  function rm(i) { const item = slots[i]; setBank(p => [...p, item]); setSlots(p => p.filter((_, j) => j !== i)); }

  function submit() {
    const ua = slots.map(x => x.text).join(" ");
    const q = qs[idx];
    const ok = ua.toLowerCase().replace(/[.,!?]/g, "").trim() === q.answer.toLowerCase().replace(/[.,!?]/g, "").trim();
    const nr = [...results, { q, userAnswer: ua, isCorrect: ok }];
    setResults(nr);
    if (idx < qs.length - 1) { setIdx(idx + 1); initQ(idx + 1, qs); }
    else { clearInterval(tr.current); setRun(false); setPhase("review"); saveSess({ type: "bs", correct: nr.filter(r => r.isCorrect).length, total: nr.length, errors: nr.filter(r => !r.isCorrect).map(r => r.q.gp) }); }
  }

  async function genNew() {
    setGen(true);
    const d = await aiGen("buildSentence");
    if (d && Array.isArray(d)) {
      const m = d.map((x, i) => ({ id: "g" + i, ...x }));
      setQs(m); setIdx(0); setResults([]); setPhase("active"); setTl(360); setRun(true); initQ(0, m);
      tr.current = setInterval(() => setTl(p => { if (p <= 1) { clearInterval(tr.current); setRun(false); return 0; } return p - 1; }), 1000);
    }
    setGen(false);
  }

  if (phase === "review") {
    const ok = results.filter(r => r.isCorrect).length;
    const ge = {};
    results.filter(r => !r.isCorrect).forEach(r => { const g = r.q.gp || "general"; ge[g] = (ge[g] || 0) + 1; });
    const te = Object.entries(ge).sort((a, b) => b[1] - a[1]);

    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <TopBar title="Build a Sentence — Report" section="Writing" onExit={onExit} />
        <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
          <div style={{ background: C.nav, color: "#fff", borderRadius: 6, padding: 24, textAlign: "center", marginBottom: 20 }}><div style={{ fontSize: 48, fontWeight: 800 }}>{ok}/{results.length}</div><div style={{ fontSize: 14, opacity: 0.7 }}>Correct</div></div>
          {te.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 12 }}>GRAMMAR PATTERNS MISSED</div>
              {te.map(([g, n], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < te.length - 1 ? "1px solid #eee" : "none" }}><span>{g}</span><span style={{ background: "#fee2e2", color: C.red, padding: "2px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{n}x</span></div>)}
              <div style={{ marginTop: 12, fontSize: 13, color: C.blue, background: C.ltB, padding: 10, borderRadius: 4 }}><b>Next step:</b> Focus on {te.map(e => e[0]).join(" and ")}.</div>
            </div>
          )}
          {results.map((r, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid " + (r.isCorrect ? "#c6f6d5" : "#fed7d7"), borderLeft: "4px solid " + (r.isCorrect ? C.green : C.red), borderRadius: 4, padding: 14, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>Q{i + 1}: {r.q.prompt} <span style={{ color: C.blue }}>({r.q.gp})</span></div>
              <div style={{ fontSize: 14, color: r.isCorrect ? C.green : C.red }}>{r.isCorrect ? "✓" : "✗"} {r.userAnswer}</div>
              {!r.isCorrect && <div style={{ fontSize: 13, color: C.blue, marginTop: 4 }}>Correct: {r.q.answer}</div>}
            </div>
          ))}
          <div style={{ display: "flex", gap: 12, marginTop: 20 }}><Btn onClick={onExit} variant="secondary">Menu</Btn><Btn onClick={genNew} disabled={gen}>{gen ? "Generating..." : "AI New Questions"}</Btn></div>
        </div>
      </div>
    );
  }

  if (phase === "instruction") {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <TopBar title="Build a Sentence" section="Writing · Task 1" onExit={onExit} />
        <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "32px 40px" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 20, color: C.nav }}>Task 1: Build a Sentence</h2>
            <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.8 }}>
              <p><b>Directions:</b> In this task, you will see a prompt and a set of word chunks. Click the chunks in the correct order to form a grammatically correct sentence.</p>
              <p><b>Questions:</b> 9</p>
              <p><b>Time limit:</b> 6 minutes</p>
              <p>The timer will start when you click <b>Start</b>. When time runs out, your answers will be submitted automatically.</p>
            </div>
            <div style={{ marginTop: 24, textAlign: "center" }}><Btn onClick={startTimer}>Start</Btn></div>
          </div>
        </div>
      </div>
    );
  }

  const q = qs[idx];
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title="Build a Sentence" section="Writing · Task 1" timeLeft={tl} isRunning={run} qInfo={(idx + 1) + " / " + qs.length} onExit={onExit} />
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
        <div style={{ background: C.ltB, border: "1px solid #b3d4fc", borderRadius: 4, padding: 14, marginBottom: 20, fontSize: 13 }}><b>Directions:</b> Click word chunks in order to form a response.</div>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 20, marginBottom: 20 }}><div style={{ fontSize: 11, color: C.t2, letterSpacing: 1, marginBottom: 8 }}>PROMPT</div><div style={{ fontSize: 16, color: C.t1 }}>{q.prompt}</div></div>
        <div style={{ background: "#fff", border: "2px solid " + (slots.length ? C.blue : C.bdr), borderRadius: 4, padding: 16, minHeight: 56, marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {slots.length === 0 && <span style={{ color: "#999", fontSize: 13, fontStyle: "italic" }}>Your sentence appears here...</span>}
          {slots.map((it, i) => <div key={it.id} onClick={() => rm(i)} style={{ cursor: "pointer" }}><div style={{ background: C.blue, color: "#fff", borderRadius: 4, padding: "6px 14px", fontSize: 14, fontWeight: 500 }}>{it.text}</div></div>)}
        </div>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 16, display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {bank.map(it => <button key={it.id} onClick={() => pick(it)} style={{ background: "#f8f9fa", color: C.t1, border: "1px solid " + C.bdr, borderRadius: 4, padding: "6px 14px", fontSize: 14, cursor: "pointer", fontFamily: FONT }}>{it.text}</button>)}
        </div>
        <div style={{ display: "flex", gap: 12 }}><Btn onClick={() => initQ(idx, qs)} variant="secondary">Reset</Btn><Btn onClick={submit} disabled={slots.length === 0}>{idx < qs.length - 1 ? "Next →" : "Submit All"}</Btn></div>
      </div>
    </div>
  );
}

function WritingTask({ onExit, type }) {
  const data = type === "email" ? EM_DATA : AD_DATA;
  const limit = type === "email" ? 420 : 600;
  const minW = type === "email" ? 80 : 100;

  const [pi, setPi] = useState(0);
  const [pd, setPd] = useState(data[0]);
  const [text, setText] = useState("");
  const [tl, setTl] = useState(limit);
  const [run, setRun] = useState(false);
  const [phase, setPhase] = useState("ready");
  const [fb, setFb] = useState(null);
  const [gen, setGen] = useState(false);
  const tr = useRef(null);

  const submitRef = useRef(null);
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  function start() { setPhase("writing"); setRun(true); tr.current = setInterval(() => setTl(p => { if (p <= 1) { clearInterval(tr.current); setRun(false); return 0; } return p - 1; }), 1000); }

  async function submitScore() { clearInterval(tr.current); setRun(false); setPhase("scoring"); const r = await aiEval(type, pd, text); setFb(r); setPhase("done"); if (r) saveSess({ type, score: r.score, band: r.band, wordCount: wc(text), weaknesses: r.weaknesses, next_steps: r.next_steps }); }
  submitRef.current = submitScore;

  // Auto-submit when time runs out
  useEffect(() => {
    if (tl === 0 && phaseRef.current === "writing") {
      submitRef.current();
    }
  }, [tl]);

  // Ctrl+Enter shortcut
  useEffect(() => {
    function handleKey(e) {
      if (e.ctrlKey && e.key === "Enter" && phaseRef.current === "writing") {
        e.preventDefault();
        submitRef.current();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function next() { clearInterval(tr.current); const n = (pi + 1) % data.length; setPi(n); setPd(data[n]); setText(""); setTl(limit); setRun(false); setPhase("ready"); setFb(null); }
  async function genNew() { setGen(true); const d = await aiGen(type); if (d) { setPd({ id: "gen", ...d }); setText(""); setTl(limit); setRun(false); setPhase("ready"); setFb(null); } setGen(false); }
  useEffect(() => () => clearInterval(tr.current), []);

  const w = wc(text);
  const taskTitle = type === "email" ? "Write an Email" : "Academic Discussion";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title={taskTitle} section={"Writing · " + (type === "email" ? "Task 2" : "Task 3")} timeLeft={phase !== "ready" ? tl : undefined} isRunning={run} onExit={onExit} />
      <div style={{ maxWidth: 860, margin: "24px auto", padding: "0 20px" }}>
        <div style={{ background: C.ltB, border: "1px solid #b3d4fc", borderRadius: 4, padding: 14, marginBottom: 20, fontSize: 13 }}><b>Directions:</b> {type === "email" ? "Write an email addressing all 3 goals. 7 min. 80-120 words." : "Read the discussion and write a response. 10 min. 100+ words."}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ background: "#e8e8e8", padding: "10px 16px", fontSize: 12, fontWeight: 700, color: C.t2, borderBottom: "1px solid " + C.bdr }}>{type === "email" ? "SCENARIO" : "DISCUSSION BOARD"}</div>
            {type === "email" ? (
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: 12, color: C.t2, marginBottom: 6 }}><b>To:</b> {pd.to} | <b>From:</b> {pd.from}</div>
                <p style={{ fontSize: 14, color: C.t1, lineHeight: 1.7, margin: "12px 0" }}>{pd.scenario}</p>
                <div style={{ borderTop: "1px solid " + C.bdr, paddingTop: 12, marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{pd.direction}</div>
                  {pd.goals.map((g, i) => <div key={i} style={{ fontSize: 13, paddingLeft: 16, marginBottom: 4 }}>{i + 1}. {g}</div>)}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid " + C.bdr }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}><div style={{ width: 32, height: 32, borderRadius: "50%", background: C.nav, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{pd.professor.name.split(" ").pop()[0]}</div><div><div style={{ fontSize: 13, fontWeight: 700 }}>{pd.professor.name}</div><div style={{ fontSize: 11, color: C.t2 }}>Professor</div></div></div>
                  <p style={{ fontSize: 13, color: C.t1, lineHeight: 1.6, margin: 0 }}>{pd.professor.text}</p>
                </div>
                {pd.students.map((s, i) => (
                  <div key={i} style={{ padding: "14px 20px 14px 40px", borderBottom: i < pd.students.length - 1 ? "1px solid " + C.bdr : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><div style={{ width: 28, height: 28, borderRadius: "50%", background: i ? "#e8913a" : "#4a90d9", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{s.name[0]}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div></div>
                    <p style={{ fontSize: 13, color: C.t1, lineHeight: 1.6, margin: 0 }}>{s.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {phase === "ready" ? (
              <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}><div style={{ fontSize: 14, color: C.t2 }}>Timer starts when you click.</div><Btn onClick={start}>Begin Writing</Btn></div>
            ) : (
              <>
                <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, overflow: "hidden", flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={{ background: "#e8e8e8", padding: "10px 16px", fontSize: 12, fontWeight: 700, color: C.t2, borderBottom: "1px solid " + C.bdr, display: "flex", justifyContent: "space-between" }}><span>YOUR RESPONSE</span><span style={{ color: w < minW ? C.orange : C.green }}>{w} words {w < minW ? "(" + (minW - w) + " more)" : "✓"}</span></div>
                  <textarea value={text} onChange={e => setText(e.target.value)} disabled={phase === "scoring" || phase === "done"} placeholder={type === "email" ? "Dear " + pd.to + ",\n\nI am writing to..." : "I think this is an interesting question..."} style={{ flex: 1, minHeight: type === "email" ? 280 : 320, border: "none", padding: 16, fontSize: 14, fontFamily: FONT, lineHeight: 1.7, color: C.t1, resize: "none", outline: "none", background: phase === "done" ? "#fafafa" : "#fff" }} />
                </div>
                {phase === "writing" && <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Btn onClick={submitScore} disabled={w < 10} variant="success">Submit for Scoring</Btn><span style={{ fontSize: 11, color: C.t2 }}>Ctrl+Enter</span></div>}
              </>
            )}
            {phase === "scoring" && <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 4, padding: 32, textAlign: "center", color: C.t2 }}>AI evaluating...</div>}
          </div>
        </div>
        {phase === "done" && fb && (
          <div style={{ marginTop: 20 }}><ScorePanel result={fb} type={type} /><div style={{ display: "flex", gap: 12, marginTop: 16 }}><Btn onClick={next} variant="secondary">Next</Btn><Btn onClick={genNew} disabled={gen}>{gen ? "Generating..." : "AI New Prompt"}</Btn><Btn onClick={onExit} variant="secondary">Menu</Btn></div></div>
        )}
      </div>
    </div>
  );
}

function ProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  useEffect(() => { setHist(loadHist()); }, []);
  if (!hist) return <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center" }}>Loading...</div>;
  const ss = hist.sessions || [];
  const em = ss.filter(s => s.type === "email");
  const di = ss.filter(s => s.type === "discussion");
  const bs = ss.filter(s => s.type === "bs");

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title="Practice History" section="Progress" onExit={onBack} />
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 20px" }}>
        {ss.length === 0 ? <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 40, textAlign: "center" }}>No sessions yet.</div> : (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
              {[
                { l: "Build", n: bs.length, s: bs.length ? Math.round(bs.reduce((a, s) => a + s.correct / s.total * 100, 0) / bs.length) + "%" : "—" },
                { l: "Email", n: em.length, s: em.length ? (em.reduce((a, s) => a + s.score, 0) / em.length).toFixed(1) + "/5" : "—" },
                { l: "Discussion", n: di.length, s: di.length ? (di.reduce((a, s) => a + s.score, 0) / di.length).toFixed(1) + "/5" : "—" }
              ].map((c, i) => <div key={i} style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 16, textAlign: "center" }}><div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>{c.l}</div><div style={{ fontSize: 24, fontWeight: 700, color: C.nav }}>{c.n}</div><div style={{ fontSize: 12, color: C.t2 }}>{c.s}</div></div>)}
            </div>
            <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.nav, marginBottom: 12 }}>RECENT</div>
              {ss.slice(-10).reverse().map((s, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < Math.min(ss.length, 10) - 1 ? "1px solid #eee" : "none" }}>
                  <div><span style={{ fontSize: 13, fontWeight: 600 }}>{s.type === "bs" ? "Build" : s.type === "email" ? "Email" : "Discussion"}</span><span style={{ fontSize: 11, color: C.t2, marginLeft: 8 }}>{new Date(s.date).toLocaleDateString()}</span></div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: s.type === "bs" ? (s.correct / s.total >= 0.8 ? C.green : C.orange) : (s.score >= 4 ? C.green : s.score >= 3 ? C.orange : C.red) }}>{s.type === "bs" ? s.correct + "/" + s.total : s.score + "/5"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ marginTop: 20 }}><Btn onClick={onBack} variant="secondary">Menu</Btn></div>
      </div>
    </div>
  );
}

export default function ToeflApp() {
  const [v, setV] = useState("menu");

  if (v === "build") return <BuildSentenceTask onExit={() => setV("menu")} />;
  if (v === "email") return <WritingTask onExit={() => setV("menu")} type="email" />;
  if (v === "disc") return <WritingTask onExit={() => setV("menu")} type="discussion" />;
  if (v === "prog") return <ProgressView onBack={() => setV("menu")} />;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <div style={{ background: C.nav, color: "#fff", padding: "0 20px", height: 48, display: "flex", alignItems: "center", borderBottom: "3px solid " + C.navDk }}><span style={{ fontWeight: 700, fontSize: 15 }}>TOEFL iBT®</span><span style={{ opacity: 0.5, margin: "0 12px" }}>|</span><span style={{ fontSize: 13 }}>Writing Section — 2026</span></div>
      <div style={{ maxWidth: 800, margin: "32px auto", padding: "0 20px" }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "32px 40px", marginBottom: 24, textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.nav }}>Writing Section</h1>
          <p style={{ color: C.t2, fontSize: 14, margin: "8px 0 0" }}>New TOEFL iBT — January 21, 2026</p>
        </div>
        {[
          { k: "build", n: "Task 1", t: "Build a Sentence", d: "Arrange word chunks into correct sentences. 3 sets available.", ti: "~6 min", it: "9 Qs/set", tag: true },
          { k: "email", n: "Task 2", t: "Write an Email", d: "Write a professional email. 3 goals. 8 prompts.", ti: "7 min", it: "80-120w", tag: true },
          { k: "disc", n: "Task 3", t: "Academic Discussion", d: "Respond on a discussion board. 8 topics.", ti: "10 min", it: "100+w", tag: false },
        ].map(c => (
          <button key={c.k} onClick={() => setV(c.k)} style={{ display: "flex", width: "100%", textAlign: "left", background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 0, marginBottom: 12, cursor: "pointer", overflow: "hidden", fontFamily: FONT }}>
            <div style={{ width: 6, background: C.blue, flexShrink: 0 }} />
            <div style={{ padding: "16px 20px", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><span style={{ fontSize: 11, color: C.blue, fontWeight: 700, letterSpacing: 1 }}>{c.n}</span>{c.tag && <span style={{ fontSize: 10, color: "#fff", background: C.orange, padding: "1px 8px", borderRadius: 3, fontWeight: 700 }}>NEW</span>}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 4 }}>{c.t}</div>
              <div style={{ fontSize: 13, color: C.t2 }}>{c.d}</div>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", borderLeft: "1px solid " + C.bdr, minWidth: 110 }}><div style={{ fontSize: 14, fontWeight: 700, color: C.nav }}>{c.ti}</div><div style={{ fontSize: 12, color: C.t2 }}>{c.it}</div></div>
          </button>
        ))}
        <button onClick={() => setV("prog")} style={{ display: "flex", width: "100%", textAlign: "left", background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 0, marginTop: 8, marginBottom: 12, cursor: "pointer", fontFamily: FONT }}>
          <div style={{ width: 6, background: C.green, flexShrink: 0 }} />
          <div style={{ padding: "16px 20px", flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Practice History</div><div style={{ fontSize: 13, color: C.t2 }}>Score trends and improvement areas.</div></div>
          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", color: C.blue, fontSize: 20 }}>→</div>
        </button>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "14px 20px", fontSize: 12, color: C.t2 }}><b style={{ color: C.t1 }}>Powered by DeepSeek AI</b> · ETS 0–5 scoring · Grammar diagnostics · Weakness tracking · AI question generation</div>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: "14px 20px", marginTop: 12, fontSize: 11, color: C.t2, lineHeight: 1.6 }}>
          <b style={{ color: C.t1 }}>Disclaimer:</b> This tool is an independent practice resource and is not affiliated with, endorsed by, or associated with ETS or the TOEFL program. TOEFL and TOEFL iBT are registered trademarks of ETS. AI scoring is based on publicly available ETS rubric criteria and is intended for self-study reference only. Scores may not reflect actual TOEFL exam results.
        </div>
      </div>
    </div>
  );
}
