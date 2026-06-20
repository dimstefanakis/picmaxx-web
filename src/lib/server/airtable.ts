import { requiredEnv } from "@/lib/server/env";

const DEFAULT_AIRTABLE_BASE_ID = "apptoTG8pT2MzzdiM";

type AirtableFieldValue = string | number | boolean | null;
type AirtableFields = Record<string, AirtableFieldValue>;

export type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

function airtableBaseId() {
  return process.env.AIRTABLE_BASE_ID ?? DEFAULT_AIRTABLE_BASE_ID;
}

function paidTestsTableId() {
  return requiredEnv("AIRTABLE_PAID_TESTS_TABLE_ID");
}

function airtableKey() {
  return requiredEnv("AIRTABLE_SECRET_KEY");
}

function truncate(value: string, maxLength = 4000) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

async function airtableRequest<T>(path: string, init: RequestInit) {
  const response = await fetch(
    `https://api.airtable.com/v0/${airtableBaseId()}/${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${airtableKey()}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    },
  );
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      `Airtable ${response.status}: ${truncate(JSON.stringify(data ?? text))}`,
    );
  }

  return data as T;
}

export async function createPaidTestRecord(fields: AirtableFields) {
  return airtableRequest<AirtableRecord>(paidTestsTableId(), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}

export async function updatePaidTestRecord(
  recordId: string,
  fields: AirtableFields,
) {
  return airtableRequest<AirtableRecord>(`${paidTestsTableId()}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

function formulaString(value: string) {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export async function findPaidTestByOrderId(orderId: string) {
  const params = new URLSearchParams({
    maxRecords: "1",
    filterByFormula: `{Order ID}=${formulaString(orderId)}`,
  });
  const data = await airtableRequest<{ records: AirtableRecord[] }>(
    `${paidTestsTableId()}?${params.toString()}`,
    { method: "GET" },
  );

  return data.records[0] ?? null;
}

export async function updatePaidTestByOrderId(
  orderId: string,
  fields: AirtableFields,
) {
  const record = await findPaidTestByOrderId(orderId);
  if (!record) {
    throw new Error(`Order not found: ${orderId}`);
  }

  return updatePaidTestRecord(record.id, fields);
}
