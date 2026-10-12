import { describe, it, expect, vi, afterEach } from 'vitest';
import { isOfflineResponse, registerSW, hasPendingUpdate } from '../src/lib/pwa';

describe('isOfflineResponse', () => {
  it('true when X-Jelajah-Offline is "1"', () => {
    const headers = new Headers({ 'X-Jelajah-Offline': '1' });
    expect(isOfflineResponse(headers)).toBe(true);
  });

  it('false when the header is absent', () => {
    const headers = new Headers();
    expect(isOfflineResponse(headers)).toBe(false);
  });

  it('false when the header has some other value', () => {
    const headers = new Headers({ 'X-Jelajah-Offline': '0' });
    expect(isOfflineResponse(headers)).toBe(false);
  });

  it('works against a plain {get} shape, not just a real Headers instance', () => {
    const fake = { get: (n: string) => (n === 'X-Jelajah-Offline' ? '1' : null) };
    expect(isOfflineResponse(fake)).toBe(true);
  });
});


afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
it('retains update availability for late-mounted banners and rechecks visible tabs', async () => {
  vi.stubEnv('PROD', true); vi.useFakeTimers();
  const registration = Object.assign(new EventTarget(), {waiting:{},update:vi.fn(async()=>{})});
  const register=vi.fn(async()=>registration);
  const doc=Object.assign(new EventTarget(),{visibilityState:'visible'});
  vi.stubGlobal('navigator',{serviceWorker:{register,controller:{}}});
  vi.stubGlobal('window',new EventTarget()); vi.stubGlobal('document',doc);
  const notify=vi.fn(); registerSW(notify);
  await Promise.resolve();
  expect(register).toHaveBeenCalledWith('/sw.js',{updateViaCache:'none'});
  expect(notify).toHaveBeenCalledOnce(); expect(hasPendingUpdate()).toBe(true);
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(registration.update).toHaveBeenCalledTimes(2);
  doc.visibilityState='hidden';
  await vi.advanceTimersByTimeAsync(300000);
  expect(registration.update).toHaveBeenCalledTimes(2);
});
