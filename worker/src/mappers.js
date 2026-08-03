import { parseJsonField } from "./http.js";
import { decryptPhone } from "./pii.js";

export async function mapClient(row, env) {
  if (!row) return null;
  return {
    id: row.id,
    providerId: row.provider_id,
    clientUserId: row.client_user_id,
    name: row.name,
    phone: await decryptPhone(row.phone, env),
    email: row.email,
    address: row.address,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function mapBooking(row, env) {
  if (!row) return null;
  return {
    id: row.id,
    providerId: row.provider_id,
    clientUserId: row.client_user_id,
    providerClientId: row.provider_client_id,
    clientName: row.client_name,
    clientPhone: await decryptPhone(row.client_phone, env),
    clientEmail: row.client_email,
    serviceIds: parseJsonField(row.service_ids_json, []),
    serviceNames: parseJsonField(row.service_names_json, []),
    dateISO: row.date_iso,
    from: row.time_from,
    to: row.time_to,
    locationLabel: row.location_label,
    status: row.status,
    requestId: row.request_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function mapRequest(row, env) {
  if (!row) return null;
  return {
    id: row.id,
    providerId: row.provider_id,
    clientUserId: row.client_user_id,
    clientName: row.client_name,
    clientPhone: await decryptPhone(row.client_phone, env),
    clientEmail: row.client_email,
    serviceIds: parseJsonField(row.service_ids_json, []),
    serviceNames: parseJsonField(row.service_names_json, []),
    days: parseJsonField(row.days_json, []),
    proposals: parseJsonField(row.proposals_json, []),
    acceptedProposalId: row.accepted_proposal_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapMedia(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    kind: row.kind,
    storageKey: row.storage_key,
    contentType: row.content_type,
    byteSize: row.byte_size,
    url: `/media/${row.id}`,
    createdAt: row.created_at,
  };
}
