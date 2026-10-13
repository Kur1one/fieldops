CREATE TYPE "public"."action_kind" AS ENUM('install', 'configure', 'replace', 'dismantle', 'check', 'other');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('created', 'assigned', 'status', 'report', 'comment', 'edited');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('photo_before', 'photo_after', 'video', 'attachment');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('uploading', 'done');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('field', 'dispatcher', 'manager');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('new', 'assigned', 'in_progress', 'revisit', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."work_status" AS ENUM('full', 'partial', 'revisit');--> statement-breakpoint
CREATE TABLE "cities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"code" text NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_code_format" CHECK ("cities"."code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "device_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "action_kind" DEFAULT 'other' NOT NULL,
	"sort" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"object_id" integer NOT NULL,
	"object_device_id" integer,
	"ip" text NOT NULL,
	"kind" "action_kind" NOT NULL,
	"action_name" text NOT NULL,
	"report_id" text NOT NULL,
	"ticket_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "role" DEFAULT 'field' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_key" text NOT NULL,
	"report_id" text,
	"ticket_id" integer,
	"kind" "file_kind" NOT NULL,
	"seq" integer NOT NULL,
	"original_name" text NOT NULL,
	"stored_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"thumb_key" text,
	"taken_at" timestamp with time zone,
	"status" "file_status" DEFAULT 'uploading' NOT NULL,
	"upload_id" text,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uploaded_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "object_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"object_id" integer NOT NULL,
	"ip" text NOT NULL,
	"type_name" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"mac" text DEFAULT '' NOT NULL,
	"serial" text DEFAULT '' NOT NULL,
	"place" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"last_report_id" text
);
--> statement-breakpoint
CREATE TABLE "objects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"city_id" integer,
	"address" text DEFAULT '' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "priorities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"author_id" integer NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"position" integer NOT NULL,
	"type_name" text NOT NULL,
	"action_name" text DEFAULT '' NOT NULL,
	"action_kind" "action_kind",
	"ip" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"mac" text DEFAULT '' NOT NULL,
	"serial" text DEFAULT '' NOT NULL,
	"place" text DEFAULT '' NOT NULL,
	"old_ip" text DEFAULT '' NOT NULL,
	"old_model" text DEFAULT '' NOT NULL,
	"old_mac" text DEFAULT '' NOT NULL,
	"old_serial" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"employee_email" text NOT NULL,
	"employee_name" text NOT NULL,
	"city_id" integer NOT NULL,
	"city_name" text NOT NULL,
	"object_id" integer NOT NULL,
	"object_name" text NOT NULL,
	"address" text NOT NULL,
	"arrival_at" timestamp with time zone NOT NULL,
	"arrival_lat" double precision,
	"arrival_lng" double precision,
	"arrival_acc" integer,
	"arrival_geo_error" text,
	"arrival_distance_m" integer,
	"finish_at" timestamp with time zone NOT NULL,
	"finish_lat" double precision,
	"finish_lng" double precision,
	"finish_acc" integer,
	"finish_geo_error" text,
	"finish_distance_m" integer,
	"duration_minutes" integer NOT NULL,
	"task" text NOT NULL,
	"work_report" text NOT NULL,
	"materials" text DEFAULT '' NOT NULL,
	"work_status" "work_status" NOT NULL,
	"customer_rep" text DEFAULT '' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_sent_at" timestamp with time zone,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_reasons" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"author_id" integer,
	"type" "event_type" NOT NULL,
	"from_value" text,
	"to_value" text,
	"text" text,
	"report_id" text
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"city_id" integer NOT NULL,
	"object_id" integer NOT NULL,
	"address" text NOT NULL,
	"description" text NOT NULL,
	"priority_id" integer NOT NULL,
	"assignee_id" integer,
	"planned_date" date,
	"contact" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" "ticket_status" DEFAULT 'new' NOT NULL,
	"is_unplanned" boolean DEFAULT false NOT NULL,
	"author_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_visit_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancel_reason" text,
	"report_count" integer DEFAULT 0 NOT NULL,
	"total_minutes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_object_device_id_object_devices_id_fk" FOREIGN KEY ("object_device_id") REFERENCES "public"."object_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_employees_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_devices" ADD CONSTRAINT "object_devices_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_devices" ADD CONSTRAINT "object_devices_last_report_id_reports_id_fk" FOREIGN KEY ("last_report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_author_id_employees_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_devices" ADD CONSTRAINT "report_devices_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_author_id_employees_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_priority_id_priorities_id_fk" FOREIGN KEY ("priority_id") REFERENCES "public"."priorities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_employees_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_author_id_employees_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cities_name_key_uq" ON "cities" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "cities_code_uq" ON "cities" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "device_actions_name_uq" ON "device_actions" USING btree ("name");--> statement-breakpoint
CREATE INDEX "device_events_object_idx" ON "device_events" USING btree ("object_id","at");--> statement-breakpoint
CREATE INDEX "device_events_ip_idx" ON "device_events" USING btree ("ip");--> statement-breakpoint
CREATE UNIQUE INDEX "device_types_name_uq" ON "device_types" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_email_uq" ON "employees" USING btree ("email");--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_key");--> statement-breakpoint
CREATE INDEX "files_report_idx" ON "files" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "files_ticket_idx" ON "files" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "object_devices_active_ip_uq" ON "object_devices" USING btree ("object_id","ip") WHERE "object_devices"."active";--> statement-breakpoint
CREATE INDEX "object_devices_ip_idx" ON "object_devices" USING btree ("ip");--> statement-breakpoint
CREATE UNIQUE INDEX "objects_name_key_uq" ON "objects" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "priorities_name_uq" ON "priorities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "report_comments_report_idx" ON "report_comments" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "report_devices_report_idx" ON "report_devices" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "report_devices_ip_idx" ON "report_devices" USING btree ("ip");--> statement-breakpoint
CREATE INDEX "report_devices_old_ip_idx" ON "report_devices" USING btree ("old_ip");--> statement-breakpoint
CREATE INDEX "reports_ticket_idx" ON "reports" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "reports_employee_idx" ON "reports" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "sessions_employee_idx" ON "sessions" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_idx" ON "ticket_events" USING btree ("ticket_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_number_uq" ON "tickets" USING btree ("number");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tickets_assignee_idx" ON "tickets" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "tickets_object_idx" ON "tickets" USING btree ("object_id");