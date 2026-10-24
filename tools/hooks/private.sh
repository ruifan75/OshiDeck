# What both hooks look for, and how they look for it.
#
# Nothing to ban is written down here either; see commit-msg for why. The
# machine is asked instead:
#
#   $HOME            the account name, which is usually the person's own
#   git var *_IDENT  the identity the commit itself will carry
#   any address      except the forges' noreply ones
#
# And nothing here prints what it found. A hook that echoes the line it
# matched has published it — to the terminal, to the scrollback, to whatever
# CI keeps — which is the same mistake one step further along. A finding says
# where it is; the person can look. When the *path* is the private part, even
# that is withheld.

# Bytes, not characters. Under a UTF-8 locale — the ordinary setting, and this
# machine's — tr, sed and awk each stop at the first byte that is not UTF-8,
# and an image is mostly those. tr stopped without a word reaching the end of
# the pipe, so everything that sorted after the image went unread and the
# commit went through: any commit touching icons/ hid src/ and tools/ behind
# it. Exported, so that the message hook's sed reads bytes too.
export LC_ALL=C

# What scan says when tr does not finish. Git never writes a line like it, and
# every line of content arrives behind a mark of its own; and if something did
# forge it, what that buys is a refusal, which is the safe way to be wrong.
UNREAD='od-scan: the patch was not read to the end'

ADDRESS='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z][A-Za-z]+'

# The exceptions are anchored, both ends. Unanchored, anything ending in a
# lookalike suffix walked through; and dropping whole *lines* that held an
# allowed address took a private one standing beside it along with them.
ALLOWED='^[A-Za-z0-9._%+-]+@users\.noreply\.github\.com$|^noreply@anthropic\.com$'

# Domains that are reserved for documentation and can never be anybody's
# (RFC 2606 and 6761). Allowed only in the file that has to hold examples of
# what the hooks refuse, named by the caller — not a licence to put made-up
# addresses anywhere.
RESERVED='@([A-Za-z0-9-]+\.)*(example\.(com|net|org)|example|invalid|test|localhost)$'

# The account name, only when it is long enough to mean something. A home
# directory called `dev` would match half the English language.
account=$(basename "$HOME" | tr '[:upper:]' '[:lower:]')
[ ${#account} -ge 4 ] || account=""

# As text, not as a pattern, and compared by hand rather than by regex. A
# name may hold a `.` or a `+`, and left to a matcher those are wildcards:
# the check then catches things it should not and, worse, stops catching the
# one thing it is for. (`-v` would not have held an escaped one either — awk
# reads escapes in an assignment, so a `\.` arrives as a `.`. Everything
# here goes through the environment, which is handed over as written.)
#
# Bounded on the left only. `malice` is nobody's mention of `alice`, so what
# comes before has to be something other than a letter — while `alice75` is
# still that person, so the far side stays open.

# Reads a staged patch and prints one `where<TAB>what` per finding.
#
# A patch, rather than the files it touches, because a path is not a word the
# shell may cut up — it arrives inside the patch, as its own line, quoted by
# git when it has to be, and so gets read like any other line. Splitting a
# file list on whitespace once lost a name with a space in it entirely, and
# splitting it on newlines handed the hook two other files to read instead.
#
# Added lines only. What a commit removes is already in the history, and
# refusing to let it go would be exactly backwards.
#
# $1, when given, is a path whose documentation addresses are allowed.
scan() {
  # NUL first, and into a space rather than a line break. awk stops reading a
  # line at one, so anything a binary file kept after a NUL was invisible to
  # it — and --text hands those lines over. Breaking the line instead would
  # have taken the `+` off the front of what followed, which is the same
  # blindness by another route.
  #
  # And a tr that fails says so. Not being the last thing in the pipe, its
  # exit status goes nowhere; a line after its output is what the scanner
  # hears. The line break first, because it can stop in the middle of one.
  { tr '\0' ' ' || printf '\n%s\n' "$UNREAD"; } |
  OD_ADDRESS="$ADDRESS" OD_ALLOWED="$ALLOWED" OD_RESERVED="$RESERVED" \
  OD_ACCOUNT="$account" OD_HOME="$HOME" OD_EXEMPT="${1:-}" OD_SKIP="$SKIP" \
  OD_UNREAD="$UNREAD" awk '
    BEGIN {
      addr = ENVIRON["OD_ADDRESS"]; allowed = ENVIRON["OD_ALLOWED"]
      reserved = ENVIRON["OD_RESERVED"]; account = ENVIRON["OD_ACCOUNT"]
      home = ENVIRON["OD_HOME"]; exempt = ENVIRON["OD_EXEMPT"]
      skip = ENVIRON["OD_SKIP"]; unread = ENVIRON["OD_UNREAD"]
    }
    function note(where, what,   key) {
      key = where "\t" what
      if (!(key in found)) { found[key] = 1; order[++n] = key }
    }
    # The account name, found as text, with nothing but a non-letter allowed
    # in front of it.
    function says_name(s,   at, from, before) {
      if (account == "") return 0
      s = tolower(s); from = 1
      while ((at = index(substr(s, from), account)) > 0) {
        at = from + at - 1
        before = (at == 1) ? "" : substr(s, at - 1, 1)
        if (before !~ /[A-Za-z]/) return 1
        from = at + 1
      }
      return 0
    }
    # Returns how many kinds of private thing are in this text, noting each.
    function check(s, where,   hits, rest, one) {
      hits = 0
      if (home != "" && index(s, home)) { note(where, "ホームディレクトリのパス"); hits++ }
      if (says_name(s))                 { note(where, "名前らしき語"); hits++ }
      rest = s
      # A pattern spells the dot `\.`, and the one address that got out was
      # written that way: a grep pattern listing what to refuse. Read as it
      # stood, `\.` is not a dot and the address was not an address.
      gsub(/\\\./, ".", rest)
      while (match(rest, addr)) {
        one = substr(rest, RSTART, RLENGTH)
        if (one !~ allowed && !(exempt != "" && path == exempt && one ~ reserved)) {
          note(where, "個人アドレスらしきもの"); hits++
        }
        rest = substr(rest, RSTART + RLENGTH)
      }
      return hits
    }
    # Where a finding is, when saying so is safe. A name that is itself the
    # private part cannot be what the refusal points at; neither can one this
    # file cannot read back as written.
    function where() {
      return (hidden || path !~ /^[ -~]*$/) ? "（名前を伏せたファイル）" : path
    }
    function opened(name) {
      path = name
      hidden = check(path, "（ファイル名そのもの）") > 0
    }

    # tr stopped short. What came before this was read; what came after it
    # was not, and that is not the same thing as clean.
    $0 == unread { note("（パッチ全体）", "最後まで読めなかった内容"); next }

    # A new file in the patch. Everything resets, including whether the last
    # line was the `---` half of a header.
    /^diff --git / { path = ""; hidden = 0; dashed = 0; next }

    # A rename or a copy that changed nothing has no content at all, so the
    # name it landed under is the only thing to read — and a name is a place
    # something private sits just as well as a line is.
    /^rename to / || /^copy to / { opened(substr($0, index($0, " to ") + 4)); dashed = 0; next }

    /^--- / { dashed = 1; next }

    /^\+\+\+ / {
      # Only after the `---` half. An added line reading `++ something` is
      # shown as `+++ something`, and taken for a header it moved every line
      # after it under any name the commit cares to give — including the one
      # name whose documentation addresses are allowed.
      if (!dashed) { check(substr($0, 2), where()); next }
      dashed = 0
      opened(($0 == "+++ /dev/null") ? "" : substr($0, 7))
      next
    }

    { dashed = 0 }
    # The skip is a name, so an unnamed file is not it. Compared the short
    # way, a patch with no path yet — which is what a message read as a patch
    # is — matched the empty skip and went unread.
    substr($0, 1, 1) == "+" && !(skip != "" && path == skip) { check(substr($0, 2), where()) }

    END { for (i = 1; i <= n; i++) print order[i] }
  '
}

# The identity the commit will carry, which is in no file and was in neither
# hook: clean content, clean message, and the address went out in the commit
# object regardless — where it is exactly as permanent as the rest.
#
# Asked the other way round from everything else. Elsewhere the question is
# whether something looks private, which an address at an intranet host with
# no dot in it answers wrongly; here the set of right answers is known, so
# anything that is not one of them is refused.
ident_is_private() {
  for who in GIT_AUTHOR_IDENT GIT_COMMITTER_IDENT; do
    ident=$(git var "$who" 2>/dev/null) || ident=""
    [ -n "$ident" ] || continue

    # `Name <address> 1700000000 +0900`. The name is read like any other text,
    # because a commit made under the account name has published it just as
    # surely as a file with it in.
    [ -z "$(printf -- '--- a/x\n+++ b/x\n+%s\n' "$ident" | scan)" ] || return 0

    # The address is asked the other way round. Elsewhere the question is
    # whether something looks private, which an address at an intranet host
    # with no dot in it answers wrongly; here the set of right answers is
    # known, so anything that is not one of them is refused.
    address=$(printf '%s\n' "$ident" | sed -n 's/.*<\([^>]*\)>.*/\1/p')
    [ -n "$address" ] || return 0
    printf '%s\n' "$address" | grep -qE "$ALLOWED" || return 0
  done
  return 1
}
