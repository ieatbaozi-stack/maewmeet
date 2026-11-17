// removeTempDir: กลืน EPERM/EBUSY เฉพาะ win32 · ที่อื่น/error อื่น → throw · ลองซ้ำจริง (ส่ง maxRetries ให้ Node)
import { describe, expect, it, vi } from 'vitest';
import type { rmSync } from 'node:fs';
import { _resetRemoveTempDirWarning, removeTempDir } from './fs';

const failing = (code: string) =>
  vi.fn(() => {
    throw Object.assign(new Error(code), { code });
  }) as unknown as typeof rmSync;

describe('removeTempDir', () => {
  it('ส่ง maxRetries/retryDelay และ recursive+force ให้ rmSync', () => {
    const rm = vi.fn() as unknown as typeof rmSync;
    removeTempDir('/x', 'linux', rm);
    expect(rm).toHaveBeenCalledWith('/x', expect.objectContaining({ recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
  });

  it('win32: EPERM/EBUSY ถูกกลืน และ log ครั้งเดียว', () => {
    _resetRemoveTempDirWarning();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    removeTempDir('/a', 'win32', failing('EPERM'));
    removeTempDir('/b', 'win32', failing('EBUSY'));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('linux: EPERM/EBUSY ต้อง throw (ไม่ซ่อนความล้มเหลวบน CI)', () => {
    expect(() => removeTempDir('/a', 'linux', failing('EPERM'))).toThrow('EPERM');
    expect(() => removeTempDir('/a', 'linux', failing('EBUSY'))).toThrow('EBUSY');
  });

  it('win32: error อื่น (EACCES/ENOSPC) ต้อง throw', () => {
    expect(() => removeTempDir('/a', 'win32', failing('EACCES'))).toThrow('EACCES');
    expect(() => removeTempDir('/a', 'win32', failing('ENOSPC'))).toThrow('ENOSPC');
  });
});
