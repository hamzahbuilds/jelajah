import {afterEach, describe, expect, it, vi} from 'vitest';
import {ocrImages} from '../src/ocr';

class FakeWorker {
  static instance: FakeWorker;
  static fail = '';
  static hang = '';
  onmessage: any; onerror: any; onmessageerror: any;
  messages: any[] = [];
  terminate = vi.fn();
  constructor() { FakeWorker.instance=this; }
  postMessage(message: any) {
    this.messages.push(message);
    if (message.action === FakeWorker.hang) return;
    queueMicrotask(() => this.onmessage({data:{jobId:message.jobId,status:message.action === FakeWorker.fail ? 'reject' : 'resolve',data:message.action === FakeWorker.fail ? 'download_failed' : {text:'Booking confirmed'}}}));
  }
}
afterEach(() => {vi.unstubAllGlobals(); vi.useRealTimers(); FakeWorker.fail=''; FakeWorker.hang='';});
describe('cancellable document OCR', () => {
  it('loads local gzip packs separately from uncompressed Japanese and Chinese models', async () => {
    vi.stubGlobal('Worker',FakeWorker);
    expect(await ocrImages([new Blob(['image'])],['eng','msa','jpn','chi_sim'],()=>{})).toBe('Booking confirmed');
    const loads=FakeWorker.instance.messages.filter(m=>m.action==='loadLanguage');
    expect(loads[0].payload).toMatchObject({langs:['eng','msa'],options:{gzip:true,langPath:'/tess/lang'}});
    expect(loads[1].payload).toMatchObject({langs:['jpn','chi_sim'],options:{gzip:false}});
    expect(FakeWorker.instance.terminate).toHaveBeenCalled();
  });
  it('rejects initialization failures and terminates the worker instead of hanging', async () => {
    vi.stubGlobal('Worker',FakeWorker); FakeWorker.fail='loadLanguage';
    await expect(ocrImages([],['jpn'],()=>{})).rejects.toThrow('download_failed');
    expect(FakeWorker.instance.terminate).toHaveBeenCalled();
  });
  it('can cancel before initialization resolves', async () => {
    vi.stubGlobal('Worker',FakeWorker); FakeWorker.hang='load';
    const controller=new AbortController();
    const result=ocrImages([],['eng'],()=>{},controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({name:'AbortError'});
    expect(FakeWorker.instance.terminate).toHaveBeenCalled();
  });
  it('times out a stalled worker and permits a fresh retry', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker',FakeWorker); FakeWorker.hang='load';
    const rejected=expect(ocrImages([],['eng'],()=>{})).rejects.toThrow('ocr_timeout');
    await vi.advanceTimersByTimeAsync(90000); await rejected;
    expect(FakeWorker.instance.terminate).toHaveBeenCalled();
    FakeWorker.hang='';
    expect(await ocrImages([new Blob(['image'])],['eng'],()=>{})).toBe('Booking confirmed');
  });
});
