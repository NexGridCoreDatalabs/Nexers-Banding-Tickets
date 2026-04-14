-- RetiFlux™ — WhatsApp report recipients
-- Migration 027: stores phone numbers that receive production reports.
-- Numbers are in Twilio format: whatsapp:+254XXXXXXXXX

CREATE TABLE IF NOT EXISTS whatsapp_recipients (
  id            serial PRIMARY KEY,
  name          text        NOT NULL,
  phone         text        NOT NULL UNIQUE,  -- e.g. whatsapp:+254712345678
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE whatsapp_recipients IS 'Phone numbers that receive hourly + end-of-shift WhatsApp production reports via Twilio';

-- Seed: the first recipient comes from the Supabase secret WHATSAPP_RECIPIENT_1.
-- Add rows here or via SQL when onboarding more recipients.
-- Example:
-- INSERT INTO whatsapp_recipients (name, phone) VALUES ('Manager', 'whatsapp:+254712345678');
