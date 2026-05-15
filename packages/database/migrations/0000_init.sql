CREATE TABLE `pulse_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`is_unread` integer NOT NULL,
	`from_name` text,
	`from_email` text NOT NULL,
	`subject` text NOT NULL,
	`preview` text NOT NULL,
	`received_at` integer NOT NULL,
	`first_seen` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen` integer DEFAULT (unixepoch()) NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_emails_unread_received_at` ON `pulse_emails` (`is_unread`,`received_at`);--> statement-breakpoint
CREATE INDEX `idx_emails_thread_id` ON `pulse_emails` (`thread_id`);--> statement-breakpoint
CREATE TABLE `pulse_connector_cursors` (
	`connector_name` text PRIMARY KEY NOT NULL,
	`state_token` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pulse_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connector_name` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`status` text NOT NULL,
	`error_tag` text,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `idx_runs_connector_started_at` ON `pulse_runs` (`connector_name`,`started_at`);