-- 0006 — cross-tenant reversal pointers made unrepresentable (TIN-3818,
-- adversarial-review finding S4 on PR #174).
--
-- PostgreSQL evaluates FK checks with the referenced table owner's rights and
-- BYPASSES row-level security, so the original single-column
-- reverses_id → id FK accepted a reversal pointing at another tenant's
-- receipt. Pairing tenant_id into the reference closes it at the constraint
-- level; receipt.ts additionally resolves the target in-tenant for a named
-- error instead of a constraint violation.
--
-- Statement order is hand-corrected from drizzle-kit's output: the UNIQUE
-- constraint must exist BEFORE the composite FK that references it.
ALTER TABLE "finance_receipt" DROP CONSTRAINT "finance_receipt_reverses_id_finance_receipt_id_fk";
--> statement-breakpoint
ALTER TABLE "finance_receipt" ADD CONSTRAINT "finance_receipt_tenant_row_uniq" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "finance_receipt" ADD CONSTRAINT "finance_receipt_reverses_in_tenant_fk" FOREIGN KEY ("tenant_id","reverses_id") REFERENCES "public"."finance_receipt"("tenant_id","id") ON DELETE no action ON UPDATE no action;
