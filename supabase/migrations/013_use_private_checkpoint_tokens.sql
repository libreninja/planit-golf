-- Replace predictable public checkpoint slugs with unguessable QR tokens.

UPDATE public.public_pace_checkpoints
SET token = 'IQF0he_G-FXX6sTT'
WHERE token = 'interbay-checkpoint-1';

UPDATE public.public_pace_checkpoints
SET token = 'rLkzBpG0dBNQg4MX'
WHERE token = 'interbay-checkpoint-2';
