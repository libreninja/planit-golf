-- Add full_cost_cents and prize_fund_cents columns to trips table

ALTER TABLE trips 
ADD COLUMN IF NOT EXISTS full_cost_cents int,
ADD COLUMN IF NOT EXISTS prize_fund_cents int;

