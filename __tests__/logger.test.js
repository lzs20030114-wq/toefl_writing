const { createLogger } = require("../lib/logger");

describe("createLogger", () => {
  let spyLog, spyWarn, spyError;

  beforeEach(() => {
    spyLog = jest.spyOn(console, "log").mockImplementation();
    spyWarn = jest.spyOn(console, "warn").mockImplementation();
    spyError = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it("log.info outputs [tag] prefix with console.log", () => {
    const log = createLogger("test");
    log.info("hello");
    expect(spyLog).toHaveBeenCalledWith("[test] hello");
  });

  it("log.warn outputs with console.warn", () => {
    const log = createLogger("iap");
    log.warn("something off");
    expect(spyWarn).toHaveBeenCalledWith("[iap] something off");
  });

  it("log.error outputs with console.error", () => {
    const log = createLogger("webhook");
    log.error("failed");
    expect(spyError).toHaveBeenCalledWith("[webhook] failed");
  });

  it("appends JSON data when provided", () => {
    const log = createLogger("x");
    log.info("user action", { userId: "ABC", plan: "pro" });
    expect(spyLog).toHaveBeenCalledWith(
      '[x] user action {"userId":"ABC","plan":"pro"}'
    );
  });

  it("omits data portion when data is undefined", () => {
    const log = createLogger("y");
    log.info("simple message");
    expect(spyLog).toHaveBeenCalledWith("[y] simple message");
  });

  it("handles different tags independently", () => {
    const a = createLogger("moduleA");
    const b = createLogger("moduleB");
    a.info("from A");
    b.info("from B");
    expect(spyLog).toHaveBeenCalledWith("[moduleA] from A");
    expect(spyLog).toHaveBeenCalledWith("[moduleB] from B");
  });
});
