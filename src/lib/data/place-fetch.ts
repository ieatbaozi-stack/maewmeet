// ตัวเรียกเครือข่ายของ proxy ค้นหาสถานที่ — แยกไว้เพื่อ inject ในเทสต์ (เทสต์ห้ามยิง Nominatim จริง · R4B-6)
// ค่าเริ่มต้น = fetch ของ runtime · เทสต์เรียก setPlaceFetch(mock) / resetPlaceFetch()
export type PlaceFetch = (url: string, init: RequestInit) => Promise<Response>;

let override: PlaceFetch | null = null;

export function setPlaceFetch(fn: PlaceFetch): void {
  override = fn;
}

export function resetPlaceFetch(): void {
  override = null;
}

export function getPlaceFetch(): PlaceFetch {
  return override ?? ((url, init) => fetch(url, init));
}
