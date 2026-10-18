import { createElement, type ReactNode } from "react";
import type { SvgNode } from "./brand-svg.generated";

/** เรนเดอร์ต้นไม้ SVG ที่สร้างจาก public/brand (ไม่มี state — ใช้ได้ทั้ง Server/Client Component) */
export function renderSvgNodes(nodes: readonly SvgNode[], keyPrefix = ""): ReactNode[] {
  return nodes.map(([tag, attrs, children], i) =>
    createElement(
      tag,
      { key: `${keyPrefix}${i}`, ...attrs },
      children ? renderSvgNodes(children, `${keyPrefix}${i}.`) : undefined,
    ),
  );
}
