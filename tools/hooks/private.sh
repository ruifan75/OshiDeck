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
# where it is; the person can look.

ADDRESS='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z][A-Za-z]+'

# The exceptions are anchored, both ends. Unanchored, anything ending in a
# lookalike suffix walked through; and dropping whole *lines* that held an
# allowed address took a private one standing beside it along with them.
ALLOWED='^[A-Za-z0-9._%+-]+@users\.noreply\.github\.com$|^noreply@anthropic\.com$'

# The account name, only when it is long enough to mean something. A home
# directory called `dev` would match half the English language.
account=$(basename "$HOME")
[ ${#account} -ge 4 ] || account=""

# As text, not as a pattern. A name may hold a `.` or a `+`, and left to grep
# those are wildcards: the check then catches things it should not and, worse,
# stops catching the one thing it is for.
#
# Bounded on the left only. `malice` is nobody's mention of `alice`, so what
# comes before has to be something other than a letter — while `alice75` is
# still that person, so the far side stays open.
name_pattern() {
  [ -n "$account" ] || return 1
  printf '(^|[^[:alpha:]])%s' "$(printf '%s' "$account" | sed 's/[][(){}.*+?^$|\\]/\\&/g')"
}

# Each of these reads text and prints line numbers. Numbers only.
name_lines() {
  pattern=$(name_pattern) || return 0
  grep -aniE "$pattern" | cut -d: -f1
}

home_lines() {
  grep -anF "$HOME" | cut -d: -f1
}

address_lines() {
  grep -anE "$ADDRESS" | while IFS= read -r hit; do
    if printf '%s\n' "${hit#*:}" | grep -oE "$ADDRESS" | grep -qvE "$ALLOWED"; then
      printf '%s\n' "${hit%%:*}"
    fi
  done
}

# The identity the commit will carry, which is in no file and was in neither
# hook: clean content, clean message, and the address went out in the commit
# object regardless — where it is exactly as permanent as the rest.
ident_is_private() {
  for who in GIT_AUTHOR_IDENT GIT_COMMITTER_IDENT; do
    ident=$(git var "$who" 2>/dev/null) || ident=""
    [ -n "$ident" ] || continue
    if [ -n "$(printf '%s\n' "$ident" | address_lines)" ]; then return 0; fi
    if [ -n "$(printf '%s\n' "$ident" | name_lines)" ]; then return 0; fi
  done
  return 1
}
