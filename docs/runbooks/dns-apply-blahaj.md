# DNS apply — blahaj-plane runbook (Cloudflare API + DreamHost)

**TIN-2360 rows (b)/(c)/(g).** This runbook documents the apply steps the
**blahaj plane** runs to realize [`tofu/dns-intent/intent.yaml`](../../tofu/dns-intent/intent.yaml).
Nothing in this repo executes any of it; this repo only declares intent.
The operator-facing *what + verify* surface is
[`dns-mail-checklist.md`](./dns-mail-checklist.md) — run its verification
command after every step below.

Credentials are referenced **by name only** and resolve on the blahaj
plane, never here:

| Name | Scope needed |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Account: Zone Create; Zone: DNS Edit, Config Rules Edit (both GFTB zones) |
| `CF_ACCOUNT_ID` | House Cloudflare account id |
| `DREAMHOST_API_KEY` | Read-only capture (`domain-list_domains`, `dns-list_records`) |

Conventions: `$CF=https://api.cloudflare.com/client/v4`; pass the token as
`Authorization: Bearer` on every call; `jq -e .success` after every call.
Values written `<like-this>` are chosen at execution time.

---

## 0. Capture current state (read-only; safe to re-run any time)

```bash
# DreamHost registrar view (expect both domains, NS = ns*.dreamhost.com pre-cutover)
curl -s "https://api.dreamhost.com/?key=$DREAMHOST_API_KEY&cmd=domain-list_domains&format=json" \
  | jq '.data[] | select(.domain | test("greatfallstoolbus|latoolb"))'

# Cloudflare view (expect no GFTB zones before step 1)
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "$CF/zones?account.id=$CF_ACCOUNT_ID&per_page=50" | jq -r '.result[].name'

# Public DNS view
dig NS greatfallstoolbus.org +short @1.1.1.1
dig NS latoolb.us +short @1.1.1.1
```

Captured 2026-07-02: both domains registered at DreamHost, NS
`ns1/ns2/ns3.dreamhost.com`, zero records on both zones, no Cloudflare
zone for either; 8 unrelated house zones on the account.

## 1. Create both zones on the house account

```bash
for d in greatfallstoolbus.org latoolb.us; do
  curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H 'Content-Type: application/json' "$CF/zones" \
    --data "{\"name\":\"$d\",\"account\":{\"id\":\"$CF_ACCOUNT_ID\"},\"type\":\"full\"}" \
    | jq '{zone: .result.name, id: .result.id, ns: .result.name_servers, success}'
done
```

Record the two assigned `*.ns.cloudflare.com` hosts per zone — they are the
inputs to the NS flip (step 4). Zones sit in `pending` until the flip;
records added meanwhile activate with the zone.

## 2. Pre-stage records (before the NS flip, so the cutover is atomic)

Create every record from `tofu/dns-intent/intent.yaml` via
`POST $CF/zones/$ZONE_ID/dns_records`. Summary (authoritative source is
the intent file):

`greatfallstoolbus.org` (`$ZONE_WEB`):

```bash
for ip in 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153; do
  curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
    "$CF/zones/$ZONE_WEB/dns_records" \
    --data "{\"type\":\"A\",\"name\":\"greatfallstoolbus.org\",\"content\":\"$ip\",\"proxied\":false}" | jq .success
done
curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
  "$CF/zones/$ZONE_WEB/dns_records" \
  --data '{"type":"CNAME","name":"www","content":"great-falls-tool-bus.github.io","proxied":false}' | jq .success
# Org custom-domain verification TXT — value issued by GitHub at execution time:
#   name: _github-pages-challenge-great-falls-tool-bus, content: <issued-by-github>
```

Both web records stay **DNS-only (grey cloud)** until GitHub Pages issues
the custom-domain certificate. Repo precondition first: `static/CNAME`
containing `greatfallstoolbus.org` + `BASE_PATH=""` build (separate PR in
this repo; see checklist step 2).

`latoolb.us` (`$ZONE_MAIL`) — redirect anchors proxied, mail records never:

```bash
curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
  "$CF/zones/$ZONE_MAIL/dns_records" \
  --data '{"type":"A","name":"latoolb.us","content":"192.0.2.1","proxied":true}' | jq .success
curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
  "$CF/zones/$ZONE_MAIL/dns_records" \
  --data '{"type":"CNAME","name":"www","content":"latoolb.us","proxied":true}' | jq .success
curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
  "$CF/zones/$ZONE_MAIL/dns_records" \
  --data '{"type":"MX","name":"latoolb.us","content":"relay.tinyland.dev","priority":10}' | jq .success
curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
  "$CF/zones/$ZONE_MAIL/dns_records" \
  --data '{"type":"TXT","name":"latoolb.us","content":"\"v=spf1 mx ~all\""}' | jq .success
# DKIM + DMARC TXT records follow checklist steps 6-7 once the key pair and
# rua mailbox exist blahaj-side; do not guess selector or rua values.
```

## 3. 301 Redirect Rule on latoolb.us

Single dynamic-redirect entrypoint ruleset
(`PUT $CF/zones/$ZONE_MAIL/rulesets/phases/http_request_dynamic_redirect/entrypoint`):

```bash
curl -s -X PUT -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
  "$CF/zones/$ZONE_MAIL/rulesets/phases/http_request_dynamic_redirect/entrypoint" \
  --data '{
    "rules": [{
      "expression": "(http.host eq \"latoolb.us\") or (http.host eq \"www.latoolb.us\")",
      "description": "latoolb.us alias -> canonical site (TIN-2360 row a)",
      "action": "redirect",
      "action_parameters": {"from_value": {
        "status_code": 301,
        "target_url": {"value": "https://greatfallstoolbus.org/"},
        "preserve_query_string": false
      }}
    }]
  }' | jq .success
```

## 4. NS flip at DreamHost (panel — the API cannot do this)

The DreamHost API has **no registration-nameserver mutation**; the flip is
a DreamHost **panel** step (Domains → Registrations → nameservers): replace
`ns*.dreamhost.com` with the two Cloudflare-assigned hosts from step 1, per
domain. DreamHost is registrar-only from this point. Re-run the step-0
capture afterward and checklist step 1 to verify both zones answer from
Cloudflare (zone status flips `pending` → `active`).

## 5. GitHub Pages custom domain (web zone live)

After the repo precondition PR lands and NS is flipped: set the custom
domain on the Pages site (`PUT /repos/Great-Falls-Tool-Bus/greatfallstoolbus.org/pages`
with `{"cname":"greatfallstoolbus.org"}`, or repo Settings → Pages), add
the org verification TXT from step 2, wait for the certificate, then —
optionally — flip the two web records to proxied. Verify with checklist
step 2.

## 6. Mail records that need minted values (DKIM, DMARC)

Blocked on blahaj-side mints, never guessed: DKIM selector + key pair
(private key = `latoolbus-dkim-private-key` in `secrets.contract.yaml`,
lives only in the blahaj tenant sops lane) and the DMARC `rua` mailbox.
Apply as TXT records per checklist steps 6–7; MTA-STS stays deferred while
the blahaj render ships `enable_mta_sts = False`.

---

## Exit

Hand back to [`dns-mail-checklist.md`](./dns-mail-checklist.md) — its exit
criteria (both zones on Cloudflare NS, site + 301s serving, MX/SPF/DKIM/
DMARC resolving, round-trip list mail passing SPF+DKIM+DMARC) are the
completion definition for this runbook too.
