// js/recorder-worklet.js — AudioWorkletProcessor: envía bloques de audio crudo
// al hilo principal (stream contiguo, sin solapes). Soportado iOS Safari 14.5+.
class RingRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(1024); // acumula ~21ms por mensaje
    this._n = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const ch = input[0];
      for (let i = 0; i < ch.length; i++) {
        this._buf[this._n++] = ch[i];
        if (this._n === this._buf.length) {
          this.port.postMessage(this._buf.slice(0));
          this._n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('ring-recorder', RingRecorder);