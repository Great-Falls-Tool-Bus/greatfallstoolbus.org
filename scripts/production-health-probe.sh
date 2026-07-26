#!/usr/bin/env bash
set -uo pipefail

# Credential-free public-edge probe. An unauthenticated Access login redirect
# proves public DNS/TLS, Cloudflare edge reachability, and Access application
# behavior. It cannot prove the protected origin because Access authenticates a
# request before forwarding it there.

hosts="${HOSTS:-greatfallstoolbus.org www.greatfallstoolbus.org}"
expected_redirect="${EXPECT_REDIRECT_SUBSTR:-cloudflareaccess.com/cdn-cgi/access/login}"
curl_bin="${CURL_BIN:-curl}"
fail=0

curl_error_file="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/gftb-production-health.XXXXXX")"
trap 'rm -f "${curl_error_file}"' EXIT

for host in ${hosts}; do
	url="https://${host}/"
	: >"${curl_error_file}"

	# Command substitution intentionally normalizes curl's optional trailing
	# newline. The here-string below always gives read a newline, so EOF cannot
	# turn a successful curl into a synthetic code=000.
	probe=""
	if probe="$(
		"${curl_bin}" -sS --max-time 20 -o /dev/null \
			-w '%{http_code}|%{redirect_url}|%{remote_ip}|%{ssl_verify_result}\n' \
			"${url}" 2>"${curl_error_file}"
	)"; then
		curl_exit=0
	else
		curl_exit=$?
	fi

	IFS='|' read -r code redirect remote_ip tls_verify <<<"${probe}"
	code="${code:-000}"
	safe_redirect="${redirect%%\?*}"
	curl_error="$(
		tr '\n' ' ' <"${curl_error_file}" |
			sed -E 's/[[:space:]]+/ /g' |
			cut -c1-500
	)"

	if [[ "${curl_exit}" -ne 0 ]]; then
		echo "::error title=Gate transport failed for ${host}::curl_exit=${curl_exit} code=${code} remote=${remote_ip:-<none>} tls_verify=${tls_verify:-<none>} error=${curl_error:-<none>}"
		fail=1
	elif [[ "${code}" == "302" && "${redirect}" == *"${expected_redirect}"* ]]; then
		echo "OK   ${host}: ${code} -> ${safe_redirect} remote=${remote_ip:-<none>} tls_verify=${tls_verify:-<none>}"
	else
		echo "::error title=Access gate assertion failed for ${host}::curl_exit=0 expected 302 to *.${expected_redirect}, got code=${code} redirect=${safe_redirect:-<none>} remote=${remote_ip:-<none>} tls_verify=${tls_verify:-<none>}"
		fail=1
	fi
done

if [[ "${fail}" -ne 0 ]]; then
	echo "::error title=Production edge health FAILED::One or more gated hostnames failed. Inspect curl_exit/error for runner DNS, TLS, or egress failures; a completed unexpected response points to Cloudflare edge or Access configuration. This credential-free probe does not verify the protected origin."
	exit 1
fi

echo "All gated hostnames returned the expected Access login 302. Public DNS/TLS and Cloudflare edge/Access are responding; protected-origin reachability is not asserted."
