ALTER TYPE "public"."relationship_type" ADD VALUE IF NOT EXISTS 'cousin' BEFORE 'relative';--> statement-breakpoint
ALTER TYPE "public"."relationship_type" ADD VALUE IF NOT EXISTS 'uncle' BEFORE 'relative';--> statement-breakpoint
ALTER TYPE "public"."relationship_type" ADD VALUE IF NOT EXISTS 'nephew' BEFORE 'relative';--> statement-breakpoint
ALTER TYPE "public"."relationship_type" ADD VALUE IF NOT EXISTS 'sibling_in_law' BEFORE 'relative';--> statement-breakpoint
ALTER TYPE "public"."relationship_type" ADD VALUE IF NOT EXISTS 'parent_in_law' BEFORE 'relative';--> statement-breakpoint
ALTER TYPE "public"."relationship_type" ADD VALUE IF NOT EXISTS 'child_in_law' BEFORE 'relative';
