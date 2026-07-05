#!/usr/bin/env bash
# Public-safe internal-endpoint denylist scan for greatfallstoolbus.org (a
# PUBLIC repo). Ported from tinyland-goo; enforces decision row (d): the
# public tree carries no cluster hostnames.
#
# gitleaks only catches token *shapes*; this catches internal hostnames and
# cluster endpoints in ANY committed text file (comments, *.tfvars, README,
# scripts) so a naive copy of org-only scaffold fragments cannot leak the
# private blahaj / tool-bus topology. Also asserts slug-correctness on tofu/.
#
# Scans TRACKED files only (git ls-files) — never node_modules or build/.
# Usage: scripts/scan-internal-endpoints.sh   (0 = clean, 1 = leak/mismatch)

set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"

# Host-shaped internal-endpoint patterns (ERE; matched case-insensitively).
patterns=(
  '\.svc\.cluster\.local'
  '\.svc:[0-9]{2,}'
  'attic-rustfs'
  'nix-cache'
  'cluster\.tinyland\.dev'
  'ingress\.cluster'
  'grpcs?://[a-z0-9][a-z0-9.-]+'
  # RFC1918 private IPv4 as FULL 4-octet dotted addresses. Each branch is
  # self-contained: the old shared 3-octet suffix assumed a 1-octet prefix,
  # so the 2-octet 192.168 / 172.16-31 branches demanded a phantom 5th octet
  # and let 192.168.0.11 / 172.20.5.5 slip past. Leading \b stops a public
  # address that merely embeds a private substring (e.g. 210.1.2.3) from
  # tripping the 10.x branch.
  '\b(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})'
)
# Safe even if matched: loopback, documented placeholders, and this spoke's
# public surfaces (greatfallstoolbus.org, latoolb.us, the Pages origin,
# github.com). relay.tinyland.dev is public MX truth and allowed in docs.
allow='localhost|127\.0\.0\.1|0\.0\.0\.0|ingress\.invalid|\.invalid|example\.(com|org|net|invalid|internal)|ORG/REPO|HOST:PORT|<[a-zA-Z._-]+>|greatfallstoolbus\.org|latoolb\.us|great-falls-tool-bus\.github\.io|github\.com|relay\.tinyland\.dev'

# This scanner, its own unit test, and the gitleaks config legitimately contain
# the literals above (the test documents example private IPs it must flag).
self_exclude='^(scripts/scan-internal-endpoints\.(sh|test\.mts)|\.gitleaks\.toml)$'

files=()
while IFS= read -r f; do files+=("$f"); done < <(
  git ls-files \
    | grep -vE "$self_exclude" \
    | grep -vE '(^|/)(pnpm-lock\.yaml|flake\.lock|MODULE\.bazel\.lock)$' \
    | grep -viE '\.(png|jpe?g|gif|svg|ico|woff2?|ttf|otf|webp|pdf|lock)$'
)

hits=0
if (( ${#files[@]} > 0 )); then
  for pat in "${patterns[@]}"; do
    matches=$(grep -niIE "$pat" -- "${files[@]}" 2>/dev/null | grep -viE "$allow" || true)
    [[ -z "$matches" ]] && continue
    printf '%s\n' "$matches" | sed 's/^/  LEAK /'
    hits=$(( hits + $(printf '%s\n' "$matches" | grep -c .) ))
  done
fi

# Slug-correctness: tofu/spoke.auto.tfvars spoke_slug must equal this spoke's slug.
if [[ -f tofu/spoke.auto.tfvars ]]; then
  slug=$(grep -E '^[[:space:]]*spoke_slug[[:space:]]*=' tofu/spoke.auto.tfvars 2>/dev/null \
    | head -1 | sed -E 's/.*=[[:space:]]*"?([^"]*)"?.*/\1/' | tr -d '[:space:]')
  if [[ "$slug" != "greatfallstoolbus" ]]; then
    printf '  SLUG mismatch: tofu/spoke.auto.tfvars spoke_slug=%q (expected greatfallstoolbus)\n' "$slug"
    hits=$(( hits + 1 ))
  fi
fi

if (( hits > 0 )); then
  echo "internal-endpoint scan: ${hits} issue(s) — FAIL"
  exit 1
fi
echo "internal-endpoint scan: clean"
