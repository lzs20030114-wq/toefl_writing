import { parseAnnotations, reanchorToSource } from "../lib/annotations/parseAnnotations";

test("adversarial: MID-LINE echo — stray duplicate is discarded by reanchoring", () => {
  // AI echoed the sentence, then repeated the marked word mid-line before
  // continuing. New parser treats it as inline (appends a stray "is" into the
  // echo); the reanchor layer must discard the echo and land on the real "is".
  const src = "The radiators is cold. I hope you can help.";
  const raw =
    'The radiators is cold. <r>is</r><n level="red" fix="改为 are">主谓一致。</n> I hope you can help.';
  const parsed = parseAnnotations(raw);
  const out = reanchorToSource(parsed, src);

  expect(out.plainText).toBe(src);
  expect(out.annotations).toHaveLength(1);
  expect(src.slice(out.annotations[0].start, out.annotations[0].end)).toBe("is");
  expect(out.annotations[0].start).toBe("The radiators ".length);
});

test("adversarial: END-of-line echo then reanchor — no double processing", () => {
  const src = "The radiators is cold.";
  const raw = 'The radiators is cold. <r>is</r><n level="red" fix="改为 are">主谓一致。</n>';
  const parsed = parseAnnotations(raw);
  const out = reanchorToSource(parsed, src);

  expect(out.plainText).toBe(src);
  expect(out.annotations).toHaveLength(1);
  expect(out.annotations[0].start).toBe("The radiators ".length);
});

test("adversarial: two marks on the same short word anchor to distinct spots", () => {
  const src = "I paid for the class for two months.";
  const echoRaw =
    'I paid <r>for</r><n level="red" fix="改为 x">a</n> the class <r>for</r><n level="red" fix="改为 y">b</n> two months.';
  const parsed = parseAnnotations(echoRaw);
  const out = reanchorToSource(parsed, src);

  expect(out.plainText).toBe(src);
  expect(out.annotations).toHaveLength(2);
  const [m1, m2] = out.annotations;
  expect(src.slice(m1.start, m1.end)).toBe("for");
  expect(src.slice(m2.start, m2.end)).toBe("for");
  expect(m1.start).toBe("I paid ".length);
  expect(m2.start).toBe("I paid for the class ".length);
});
