import { openDB, type DBSchema } from "idb";

export type StudentStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED";
export type ItemCopyStatus = "AVAILABLE" | "BORROWED" | "MAINTENANCE";

export type CachedStudent = {
  uid: string;
  student_id: string;
  status: StudentStatus;
  cached_at: string;
};

export type CachedItemCopy = {
  uid: string;
  item_copy_id: string;
  status: ItemCopyStatus;
  cached_at: string;
};

export type PendingLoan = {
  loan_id: string;
  student_id: string;
  items: { loan_item_id: string; item_copy_id: string }[];
  photo_path: string;
};

interface StationDbSchema extends DBSchema {
  students: { key: string; value: CachedStudent };
  item_copies: { key: string; value: CachedItemCopy };
  pending_loans: { key: string; value: PendingLoan };
}

const database = openDB<StationDbSchema>("smart-lending-borrow-station-v1", 1, {
  upgrade(db) {
    db.createObjectStore("students", { keyPath: "uid" });
    db.createObjectStore("item_copies", { keyPath: "uid" });
    db.createObjectStore("pending_loans", { keyPath: "loan_id" });
  },
});

export async function initializeStationDb(): Promise<void> {
  await database;
}

export async function saveStudent(student: CachedStudent): Promise<void> {
  await (await database).put("students", student);
}

export async function getStudent(uid: string): Promise<CachedStudent | undefined> {
  return (await database).get("students", uid);
}

export async function removeStudentsNotIn(validUids: ReadonlySet<string>): Promise<void> {
  const db = await database;
  const cachedUids = await db.getAllKeys("students");
  await Promise.all(cachedUids
    .filter((uid) => !validUids.has(uid.toUpperCase()))
    .map((uid) => db.delete("students", uid)));
}

export async function saveItemCopy(copy: CachedItemCopy): Promise<void> {
  await (await database).put("item_copies", copy);
}

export async function getItemCopy(uid: string): Promise<CachedItemCopy | undefined> {
  return (await database).get("item_copies", uid);
}

export async function queueLoan(loan: PendingLoan): Promise<void> {
  await (await database).add("pending_loans", loan);
}

export async function getPendingLoans(): Promise<PendingLoan[]> {
  return (await database).getAll("pending_loans");
}

export async function removePendingLoan(loanId: string): Promise<void> {
  await (await database).delete("pending_loans", loanId);
}
