-- Wyłącznie lokalny seed demonstracyjny. Nigdy nie uruchamiaj na bazie zdalnej.
INSERT OR IGNORE INTO users (
  id, email, name, phone, role_client, role_provider,
  notification_booking, notification_reminder, notification_marketing
) VALUES (
  'user-demo-hubert', 'hubert@lokalnie.app', 'Hubert Z', '+48 500 100 200',
  1, 1, 1, 1, 0
);

INSERT OR IGNORE INTO provider_profiles (
  id, user_id, slug, name, category, subcategory, city, address, about,
  email, email_visible, phone, booking_mode, visible_in_search, multi_select
) VALUES (
  'provider-demo-gb', 'user-demo-hubert', 'grzesiu-barber', 'Grzesiu Barber',
  'uroda', 'barber', 'Warszawa', 'ul. Marszałkowska 12, Warszawa',
  'Męskie strzyżenia, broda i pielęgnacja w centrum Warszawy.',
  'kontakt@grzesiubarber.pl', 1, '+48 500 100 200', 'auto', 1, 1
);

INSERT OR IGNORE INTO provider_clients (
  id, provider_id, name, phone, email, address
) VALUES
  ('pc-demo-anna', 'provider-demo-gb', 'Anna Kowalska', '+48 512 345 678', 'anna.kowalska@example.com', NULL),
  ('pc-demo-tomasz', 'provider-demo-gb', 'Tomasz Nowak', '+48 601 222 333', 'tomasz.nowak@example.com', NULL);

INSERT OR IGNORE INTO bookings (
  id, provider_id, provider_client_id, client_name, client_phone, client_email,
  service_ids_json, service_names_json, date_iso, time_from, time_to,
  location_label, status
) VALUES (
  'bk-demo-1', 'provider-demo-gb', 'pc-demo-anna', 'Anna Kowalska',
  '+48 512 345 678', 'anna.kowalska@example.com',
  '["svc-gb-1"]', '["Strzyżenie męskie"]', '2026-07-31',
  '14:00', '14:30', 'Studio główne', 'confirmed'
);

INSERT OR IGNORE INTO booking_requests (
  id, provider_id, client_name, client_phone, client_email,
  service_ids_json, service_names_json, days_json, proposals_json, status
) VALUES (
  'rq-demo-1', 'provider-demo-gb', 'Magda Wiśniewska',
  '+48 725 880 114', 'magda.wisniewska@example.com',
  '["svc-gb-3"]', '["Combo: włosy + broda"]',
  '[{"dateISO":"2026-08-01","part":"am"},{"dateISO":"2026-08-02","part":"any"}]',
  '[]', 'pending'
);
