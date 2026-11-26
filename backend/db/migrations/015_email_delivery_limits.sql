CREATE TABLE public.email_delivery_limits (
  id smallint PRIMARY KEY CHECK (id = 1),
  next_send_at timestamptz NOT NULL DEFAULT now(),
  recipient_day date NOT NULL DEFAULT CURRENT_DATE,
  recipients_reserved integer NOT NULL DEFAULT 0 CHECK (recipients_reserved >= 0)
);

INSERT INTO public.email_delivery_limits (id) VALUES (1);
