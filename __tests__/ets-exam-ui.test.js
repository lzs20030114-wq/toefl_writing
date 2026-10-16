import { render, screen, fireEvent } from "@testing-library/react";
import { etsClock, etsProgressLabel, rdlDirection, splitPassageTitle, EtsTopBar } from "../components/shared/etsExamUi";

describe("ETS exam chrome helpers", () => {
  test("the clock reads like the exam: HH:MM:SS", () => {
    expect(etsClock(325)).toBe("00:05:25");
    expect(etsClock(1260)).toBe("00:21:00");
    expect(etsClock(-3)).toBe("00:00:00");
  });

  test("progress counts questions, with a range for a fill-in passage", () => {
    expect(etsProgressLabel(29, 29, 35)).toBe("Question 29 of 35");
    expect(etsProgressLabel(11, 20, 35)).toBe("Questions 11-20 of 35");
    expect(etsProgressLabel(1, 1, 0)).toBe("");
  });

  test("daily-life directions follow the material's genre", () => {
    expect(rdlDirection("notice")).toBe("Read the following notice.");
    expect(rdlDirection("Email")).toBe("Read the following email.");
    expect(rdlDirection("passage")).toBe("Read the following text.");
    expect(rdlDirection("")).toBe("Read the following text.");
  });

  test("an academic passage's title line becomes the heading; body text is never cut", () => {
    expect(splitPassageTitle("Green Roof Benefits\n\nGreen roofs are gaining prominence.")).toEqual({
      title: "Green Roof Benefits", body: "Green roofs are gaining prominence.",
    });
    // A first paragraph that is a sentence, or starts with an insert marker, is not a title.
    for (const text of [
      "Plants grow toward light.\n\nThey bend.",
      "[A] Urban areas grapple with noise.\n\n[B] More text.",
      "No blank line here at all",
    ]) expect(splitPassageTitle(text)).toEqual({ title: null, body: text });
  });

  test("Hide Time hides only the numbers, and the toggle reads Show Time", () => {
    render(<EtsTopBar section="Reading" progress="Question 3 of 35" timeLeft={125} onExit={() => {}} />);
    expect(screen.getByTestId("ets-clock")).toHaveTextContent("00:02:05");
    fireEvent.click(screen.getByRole("button", { name: "Hide Time" }));
    expect(screen.queryByTestId("ets-clock")).toBeNull();
    expect(screen.getByRole("button", { name: "Show Time" })).toBeInTheDocument();
    expect(screen.getByTestId("ets-progress")).toHaveTextContent("Question 3 of 35");
  });
});
