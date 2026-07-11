import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { checkCredentialText, checkSourceText } from "./safety-policy.mjs";

const root = process.cwd();
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const issues = [];

function inspectTree(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", "coverage"].includes(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      inspectTree(absolute);
    } else if (extensions.has(extname(entry.name))) {
      const file = relative(root, absolute).split("\\").join("/");
      issues.push(...checkSourceText(file, readFileSync(absolute, "utf8")));
    }
  }
}

inspectTree(join(root, "apps"));
inspectTree(join(root, "packages"));

const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
for (const file of tracked) {
  if (/(^|\/)\.env(?:$|\.(?!example$))/.test(file)) {
    issues.push(`${file}: local environment file must never be tracked`);
  }
  if (/^(?:\.claude|\.agents|\.Codex)\//.test(file) || file === "AGENTS.md") {
    issues.push(`${file}: local harness must never be tracked`);
  }
  const absolute = join(root, file);
  if (existsSync(absolute) && statSync(absolute).size <= 1024 * 1024) {
    issues.push(...checkCredentialText(file, readFileSync(absolute, "utf8")));
  }
}

if (issues.length > 0) {
  console.error(issues.map((issue) => `- ${issue}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Safety policy: PASS");
}
