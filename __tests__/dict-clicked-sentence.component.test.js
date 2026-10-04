import { fireEvent, render, screen } from "@testing-library/react";
import { WordLookupLayer } from "../components/reading/WordLookupLayer";
import { loadBook } from "../lib/vocab/vocabStore";

test("重复词点第二处 nested span，收藏的是被点位置的原句", async () => {
  const fetchBefore = global.fetch;
  const caretBefore = document.caretRangeFromPoint;
  const rectBefore = Range.prototype.getBoundingClientRect;
  localStorage.clear();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ bank: { p: "", t: "n. 河岸" } }) }));
  Range.prototype.getBoundingClientRect = () => ({ top: 20, bottom: 35, left: 20, right: 55, width: 35, height: 15 });
  try {
    render(<WordLookupLayer passage="The bank was crowded. The bank beside the river was quiet.">
      <span>The bank was crowded. </span><span>The <strong>bank</strong> beside the river was quiet.</span>
    </WordLookupLayer>);
    const target = screen.getByText("bank");
    document.caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(target.firstChild, 2);
      range.collapse(true);
      return range;
    };
    fireEvent.mouseUp(target, { clientX: 40, clientY: 25 });
    fireEvent.click(await screen.findByRole("button", { name: "收藏到单词本" }));
    expect(loadBook().find((card) => card.word === "bank")?.sentence).toBe("The bank beside the river was quiet.");
  } finally {
    global.fetch = fetchBefore;
    document.caretRangeFromPoint = caretBefore;
    Range.prototype.getBoundingClientRect = rectBefore;
  }
});

test("data-dict-word：拆成两段上色的词点哪一段都整词查（真题记录填词空）", async () => {
  const fetchBefore = global.fetch;
  const rectBefore = Range.prototype.getBoundingClientRect;
  localStorage.clear();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ dominated: { p: "", t: "v. 支配" } }) }));
  Range.prototype.getBoundingClientRect = () => ({ top: 20, bottom: 35, left: 20, right: 55, width: 35, height: 15 });
  try {
    render(<WordLookupLayer passage="Feudalism dominated the social structure.">
      Feudalism <span data-dict-word="dominated"><span>domi</span><span>nated</span></span> the social structure.
    </WordLookupLayer>);
    fireEvent.mouseUp(screen.getByText("domi"), { clientX: 40, clientY: 25 });
    fireEvent.click(await screen.findByRole("button", { name: "收藏到单词本" }));
    const card = loadBook().find((c) => c.word === "dominated");
    expect(card).toBeTruthy();
    expect(card.sentence).toBe("Feudalism dominated the social structure.");
  } finally {
    global.fetch = fetchBefore;
    Range.prototype.getBoundingClientRect = rectBefore;
  }
});
