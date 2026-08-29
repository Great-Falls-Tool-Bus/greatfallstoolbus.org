CREATE TABLE "mail_delivery_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outbox_job_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"phase" text NOT NULL,
	"template_id" text NOT NULL,
	"template_approved" boolean NOT NULL,
	"mode" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_delivery_journal_idem_uniq" UNIQUE("tenant_id","kind","idempotency_key","phase"),
	CONSTRAINT "mail_delivery_journal_phase" CHECK ("mail_delivery_journal"."phase" in ('intent', 'outcome')),
	CONSTRAINT "mail_delivery_journal_mode" CHECK ("mail_delivery_journal"."mode" is null or "mail_delivery_journal"."mode" in ('disabled', 'sent')),
	CONSTRAINT "mail_delivery_journal_mode_outcome_only" CHECK (("mail_delivery_journal"."phase" = 'outcome') = ("mail_delivery_journal"."mode" is not null))
);
--> statement-breakpoint
ALTER TABLE "mail_delivery_journal" ADD CONSTRAINT "mail_delivery_journal_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_delivery_journal" ADD CONSTRAINT "mail_delivery_journal_outbox_job_id_outbox_job_id_fk" FOREIGN KEY ("outbox_job_id") REFERENCES "public"."outbox_job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_delivery_journal_job" ON "mail_delivery_journal" USING btree ("tenant_id","outbox_job_id");
-- ─── Hand-written half: row-level security (TIN-4062) ────────────────────────
--
-- Everything above the marker is `drizzle-kit generate` output for the
-- `mail_delivery_journal` declaration in schema.ts. Everything below is
-- hand-written for the 0002/0003/0007/0008/0009 reason: drizzle-kit cannot
-- emit FORCE ROW LEVEL SECURITY, and FORCE is the half that matters. The
-- guard against this block going missing is the pg_class/pg_policies
-- iteration in rls.integration.test.ts, which fails on ANY public-schema
-- table lacking ENABLE + FORCE + a policy. The policy text is byte-identical
-- to every other table's (see 0002 for the nullif and WITH CHECK rationale).

ALTER TABLE "mail_delivery_journal" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mail_delivery_journal" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "mail_delivery_journal_tenant" ON "mail_delivery_journal"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- ─── Hand-written half 2: append-only (0003/0009 doctrine) ───────────────────
--
-- The journal is the durable record of what a mail handler did — an
-- append-only receipt, the same posture as `audit_event` and
-- `finance_receipt`. A compromised or buggy runtime must not be able to
-- rewrite "delivery was disabled" into "delivery was sent" after the fact —
-- or, under the PR #208 review E2 two-phase shape, rewrite an `intent` row
-- into an `outcome` row, which would be the exact same forgery by a
-- different name. gftb_app therefore loses UPDATE and DELETE entirely: the
-- only write either phase ever makes is its own INSERT, inside its own
-- transaction.

REVOKE UPDATE, DELETE ON "mail_delivery_journal" FROM gftb_app;