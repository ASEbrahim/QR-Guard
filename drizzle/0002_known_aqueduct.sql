CREATE TABLE "warning_email_log" (
	"course_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"crossed_below_at" timestamp with time zone NOT NULL,
	"recovered_above_at" timestamp with time zone,
	CONSTRAINT "warning_email_log_course_id_student_id_crossed_below_at_pk" PRIMARY KEY("course_id","student_id","crossed_below_at")
);
--> statement-breakpoint
ALTER TABLE "warning_email_log" ADD CONSTRAINT "warning_email_log_course_id_courses_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("course_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warning_email_log" ADD CONSTRAINT "warning_email_log_student_id_students_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("user_id") ON DELETE cascade ON UPDATE no action;