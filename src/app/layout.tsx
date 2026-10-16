import type { ReactNode } from "react";
import "./globals.css";

// Placeholder จาก scaffold — Front-end (#6) จะเขียนทับทั้งไฟล์
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
