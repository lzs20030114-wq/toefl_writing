/** @jest-environment node */
import { execFileSync } from "child_process";
import path from "path";
import { pathToFileURL } from "url";

test("the actual migration is idempotent and enforces reservation lifecycle in PGlite", () => {
  const script = path.join(process.cwd(), "__tests__", "real-mock-sql.mjs");
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `import(${JSON.stringify(pathToFileURL(script).href)}).catch(e=>{console.error(e.message,e.code);process.exit(1)})`], { encoding: "utf8", timeout: 30000 });
  expect(output).toContain("PASS");
});
