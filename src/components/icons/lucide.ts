// เส้นทางไอคอน Lucide (lucide-static 1.57.0, ISC) คัดลอกจาก docs/design/tools/lucide-icons.json — ชุดเดียวทั้งแอป
// เพิ่มไอคอน: คัดลอก path จากไฟล์นั้นเท่านั้น (ห้ามผสมชุด — UI_DIRECTION §3)

export type IconNode = readonly [tag: "path" | "circle" | "rect" | "line", attrs: Readonly<Record<string, string>>];

export const ICONS = {
  "house": [["path", {"d": "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"}], ["path", {"d": "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"}]],
  "calendar": [["path", {"d": "M8 2v3"}], ["path", {"d": "M16 2v3"}], ["rect", {"x": "3", "y": "3", "width": "18", "height": "18", "rx": "2"}], ["path", {"d": "M3 9h18"}]],
  "users": [["path", {"d": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}], ["path", {"d": "M16 3.128a4 4 0 0 1 0 7.744"}], ["path", {"d": "M22 21v-2a4 4 0 0 0-3-3.87"}], ["circle", {"cx": "9", "cy": "7", "r": "4"}]],
  "user": [["path", {"d": "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"}], ["circle", {"cx": "12", "cy": "7", "r": "4"}]],
  "delete": [["path", {"d": "M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"}], ["path", {"d": "m12 9 6 6"}], ["path", {"d": "m18 9-6 6"}]],
  "sun": [["circle", {"cx": "12", "cy": "12", "r": "4"}], ["path", {"d": "M12 2v2"}], ["path", {"d": "M12 20v2"}], ["path", {"d": "m4.93 4.93 1.41 1.41"}], ["path", {"d": "m17.66 17.66 1.41 1.41"}], ["path", {"d": "M2 12h2"}], ["path", {"d": "M20 12h2"}], ["path", {"d": "m6.34 17.66-1.41 1.41"}], ["path", {"d": "m19.07 4.93-1.41 1.41"}]],
  "moon": [["path", {"d": "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]],
  "circle-alert": [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["line", {"x1": "12", "x2": "12", "y1": "8", "y2": "12"}], ["line", {"x1": "12", "x2": "12.01", "y1": "16", "y2": "16"}]],
  "refresh-cw": [["path", {"d": "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}], ["path", {"d": "M21 3v5h-5"}], ["path", {"d": "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}], ["path", {"d": "M8 16H3v5"}]],
} as const satisfies Record<string, readonly IconNode[]>;

export type IconName = keyof typeof ICONS;
