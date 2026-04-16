ALTER TABLE "Teacher" ADD COLUMN "email" TEXT;

CREATE UNIQUE INDEX "Teacher_email_key" ON "Teacher"("email");
