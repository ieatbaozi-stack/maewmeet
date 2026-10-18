"use client";

import { Icon } from "@/components/icons/Icon";

export interface SelectFieldProps<V extends string | number> {
  id: string;
  label: string;
  value: V;
  options: readonly { value: V; label: string }[];
  onChange: (v: V) => void;
  disabled?: boolean;
}

/** ช่องเลือกแบบ native <select> (คีย์บอร์ด/screen reader/ตัวเลือกของมือถือทำงานเอง) หุ้มด้วยกรอบ .input เหมือนช่องอื่น */
export function SelectField<V extends string | number>({ id, label, value, options, onChange, disabled }: SelectFieldProps<V>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input select">
        <select
          id={id}
          className="input-bare select-bare"
          value={String(value)}
          disabled={disabled}
          onChange={(e) => {
            const picked = options.find((o) => String(o.value) === e.target.value);
            if (picked) onChange(picked.value);
          }}
        >
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" />
      </div>
    </div>
  );
}
