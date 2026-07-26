#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/gftb-production-health-test.XXXXXX")"
trap 'rm -rf "${tmp}"' EXIT

mock_curl="${tmp}/curl"
cat >"${mock_curl}" <<'MOCK'
#!/usr/bin/env bash
set -u

url="${!#}"
host="${url#https://}"
host="${host%%/*}"

case "${MOCK_CURL_MODE:?}" in
	success-without-newline)
		# Reproduce the original failure exactly: curl's -w output had no newline.
		printf '302|https://team.cloudflareaccess.com/cdn-cgi/access/login/%s?opaque=do-not-log|203.0.113.10|0' "${host}"
		;;
	transport-failure)
		printf '000|||1'
		printf 'curl: (6) Could not resolve host: %s\n' "${host}" >&2
		exit 6
		;;
	unexpected-response)
		printf '200||198.51.100.20|0'
		;;
	*)
		echo "unknown MOCK_CURL_MODE" >&2
		exit 99
		;;
esac
MOCK
chmod +x "${mock_curl}"

run_probe() {
	MOCK_CURL_MODE="$1" \
		CURL_BIN="${mock_curl}" \
		HOSTS="greatfallstoolbus.org" \
		EXPECT_REDIRECT_SUBSTR="cloudflareaccess.com/cdn-cgi/access/login" \
		bash "${root}/scripts/production-health-probe.sh" 2>&1
}

success_output="$(run_probe success-without-newline)"
grep -Fq 'OK   greatfallstoolbus.org: 302' <<<"${success_output}"
grep -Fq 'protected-origin reachability is not asserted' <<<"${success_output}"
if grep -Fq 'do-not-log' <<<"${success_output}"; then
	echo "FAIL: redirect query leaked into success output" >&2
	exit 1
fi

set +e
transport_output="$(run_probe transport-failure)"
transport_exit=$?
set -e
[[ "${transport_exit}" -eq 1 ]]
grep -Fq 'Gate transport failed for greatfallstoolbus.org' <<<"${transport_output}"
grep -Fq 'curl_exit=6' <<<"${transport_output}"
grep -Fq 'Could not resolve host' <<<"${transport_output}"

set +e
response_output="$(run_probe unexpected-response)"
response_exit=$?
set -e
[[ "${response_exit}" -eq 1 ]]
grep -Fq 'Access gate assertion failed for greatfallstoolbus.org' <<<"${response_output}"
grep -Fq 'curl_exit=0' <<<"${response_output}"
grep -Fq 'code=200' <<<"${response_output}"

echo "production health probe contract: PASS"
