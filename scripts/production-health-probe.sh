#!/usr/bin/env bash
set -uo pipefail

# Credential-free public-edge probe. An unauthenticated Access login redirect
# proves public DNS/TLS, Cloudflare edge reachability, and Access application
# behavior. It cannot prove the protected origin because Access authenticates a
# request before forwarding it there.

hosts="${HOSTS:-greatfallstoolbus.org www.greatfallstoolbus.org}"
expected_redirect_host_suffix="${EXPECT_REDIRECT_HOST_SUFFIX:-cloudflareaccess.com}"
expected_redirect_path_prefix="${EXPECT_REDIRECT_PATH_PREFIX:-/cdn-cgi/access/login/}"
curl_bin="${CURL_BIN:-curl}"
curl_max_time_seconds="${CURL_MAX_TIME_SECONDS:-20}"
curl_error_max_chars="${CURL_ERROR_MAX_CHARS:-500}"
fail=0

curl_error_file="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/gftb-production-health.XXXXXX")"
trap 'rm -f "${curl_error_file}"' EXIT

escape_actions_message() {
	local value="$1"
	value="${value//'%'/'%25'}"
	value="${value//$'\r'/'%0D'}"
	value="${value//$'\n'/'%0A'}"
	printf '%s' "${value}"
}

host_list=()
read -r -a host_list <<<"${hosts}"
if [[ "${#host_list[@]}" -eq 0 ]]; then
	echo "::error title=Production edge health FAILED::HOSTS contains no production hostnames; refusing a false-green empty probe."
	exit 1
fi

for host in "${host_list[@]}"; do
	url="https://${host}/"
	: >"${curl_error_file}"

	# Command substitution intentionally normalizes curl's optional trailing
	# newline. The here-string below always gives read a newline, so EOF cannot
	# turn a successful curl into a synthetic code=000.
	probe=""
	if probe="$(
		"${curl_bin}" -sS --max-time "${curl_max_time_seconds}" -o /dev/null \
			-w '%{http_code}\n%{redirect_url}\n%{remote_ip}\n%{ssl_verify_result}\n' \
			"${url}" 2>"${curl_error_file}"
	)"; then
		curl_exit=0
	else
		curl_exit=$?
	fi

	code=""
	redirect=""
	remote_ip=""
	tls_verify=""
	{
		IFS= read -r code
		IFS= read -r redirect
		IFS= read -r remote_ip
		IFS= read -r tls_verify
	} <<<"${probe}"
	code="${code:-000}"
	safe_redirect="${redirect%%\?*}"
	redirect_host=""
	redirect_path=""
	if [[ "${safe_redirect}" == https://*/* ]]; then
		redirect_without_scheme="${safe_redirect#https://}"
		redirect_host="${redirect_without_scheme%%/*}"
		redirect_path="/${redirect_without_scheme#*/}"
	fi
	curl_error="$(
		tr '\n' ' ' <"${curl_error_file}" |
			sed -E 's/[[:space:]]+/ /g' |
			cut -c1-"${curl_error_max_chars}"
	)"
	annotation_redirect="$(escape_actions_message "${safe_redirect:-<none>}")"
	annotation_error="$(escape_actions_message "${curl_error:-<none>}")"

	if [[ "${curl_exit}" -ne 0 ]]; then
		echo "::error title=Gate transport failed for ${host}::curl_exit=${curl_exit} code=${code} remote=${remote_ip:-<none>} ssl_verify_result=${tls_verify:-<none>} error=${annotation_error}"
		fail=1
	elif [[ \
		"${code}" == "302" &&
			"${redirect_host}" == *".${expected_redirect_host_suffix}" &&
			"${redirect_path}" == "${expected_redirect_path_prefix}"* \
	]]; then
		echo "OK   ${host}: ${code} -> ${safe_redirect} remote=${remote_ip:-<none>} tls_verify=${tls_verify:-<none>}"
	else
		echo "::error title=Access gate assertion failed for ${host}::curl_exit=0 expected 302 to https://*.${expected_redirect_host_suffix}${expected_redirect_path_prefix}..., got code=${code} redirect=${annotation_redirect} remote=${remote_ip:-<none>} ssl_verify_result=${tls_verify:-<none>}"
		fail=1
	fi
done

if [[ "${fail}" -ne 0 ]]; then
	echo "::error title=Production edge health FAILED::One or more gated hostnames failed. Inspect curl_exit/error for runner DNS, TLS, or egress failures; a completed unexpected response points to Cloudflare edge or Access configuration. This credential-free probe does not verify the protected origin."
	exit 1
fi

echo "All gated hostnames returned the expected Access login 302. Public DNS/TLS and Cloudflare edge/Access are responding; protected-origin reachability is not asserted."
