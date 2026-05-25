import { afterEach, describe, expect, it, vi } from 'vitest';
import open from 'open';
import { STANDALONE_NATIVE } from '../standalone-native';

vi.mock('open', () => ({ default: vi.fn() }));
const mockedOpen = vi.mocked(open);

afterEach(() => {
  vi.clearAllMocks();
});

describe('STANDALONE_NATIVE.openExternal', () => {
  it('rejects a non-http(s) url and does not call open', async () => {
    const res = await STANDALONE_NATIVE.openExternal({ url: 'file:///etc/passwd' });
    expect(res).toEqual({
      ok: false,
      error: { code: 'bad-request', method: 'openExternal', message: 'only http(s) urls allowed' },
    });
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('rejects an unparseable url and does not call open', async () => {
    const res = await STANDALONE_NATIVE.openExternal({ url: 'not a url' });
    expect(res).toEqual({
      ok: false,
      error: { code: 'bad-request', method: 'openExternal', message: 'invalid url' },
    });
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('rejects a missing url and does not call open', async () => {
    const res = await STANDALONE_NATIVE.openExternal({});
    expect(res).toEqual({
      ok: false,
      error: { code: 'bad-request', method: 'openExternal', message: 'missing url' },
    });
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('opens an http(s) url exactly once', async () => {
    const res = await STANDALONE_NATIVE.openExternal({ url: 'https://example.com' });
    expect(res).toEqual({ ok: true, data: { ok: true } });
    expect(mockedOpen).toHaveBeenCalledTimes(1);
    expect(mockedOpen).toHaveBeenCalledWith('https://example.com/');
  });
});
