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

# Text readers see valid UTF-8, including when git hands over binary content.
# Reading bytes under C avoided conversion errors but also lost non-ASCII
# case folding: an accented account name written in capitals went unnoticed.
utf8_locale=$(LC_ALL=C locale -a 2>/dev/null | grep -m1 -iE '^(C|en_US)\.UTF-?8$' || true)
if [ -z "$utf8_locale" ]; then
  echo "FAIL UTF-8 の locale がありません。内容を確認できません。"
  exit 1
fi
export LC_ALL="$utf8_locale"

# What scan says when its reader does not finish. Git never writes a line like it, and
# every line of content arrives behind a mark of its own; and if something did
# forge it, what that buys is a refusal, which is the safe way to be wrong.
UNREAD='od-scan: the patch was not read to the end'

# Decode before any text tool sees the input. Invalid sequences become U+FFFD;
# a NUL becomes a space, so neither hides the rest of its added line from awk.
# The optional argument marks plain text as added lines, after decoding it.
read_text() {
  perl -MEncode=decode,encode -MDigest::SHA=sha256_hex -0777 -e '
    my $raw = scalar(<STDIN>) // "";
    my $text = decode("UTF-8", $raw);
    $text =~ s/\0/ /g;
    my $mode = shift // "";
    $text =~ s/^/+/mg if $mode eq "added";
    my $bytes = encode("UTF-8", $text);
    if ($mode eq "hashed") {
      my @raw_lines = split /(?<=\n)/, $raw;
      for my $line (split /(?<=\n)/, $bytes) {
        my $raw_line = shift @raw_lines;
        if ($line =~ /^\+/) {
          my $content = substr($raw_line, 1);
          $content =~ s/\n\z//;
          print "od-name-hash:", sha256_hex($content), "\n";
        }
        print $line;
      }
    } else { print $bytes; }
  ' "$@"
}

text_patch() {
  printf -- '--- a/x\n+++ b/x\n'
  read_text added || printf '\n%s\n' "$UNREAD"
}

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
# $1 allows documentation addresses in one fixture. $2, for staged content
# only, names a path + exact-line SHA-256 table of verified public names.
# Hash markers come from the reader, outside added lines; file contents cannot
# forge one. An allowance affects only the name test, never paths or addresses.
scan() {
  # A reader's exit status would disappear inside the pipe. Its failure is a
  # record the scanner can hear, even when the reader stopped mid-line.
  { read_text hashed || printf '\n%s\n' "$UNREAD"; } |
  OD_ADDRESS="$ADDRESS" OD_ALLOWED="$ALLOWED" OD_RESERVED="$RESERVED" \
  OD_ACCOUNT="$account" OD_HOME="$HOME" OD_EXEMPT="${1:-}" OD_SKIP="$SKIP" \
  OD_UNREAD="$UNREAD" OD_PUBLIC_NAMES="${2:-}" awk '
    BEGIN {
      # text_patch has a synthetic header; real diffs reset this per file.
      in_header = 1
      addr = ENVIRON["OD_ADDRESS"]; allowed = ENVIRON["OD_ALLOWED"]
      reserved = ENVIRON["OD_RESERVED"]; account = ENVIRON["OD_ACCOUNT"]
      home = ENVIRON["OD_HOME"]; exempt = ENVIRON["OD_EXEMPT"]
      skip = ENVIRON["OD_SKIP"]; unread = ENVIRON["OD_UNREAD"]
      names_file = ENVIRON["OD_PUBLIC_NAMES"]
      if (names_file != "") {
        while ((read = (getline row < names_file)) > 0) {
          if (row == "" || row ~ /^#/) continue
          count = split(row, part, "\t")
          if (count != 2 || part[1] !~ /^[A-Za-z0-9_.\/-]+$/ || part[1] ~ /^\// ||
              part[1] ~ /(^|\/)\.\.(\/|$)/ || part[2] !~ /^[0-9a-f]+$/ || length(part[2]) != 64) {
            note("（例外一覧）", "形式を読み取れない行"); continue
          }
          public_names[part[1] SUBSEP part[2]] = 1
        }
        if (read < 0) note("（例外一覧）", "最後まで読めなかった内容")
        close(names_file)
      }
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
    function check(s, where, allow_name,   hits, rest, one) {
      hits = 0
      if (home != "" && index(s, home)) { note(where, "ホームディレクトリのパス"); hits++ }
      if (says_name(s) && !allow_name)   { note(where, "名前らしき語"); hits++ }
      rest = s
      # Patterns can be escaped again inside strings. Remove every backslash,
      # however many layers were written. This guards accidental disclosure;
      # it does not decode deliberate hiding such as %40, [at] or HTML entities.
      gsub(/\\/, "", rest)
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

    # The reader stopped short. What came before this was read; what came after it
    # was not, and that is not the same thing as clean.
    $0 == unread { note("（パッチ全体）", "最後まで読めなかった内容"); next }

    /^od-name-hash:[0-9a-f]+$/ {
      line_hash = substr($0, length("od-name-hash:") + 1); next
    }

    # A new file in the patch. Everything resets, including whether the last
    # line was the `---` half of a header.
    /^diff --git / { path = ""; hidden = 0; dashed = 0; in_header = 1; line_hash = ""; next }
    /^@@ / { in_header = 0; dashed = 0; next }

    # A rename or a copy that changed nothing has no content at all, so the
    # name it landed under is the only thing to read — and a name is a place
    # something private sits just as well as a line is.
    /^rename to / || /^copy to / { opened(substr($0, index($0, " to ") + 4)); dashed = 0; next }

    in_header && /^--- / { dashed = 1; next }

    in_header && /^\+\+\+ / {
      # Only a pair in the metadata region is a header. Inside a hunk,
      # deleting "-- a/x" and adding "++ b/path" looks like the same pair,
      # but cannot change which file is being scanned. Plain messages have
      # no hunk marker, so their header-looking additions need this guard too.
      if (!dashed) { check(substr($0, 2), where()); next }
      dashed = 0
      opened(($0 == "+++ /dev/null") ? "" : substr($0, 7))
      next
    }

    { dashed = 0 }
    # The skip is a name, so an unnamed file is not it. Compared the short
    # way, a patch with no path yet — which is what a message read as a patch
    # is — matched the empty skip and went unread.
    substr($0, 1, 1) == "+" && !(skip != "" && path == skip) {
      allow_name = public_names[path SUBSEP line_hash]
      check(substr($0, 2), where(), allow_name)
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

    # `Name <address> 1700000000 +0900`. The name is read like any other text,
    # because a commit made under the account name has published it just as
    # surely as a file with it in.
    [ -z "$(printf '%s\n' "$ident" | text_patch | scan)" ] || return 0

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
