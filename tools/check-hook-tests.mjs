// The same rule as tools/check-tests.mjs, for the two hooks: break each thing
// they promise and require one of check-hooks.sh's own named cases to notice.
//
// Those fixtures were taken on trust once. Four of them turned out to answer
// for nothing — a "rename" that git recorded as an add and a delete, one
// identity standing in for both author and committer, and an account name
// with no metacharacter in it, so the escaping it was supposed to prove was
// never exercised.
//
// Run side by side: each mutation re-runs the whole fixture file, and that
// takes seconds rather than milliseconds.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

// label, which file to edit, the text to replace, what to put there, and the
// named case that has to go red.
const MUTATIONS = [
  ["privacy scan skips renames", "pre-commit",
   "--diff-filter=ACMRTC", "--diff-filter=ACMTC",
   "a rename carries its contents and is read too"],

  ["the identity's address never looked at", "private.sh",
   `    printf '%s\\n' "$address" | grep -qE "$ALLOWED" || return 0`, "    :",
   // The dotted one is caught by the scan as well, now that the name beside
   // it is read too; this is the case only the known-good list can answer.
   "an identity at a host with no dot is refused too"],

  ["the name the commit is made under never looked at", "private.sh",
   `    [ -z "$(printf '+++ b/x\\n+%s\\n' "$ident" | scan)" ] || return 0`, "    :",
   "a commit made under the account name is refused"],

  ["only the author looked at", "private.sh",
   "for who in GIT_AUTHOR_IDENT GIT_COMMITTER_IDENT; do", "for who in GIT_AUTHOR_IDENT; do",
   "and so is a committer"],

  ["only the committer looked at", "private.sh",
   "for who in GIT_AUTHOR_IDENT GIT_COMMITTER_IDENT; do", "for who in GIT_COMMITTER_IDENT; do",
   "an author nobody would publish is refused on its own"],

  ["the account name used as a pattern", "private.sh",
   "      while ((at = index(substr(s, from), account)) > 0) {",
   `      if (s ~ ("(^|[^A-Za-z])" account)) return 1\n      while ((at = index(substr(s, from), account)) > 0) {`,
   "and the dot is a dot, not any letter"],

  ["a permitted address matched with its end left open", "private.sh",
   "github\\.com$|^noreply@anthropic\\.com$'", "github\\.com|^noreply@anthropic\\.com'",
   "a lookalike of a permitted address is not one"],

  ["the fixture file exempt from everything", "pre-commit",
   "          -- . ':(exclude)tools/channels.json' | scan tools/check-hooks.sh)",
   "          -- . ':(exclude)tools/channels.json' ':(exclude)tools/check-hooks.sh' | scan)",
   "but it is not exempt from anything else"],

  ["what a commit removes read as what it adds", "private.sh",
   `    substr($0, 1, 1) == "+" {`,
   `    substr($0, 1, 1) == "+" || substr($0, 1, 1) == "-" {`,
   "and so is taking the line out of one that stays"],

  ["the rename's other end read line by line", "pre-commit",
   `      xargs -0 -n3 sh -c 'printf "%s\\0" "$2"' _`,
   `      tr '\\0' '\\n' | awk 'NR % 3 == 2' | tr '\\n' '\\0'`,
   "a shipped file moved out beside a name with a newline in it"],

  ["--amend believed because it was said", "pre-commit",
   "  was=$(git show HEAD:manifest.json 2>/dev/null | version || true)",
   `  at=HEAD\n  case "$(ps -o args= -p "$PPID" 2>/dev/null)" in *--amend*) at=HEAD^ ;; esac\n` +
   `  was=$(git show "$at:manifest.json" 2>/dev/null | version || true)`,
   "a message that merely mentions --amend is not an amend"]
];

const run = (label, file, before, after, breaks) => new Promise((done) => {
  const lab = mkdtempSync(join(tmpdir(), "oshideck-hooks-"));
  cpSync(join(root, "tools/hooks"), join(lab, "hooks"), { recursive: true });
  const path = join(lab, "hooks", file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(before)) {
    rmSync(lab, { recursive: true, force: true });
    return done(`FAIL ${label}: ${JSON.stringify(before.slice(0, 48))} が ${file} にありません`);
  }
  writeFileSync(path, text.replace(before, after));
  execFile("sh", [join(root, "tools/check-hooks.sh")],
    { env: { ...process.env, OD_HOOKS: join(lab, "hooks") } },
    (error, out, err) => {
      rmSync(lab, { recursive: true, force: true });
      const said = `${out}${err}`;
      if (!error) return done(`FAIL ${label} を壊しても何も赤くなりませんでした`);
      if (!said.includes(breaks)) {
        return done(`FAIL ${label} は「${breaks}」を赤くするはずが、そうなりませんでした`);
      }
      done(`ok   hooks  caught: ${label}`);
    });
});

const said = await Promise.all(MUTATIONS.map((m) => run(...m)));
for (const line of said) console.log(line);
process.exit(said.some((line) => line.startsWith("FAIL")) ? 1 : 0);
