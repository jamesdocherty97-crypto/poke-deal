-- Track business operating costs alongside sales so P&L can show net profit.
CREATE TYPE "ExpenseCategory" AS ENUM (
  'SUPPLIES',
  'POSTAGE',
  'GRADING',
  'TABLE_FEE',
  'TRAVEL',
  'PLATFORM',
  'OTHER'
);

CREATE TABLE "Expense" (
  "id" TEXT NOT NULL,
  "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
  "description" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "spentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "channel" "Channel",
  "source" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Expense_spentAt_idx" ON "Expense"("spentAt");
CREATE INDEX "Expense_category_idx" ON "Expense"("category");
