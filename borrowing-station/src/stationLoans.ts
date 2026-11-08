import { getPendingLoans, queueLoan, removePendingLoan, type PendingLoan } from "./stationDb";

type LoanResponse = { loan_id: string; student_id: string };
type LoanItemResponse = { item_copy_id: string; due_at: string };

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 24)}`;
}

export function makeLoan(studentId: string, itemCopyIds: string[], photoDataUrl: string): PendingLoan {
  return {
    loan_id: newId("L"),
    student_id: studentId,
    photo_path: photoDataUrl,
    items: itemCopyIds.map((item_copy_id) => ({ loan_item_id: newId("LI"), item_copy_id })),
  };
}

async function sendLoan(loan: PendingLoan, removeOnClientError = false): Promise<"sent" | "queued"> {
  let response: Response;
  try {
    response = await fetch("/api/loans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loan),
    });
  } catch {
    return "queued";
  }

  if (response.status === 409) {
    try {
      const existing = await fetch(`/api/loans/${encodeURIComponent(loan.loan_id)}`);
      if (existing.ok) {
        const record = await existing.json() as LoanResponse;
        if (record.student_id === loan.student_id) {
          await removePendingLoan(loan.loan_id);
          return "sent";
        }
      }
    } catch {
      return "queued";
    }
  }
  if (response.ok) {
    await removePendingLoan(loan.loan_id);
    return "sent";
  }
  if (response.status >= 500) return "queued";
  if (removeOnClientError) await removePendingLoan(loan.loan_id);
  let detail = `Request rejected (${response.status})`;
  try {
    const body = await response.json() as { detail?: string };
    if (typeof body.detail === "string") detail = body.detail;
  } catch { /* Use the HTTP status above. */ }
  throw new Error(detail);
}

export async function submitLoan(loan: PendingLoan): Promise<{
  state: "sent" | "queued";
  dueDates: LoanItemResponse[];
}> {
  await queueLoan(loan);
  const state = await sendLoan(loan, true);
  if (state === "queued") return { state, dueDates: [] };
  try {
    const response = await fetch(`/api/loans/${encodeURIComponent(loan.loan_id)}/items`);
    if (response.ok) return { state, dueDates: await response.json() as LoanItemResponse[] };
  } catch { /* The loan is saved even if the due-date request fails. */ }
  return { state, dueDates: [] };
}

export async function syncPendingLoans(): Promise<void> {
  for (const loan of await getPendingLoans()) {
    try { await sendLoan(loan); } catch { /* Keep processing other pending loans. */ }
  }
}
