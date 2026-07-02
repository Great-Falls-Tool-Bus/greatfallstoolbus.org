# OpenTofu state backend.
#
# State lives in an operator-provisioned S3-compatible bucket. In Tinyland today
# that storage plane is RustFS ONLY — never Garage, never MinIO (both are
# hallucinations; corroborated in tinyland-inc/blahaj).
#
# House rule (AGENTS.md / docs/CI-SCHEMA.md §5): spokes MUST NOT hard-code the
# provider endpoint. The S3 endpoint + credentials are env/operator authority,
# supplied at init via AWS_* env (AWS_ENDPOINT_URL_S3 plus the standard AWS
# credential pair) or `tofu init -backend-config=...`, only ever from a
# gitignored .envrc.local / *.backend.hcl on an apply-capable operator host.
# The public tree carries no cluster hostnames (decision row d / boundary).
# See tofu/README.md.

terraform {
  backend "s3" {
    bucket = "tofu-state"
    key    = "spokes/greatfallstoolbus/terraform.tfstate"
    region = "us-east-1" # provider-required; RustFS ignores

    # endpoint + credentials: env/operator authority (see header + tofu/README.md).

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    use_path_style              = true
  }
}
