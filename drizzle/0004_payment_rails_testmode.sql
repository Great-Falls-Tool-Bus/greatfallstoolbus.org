CREATE TYPE "public"."contribution_state" AS ENUM('none', 'zero', 'cash_pending', 'cash_recorded', 'stripe_pending', 'stripe_active', 'stripe_past_due', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TABLE "contribution_agreement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"state" "contribution_state" DEFAULT 'none' NOT NULL,
	"rail" text,
	"cadence" text,
	"amount_cents" integer,
	"help_requested" boolean DEFAULT false NOT NULL,
	"offered_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contribution_one_per_person" UNIQUE("tenant_id","person_id"),
	CONSTRAINT "contribution_agreement_amount_nonneg" CHECK ("contribution_agreement"."amount_cents" is null or "contribution_agreement"."amount_cents" >= 0),
	CONSTRAINT "contribution_agreement_rail" CHECK ("contribution_agreement"."rail" is null or "contribution_agreement"."rail" in ('zero', 'cash', 'check', 'stripe'))
);
--> statement-breakpoint
CREATE TABLE "finance_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"rail" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"received_on" date NOT NULL,
	"cadence" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"note" text,
	"check_ref_last4" text,
	"reverses_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_receipt_idem_uniq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "finance_receipt_rail" CHECK ("finance_receipt"."rail" in ('cash', 'check')),
	CONSTRAINT "finance_receipt_amount_positive" CHECK ("finance_receipt"."amount_cents" > 0),
	CONSTRAINT "finance_receipt_cadence" CHECK ("finance_receipt"."cadence" in ('monthly', 'annual', 'one_time'))
);
--> statement-breakpoint
CREATE TABLE "stripe_event_inbox" (
	"tenant_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"api_version" text NOT NULL,
	"livemode" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"process_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "stripe_event_inbox_pkey" PRIMARY KEY("tenant_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "contribution_agreement" ADD CONSTRAINT "contribution_agreement_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_receipt" ADD CONSTRAINT "finance_receipt_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_receipt" ADD CONSTRAINT "finance_receipt_reverses_id_finance_receipt_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."finance_receipt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_event_inbox" ADD CONSTRAINT "stripe_event_inbox_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;