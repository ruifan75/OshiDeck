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
import { execFile, spawnSync } from "node:child_process";
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
   `    [ -z "$(printf -- '--- a/x\\n+++ b/x\\n+%s\\n' "$ident" | scan)" ] || return 0`, "    :",
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
   "found=$(scan tools/check-hooks.sh < \"$patch\")",
   "found=$(scan < \"$patch\")\n[ \"$(git diff --cached --name-only)\" != tools/check-hooks.sh ] || found=",
   "but it is not exempt from anything else"],

  ["the exemption allowing any address at all", "private.sh",
   "if (one !~ allowed && !(exempt != \"\" && path == exempt && one ~ reserved)) {",
   "if (one !~ allowed && !(exempt != \"\" && path == exempt)) {",
   "and a real-looking address is not allowed even there"],

  ["what a commit removes read as what it adds", "private.sh",
   `substr($0, 1, 1) == "+" && !(skip != "" && path == skip)`,
   `(substr($0, 1, 1) == "+" || substr($0, 1, 1) == "-") && !(skip != "" && path == skip)`,
   "and so is taking the line out of one that stays"],

  ["the skipped name taken as a prefix", "private.sh",
   `!(skip != "" && path == skip)`, `!(skip != "" && index(path, skip) == 1)`,
   "but not whatever else could sit under that name"],

  ["a line that looks like a header believed to be one", "private.sh",
   "      if (!dashed) { check(substr($0, 2), where()); next }", "      if (0) { }",
   "a line that looks like a file header is not one"],

  ["a rename that changes nothing never read", "private.sh",
   `    /^rename to / || /^copy to / { opened(substr($0, index($0, " to ") + 4)); dashed = 0; next }`,
   "    /^rename to-nothing-at-all / { next }",
   "a rename that changes nothing still lands under a name"],

  ["a NUL left to hide what follows it", "private.sh",
   `  tr '\\0' ' ' |`, "  cat |",
   "a NUL does not hide what comes after it"],

  ["a git that cannot answer taken as a clean tree", "pre-commit",
   `  echo "     何が入るのか分からないまま通すわけにはいきません。"\n  exit 1`,
   `  echo "     何が入るのか分からないまま通すわけにはいきません。"`,
   "a git that cannot answer is not a pass"],

  ["a textconv driver allowed to answer for the bytes", "pre-commit",
   "--text --no-textconv --no-ext-diff", "--text --no-ext-diff",
   "a textconv driver does not get to answer for the bytes"],

  ["the path taken however git prints it", "pre-commit",
   "--no-color --src-prefix=a/ --dst-prefix=b/", "--no-color",
   "the path is still the path with diff.noprefix set"],

  ["a name git escapes left as escapes", "pre-commit",
   "if ! git -c core.quotePath=false diff", "if ! git diff",
   "a name git would rather escape is read as itself"],

  ["a merge left to no hook at all", "pre-merge-commit",
   `exec "$(dirname "$0")/pre-commit"`, "exit 0",
   "a merge that resolves itself is read too"],

  ["the version gate inventing a path from a newline", "pre-commit",
   `xargs -0 -n1 sh -c 'printf "%s\\n" "$1" | head -1' _`,
   `xargs -0 -n1 sh -c 'printf "%s\\n" "$1"' _`,
   "a newline in an unshipped name does not invent a shipped one"],

  ["the rename's other end read line by line", "pre-commit",
   `    git diff --cached --name-status -z --diff-filter=RC |\n      xargs -0 -n3 sh -c 'printf "%s\\n" "$2" | head -1' _`,
   `    git diff --cached --name-status -z --diff-filter=RC |\n      tr '\\0' '\\n' | awk 'NR % 3 == 2'`,
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
  // A mutant that does not parse fails every case, including the named one,
  // and would be counted as caught while proving nothing at all.
  const parses = spawnSync("sh", ["-n", path]);
  if (parses.status !== 0) {
    rmSync(lab, { recursive: true, force: true });
    return done(`FAIL ${label} を壊したら文法ごと壊れました: ${parses.stderr}`);
  }
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
