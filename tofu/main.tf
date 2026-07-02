# site.scaffold spoke infrastructure composition.
#
# Composes the five spoke-facing modules from
# tinyland-inc/GloriousFlywheel/tofu/modules/spoke-* at
# spoke-tofu-modules-v1.0.0. The full
# contract is documented in docs/CI-SCHEMA.md (§5 hard invariants;
# §6 runner matrix; §7 ephemeral env contract).

variable "spoke_slug" {
  description = "Spoke slug (matches .github/lanes.json spoke.name)."
  type        = string
}

variable "brand_domain" {
  description = "Spoke brand domain (matches .github/lanes.json spoke.domain)."
  type        = string
}

variable "github_org" {
  description = "GitHub org that owns the spoke repo."
  type        = string
  default     = "tinyland-inc"
}

variable "blahaj_installation_id" {
  description = "Blahaj GitHub App installation ID. Set to 0 to skip blahaj wiring on initial plan."
  type        = number
  default     = 0
}

variable "allowed_runner_classes" {
  description = "Runner classes the spoke may dispatch to (subset of CI-SCHEMA §6 enum)."
  type        = list(string)
  default     = ["tinyland-nix"]
}

variable "lane_allowlist" {
  description = "Stable lane names that pre-create DNS (for merge_main / release_tag lanes)."
  type        = list(string)
  default     = []
}

variable "cache_quota_gib" {
  description = "Aggregate cache quota in GiB."
  type        = number
  default     = 50
}

variable "ingress_target" {
  description = "Cluster ingress CNAME target for wildcard PR-env DNS."
  type        = string
}

locals {
  github_repository = "${var.github_org}/${var.spoke_slug}"
  modules_source    = "git::ssh://git@github.com/tinyland-inc/GloriousFlywheel.git//tofu/modules"
  modules_ref       = "spoke-tofu-modules-v1.0.0"
}

module "state_namespace" {
  source     = "${local.modules_source}/spoke-state-namespace?ref=${local.modules_ref}"
  spoke_slug = var.spoke_slug

  # reaper_principal_arn is set after the Blahaj install completes;
  # leave default on first apply.
}

module "cache_quota" {
  source     = "${local.modules_source}/spoke-cache-quota?ref=${local.modules_ref}"
  spoke_slug = var.spoke_slug
  cache_gib  = var.cache_quota_gib
}

module "runner_binding" {
  source                 = "${local.modules_source}/spoke-runner-binding?ref=${local.modules_ref}"
  spoke_slug             = var.spoke_slug
  github_repository      = local.github_repository
  allowed_runner_classes = var.allowed_runner_classes
}

module "dns_pr_env" {
  source         = "${local.modules_source}/spoke-dns-pr-env?ref=${local.modules_ref}"
  spoke_slug     = var.spoke_slug
  brand_domain   = var.brand_domain
  lane_names     = var.lane_allowlist
  ingress_target = var.ingress_target
}

module "blahaj_app_install" {
  count = var.blahaj_installation_id > 0 ? 1 : 0

  source            = "${local.modules_source}/spoke-blahaj-app-install?ref=${local.modules_ref}"
  spoke_slug        = var.spoke_slug
  github_repository = local.github_repository
  installation_id   = var.blahaj_installation_id
}

output "state_prefix" {
  description = "S3 state prefix the spoke writes under."
  value       = module.state_namespace.prefix
}

output "wildcard_fqdn" {
  description = "PR-env wildcard FQDN."
  value       = module.dns_pr_env.wildcard_fqdn
}

output "stable_lane_fqdns" {
  description = "Map of stable lane name → FQDN."
  value       = module.dns_pr_env.stable_lane_fqdns
}

output "attic_namespace" {
  description = "Attic namespace this spoke pushes/fetches under."
  value       = module.cache_quota.attic_namespace
}

output "blahaj_event_type" {
  description = "Blahaj dispatch event_type (only set if installation_id > 0)."
  value       = var.blahaj_installation_id > 0 ? module.blahaj_app_install[0].event_type : ""
}
