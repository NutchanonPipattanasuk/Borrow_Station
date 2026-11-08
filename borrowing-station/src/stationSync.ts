import { removeStudentsNotIn, saveItemCopy, saveStudent, type ItemCopyStatus, type StudentStatus } from "./stationDb";

type ApiStudent = {
  nfc_uid: string;
  student_id: string;
  first_name: string;
  last_name: string;
  status: StudentStatus;
};

type ApiItemCopy = {
  nfc_uid: string;
  item_copy_id: string;
  item_id: string;
  status: ItemCopyStatus;
};

type ApiItem = {
  item_id: string;
  name: string;
  item_type: string;
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`);
  if (!response.ok) {
    throw new Error(`API returned ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function findOnlineStudent(uid: string): Promise<ApiStudent | undefined> {
  const students = await getJson<ApiStudent[]>("/students");
  const student = students.find((record) => record.nfc_uid.toUpperCase() === uid.toUpperCase());
  if (student) {
    try {
      await saveStudent({
        uid: student.nfc_uid.toUpperCase(),
        student_id: student.student_id,
        status: student.status,
        cached_at: new Date().toISOString(),
      });
    } catch {
      // Online verification still works if the browser cannot update its cache.
    }
  }
  return student;
}

export async function findOnlineItemCopy(uid: string): Promise<{
  item_copy_id: string;
  name: string;
  item_type: string;
  status: ItemCopyStatus;
} | undefined> {
  const copies = await getJson<ApiItemCopy[]>("/item-copies");
  const copy = copies.find((record) => record.nfc_uid.toUpperCase() === uid.toUpperCase());
  if (!copy) return undefined;
  const items = await getJson<ApiItem[]>("/items");
  const item = items.find((record) => record.item_id === copy.item_id);
  return {
    item_copy_id: copy.item_copy_id,
    name: item?.name ?? copy.item_copy_id,
    item_type: item?.item_type ?? "ITEM",
    status: copy.status,
  };
}

export async function syncReferenceData(): Promise<{ students: number; itemCopies: number }> {
  const [students, itemCopies] = await Promise.all([
    getJson<ApiStudent[]>("/students"),
    getJson<ApiItemCopy[]>("/item-copies"),
  ]);
  const cachedAt = new Date().toISOString();

  await Promise.all([
    ...students.map((student) =>
      saveStudent({
        uid: student.nfc_uid.toUpperCase(),
        student_id: student.student_id,
        status: student.status,
        cached_at: cachedAt,
      }),
    ),
    ...itemCopies.map((copy) =>
      saveItemCopy({
        uid: copy.nfc_uid.toUpperCase(),
        item_copy_id: copy.item_copy_id,
        status: copy.status,
        cached_at: cachedAt,
      }),
    ),
  ]);

  await removeStudentsNotIn(new Set(students.map((student) => student.nfc_uid.toUpperCase())));

  return { students: students.length, itemCopies: itemCopies.length };
}
