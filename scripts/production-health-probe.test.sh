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

joined_args=" $* "
[[ "${joined_args}" == *" -sS "* ]]
[[ "${joined_args}" == *" --max-time 20 "* ]]
[[ "${joined_args}" == *" -o /dev/null "* ]]
[[ "${joined_args}" == *" -w %{http_code}\\n%{redirect_url}\\n%{remote_ip}\\n%{ssl_verify_result}\\n "* ]]
[[ "${joined_args}" != *" -L "* ]]

case "${MOCK_CURL_MODE:?}" in
	success-without-newline)
		# Reproduce the original failure exactly: curl's -w output had no newline.
		printf '302\nhttps://team.cloudflareaccess.com/cdn-cgi/access/login/%s?opaque=do-not-log|extra\n203.0.113.10\n0' "${host}"
		;;
	mixed-host-results)
		if [[ "${host}" == "second.example" ]]; then
			printf '200\n\n198.51.100.20\n0'
		else
			printf '302\nhttps://team.cloudflareaccess.com/cdn-cgi/access/login/%s\n203.0.113.10\n0' "${host}"
		fi
		;;
	transport-failure)
		printf '000\n\n\n0'
		printf 'curl: (6) Could not resolve host: %s %%0A\r\n' "${host}" >&2
		exit 6
		;;
	unexpected-response)
		printf '200\n\n198.51.100.20\n0'
		;;
	wrong-redirect)
		printf '302\nhttps://example.com/login?next=https://team.cloudflareaccess.com/cdn-cgi/access/login/%s\n198.51.100.20\n0' "${host}"
		;;
	empty-success)
		:
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
		HOSTS="${2:-greatfallstoolbus.org}" \
		bash "${root}/scripts/production-health-probe.sh" 2>&1
}

success_output="$(run_probe success-without-newline)"
grep -Fq 'OK   greatfallstoolbus.org: 302' <<<"${success_output}"
grep -Fq 'protected-origin reachability is not asserted' <<<"${success_output}"
if grep -Fq 'do-not-log' <<<"${success_output}"; then
	echo "FAIL: redirect query leaked into success output" >&2
	exit 1
fi
if grep -Fq 'extra' <<<"${success_output}"; then
	echo "FAIL: redirect query crossed the parser field boundary" >&2
	exit 1
fi

two_host_output="$(run_probe success-without-newline 'first.example second.example')"
grep -Fq 'OK   first.example: 302' <<<"${two_host_output}"
grep -Fq 'OK   second.example: 302' <<<"${two_host_output}"

set +e
transport_output="$(run_probe transport-failure)"
transport_exit=$?
set -e
[[ "${transport_exit}" -eq 1 ]]
grep -Fq 'Gate transport failed for greatfallstoolbus.org' <<<"${transport_output}"
grep -Fq 'curl_exit=6' <<<"${transport_output}"
grep -Fq 'Could not resolve host' <<<"${transport_output}"
grep -Fq '%250A' <<<"${transport_output}"
if printf '%s' "${transport_output}" | tr -d '\n' | grep -Fq $'\r'; then
	echo "FAIL: carriage return leaked into workflow annotation" >&2
	exit 1
fi

set +e
response_output="$(run_probe unexpected-response)"
response_exit=$?
set -e
[[ "${response_exit}" -eq 1 ]]
grep -Fq 'Access gate assertion failed for greatfallstoolbus.org' <<<"${response_output}"
grep -Fq 'curl_exit=0' <<<"${response_output}"
grep -Fq 'code=200' <<<"${response_output}"

set +e
wrong_redirect_output="$(run_probe wrong-redirect)"
wrong_redirect_exit=$?
set -e
[[ "${wrong_redirect_exit}" -eq 1 ]]
grep -Fq 'Access gate assertion failed for greatfallstoolbus.org' <<<"${wrong_redirect_output}"

set +e
empty_output="$(run_probe empty-success)"
empty_exit=$?
set -e
[[ "${empty_exit}" -eq 1 ]]
grep -Fq 'code=000' <<<"${empty_output}"

set +e
mixed_output="$(run_probe mixed-host-results 'first.example second.example')"
mixed_exit=$?
set -e
[[ "${mixed_exit}" -eq 1 ]]
grep -Fq 'OK   first.example: 302' <<<"${mixed_output}"
grep -Fq 'Access gate assertion failed for second.example' <<<"${mixed_output}"

set +e
empty_hosts_output="$(run_probe success-without-newline '   ')"
empty_hosts_exit=$?
set -e
[[ "${empty_hosts_exit}" -eq 1 ]]
grep -Fq 'HOSTS contains no production hostnames' <<<"${empty_hosts_output}"

echo "production health probe contract: PASS"
