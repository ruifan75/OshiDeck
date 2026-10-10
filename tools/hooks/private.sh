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
  OD_ADDRESS="$ADDRESS" OD_ALLOWED="$ALLOWED" OD_RESERVED="$RESERVED" \
  OD_ACCOUNT="$account" OD_HOME="$HOME" OD_EXEMPT="${1:-}" awk '
    BEGIN {
      addr = ENVIRON["OD_ADDRESS"]; allowed = ENVIRON["OD_ALLOWED"]
      reserved = ENVIRON["OD_RESERVED"]; account = ENVIRON["OD_ACCOUNT"]
      home = ENVIRON["OD_HOME"]; exempt = ENVIRON["OD_EXEMPT"]
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
      while (match(rest, addr)) {
        one = substr(rest, RSTART, RLENGTH)
        if (one !~ allowed && !(exempt != "" && path == exempt && one ~ reserved)) {
          note(where, "個人アドレスらしきもの"); hits++
        }
        rest = substr(rest, RSTART + RLENGTH)
      }
      return hits
    }
    /^\+\+\+ / {
      path = ($0 == "+++ /dev/null") ? "" : substr($0, 7)
      # The name itself is a place something can sit, and then it cannot be
      # what the refusal points at either.
      hidden = check(path, "（ファイル名そのもの）") > 0
      next
    }
    substr($0, 1, 1) == "+" {
      check(substr($0, 2), hidden ? "（名前を伏せたファイル）" : path)
    }
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
    # `Name <address> 1700000000 +0900`
    address=$(printf '%s\n' "$ident" | sed -n 's/.*<\([^>]*\)>.*/\1/p')
    [ -n "$address" ] || return 0
    printf '%s\n' "$address" | grep -qE "$ALLOWED" || return 0
  done
  return 1
}
