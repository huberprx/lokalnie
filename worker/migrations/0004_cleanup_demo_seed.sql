-- Usuń historyczny seed demonstracyjny z baz, które zastosowały starą migrację 0002.
DELETE FROM idempotency_keys WHERE scope LIKE 'user-demo-hubert:%';
DELETE FROM bookings WHERE id = 'bk-demo-1' OR provider_id = 'provider-demo-gb';
DELETE FROM booking_requests WHERE id = 'rq-demo-1' OR provider_id = 'provider-demo-gb';
DELETE FROM provider_clients
  WHERE id IN ('pc-demo-anna', 'pc-demo-tomasz') OR provider_id = 'provider-demo-gb';
DELETE FROM provider_profiles WHERE id = 'provider-demo-gb' OR user_id = 'user-demo-hubert';
DELETE FROM users WHERE id = 'user-demo-hubert';
