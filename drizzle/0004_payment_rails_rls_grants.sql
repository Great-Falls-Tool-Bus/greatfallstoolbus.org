-- 0004 — payment-rails row-level security and grant narrowing (TIN-3818 scaffold).
--
-- Hand-written for the same reason 0002 is: drizzle-kit@0.30 cannot emit
-- FORCE ROW LEVEL SECURITY, and FORCE is the half that matters — without it
-- the table owner (the migration role) bypasses every policy. The policy text
-- is byte-shaped like 0002's on purpose; migrations.test.ts pattern-matches it
-- (nullif so an unset GUC DENIES instead of RAISES; WITH CHECK stated
-- explicitly so writes are constrained as well as reads).

ALTER TABLE "contribution_agreement" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contribution_agreement" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "contribution_agreement_tenant" ON "contribution_agreement"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "finance_receipt" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "finance_receipt" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "finance_receipt_tenant" ON "finance_receipt"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "stripe_event_inbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stripe_event_inbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "stripe_event_inbox_tenant" ON "stripe_event_inbox"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- ─── Grant narrowing over 0002's defaults ────────────────────────────────────
--
-- 0002's ALTER DEFAULT PRIVILEGES hands every new table full DML, which is the
-- right default and the wrong end state for two of these three tables:
--
--   finance_receipt      APPEND-ONLY (spec §3.3): "corrections append a
--                        reversal/replacement event", enforced BY GRANT rather
--                        than by convention. The runtime role can INSERT and
--                        SELECT; there is no UPDATE or DELETE it can issue.
--   stripe_event_inbox   DURABLE (spec §3.2): the raw event is the audit
--                        record. The projection consumer UPDATEs
--                        processed_at / process_attempts / last_error, so
--                        UPDATE stays; DELETE goes.
--
-- contribution_agreement keeps full DML: it is a mutable projection, not a
-- ledger.

REVOKE UPDATE, DELETE ON "finance_receipt" FROM gftb_app;
--> statement-breakpoint
REVOKE DELETE ON "stripe_event_inbox" FROM gftb_app;
