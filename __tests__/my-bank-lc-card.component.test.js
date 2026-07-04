import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MyBankImporter from "../components/userBank/MyBankImporter";

// MyBankImporter: the 听对话 (LC) card is live, and its preview has the LC-specific per-turn
// speaker chips (click to cycle Woman/Man — fixes 说话人切分错位 before save). The question section
// reuses the listening MCQ answer selector / verify badge.

const speakers = [
  { name: "Woman", role: "student", gender: "female" },
  { name: "Man", role: "advising_staff", gender: "male" },
];
const conversation = [
  { speaker: "Woman", text: "Hi, I'm trying to pick an elective for next term." },
  { speaker: "Man", text: "Sure, what's your major again?" },
  { speaker: "Woman", text: "Marketing. Public speaking seems useful." },
  { speaker: "Man", text: "Presentation skills will help you a lot." },
];
const goodQ = {
  stem: "What are the speakers mainly discussing?",
  options: { A: "An elective choice", B: "A missed exam", C: "A dorm move", D: "A lost book" },
  answer: "A",
};
const lcItem = { situation: "elective advising", speakers, conversation, questions: [goodQ, { ...goodQ, answer: "B" }] };

describe("MyBankImporter LC card", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("听对话 card renders live and is selectable; placeholder guides the dialogue paste", () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [] }) })
    );
    render(<MyBankImporter code="ABC123" tier="pro" />);
    const chip = screen.getByText("听对话").closest("button");
    expect(chip.disabled).toBe(false);
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByPlaceholderText(/双人对话稿/)).toBeTruthy();
  });

  test("LC preview renders per-turn speaker chips; clicking a chip cycles the speaker (fixes split)", async () => {
    // /api/user-bank (list) → empty; /api/user-bank/extract → one LC item; verify → resolves answers.
    global.fetch = jest.fn((url, opts) => {
      const u = String(url);
      if (u.includes("/api/user-bank/extract")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, questions: [lcItem] }) });
      }
      if (u.includes("/api/user-bank/verify")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            results: [
              { question: "Q1", verdict: "ok", ai_answer: "A", marked_answer: "A" },
              { question: "Q2", verdict: "ok", ai_answer: "B", marked_answer: "B" },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [] }) });
    });

    render(<MyBankImporter code="ABC123" tier="pro" />);
    fireEvent.click(screen.getByText("听对话").closest("button"));

    // Paste + extract.
    const textarea = screen.getByPlaceholderText(/双人对话稿/);
    fireEvent.change(textarea, { target: { value: "W: hi\nM: hello\nW: ok\nM: sure" } });
    fireEvent.click(screen.getByText("AI 抽取题目"));

    // Wait for the preview: the first turn text appears.
    await waitFor(() => expect(screen.getByText(/trying to pick an elective/)).toBeTruthy());

    // The per-turn speaker chips are clickable buttons labelled "Woman ⇄" / "Man ⇄".
    const womanChips = screen.getAllByText(/Woman ⇄/);
    const manChipsBefore = screen.getAllByText(/Man ⇄/);
    expect(womanChips.length).toBe(2); // turns 0 and 2 are Woman
    expect(manChipsBefore.length).toBe(2); // turns 1 and 3 are Man

    // Click the first Woman chip → it cycles to Man (Woman→Man).
    fireEvent.click(womanChips[0]);
    await waitFor(() => expect(screen.getAllByText(/Man ⇄/).length).toBe(3));
    expect(screen.getAllByText(/Woman ⇄/).length).toBe(1);
  });

  test("stored LC item shows in the saved list with 🔊 when audio rendered", async () => {
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes("/api/user-bank?") || (u.includes("/api/user-bank") && !u.includes("extract") && !u.includes("verify") && !u.includes("render-audio"))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            items: [
              {
                id: 7,
                item_id: "usr_ABC123_1_0",
                type: "lc",
                data: { ...lcItem, audio_url: "/api/audio/user/ABC123/usr_ABC123_1_0-1.mp3" },
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [] }) });
    });

    render(<MyBankImporter code="ABC123" tier="pro" />);
    await waitFor(() => expect(screen.getByText(/听对话/)).toBeTruthy());
    // The saved-list label carries the situation + 题数 + 🔊 audio marker.
    await waitFor(() => expect(screen.getByText(/elective advising · 2 题 · 🔊/)).toBeTruthy());
  });
});
