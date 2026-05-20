/**
 * AudioWorklet Processor
 * Accumulates audio samples and sends chunks to the main thread for analysis.
 * Placed in public/ so Next.js/webpack does not try to bundle it.
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 2048; // ~46ms at 44100Hz, ~43ms at 48000Hz
    this._overlapSize = 1024; // 50% overlap for smoother analysis
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channel = input[0];
      for (let i = 0; i < channel.length; i++) {
        this._buffer.push(channel[i]);
      }

      if (this._buffer.length >= this._bufferSize) {
        const chunk = new Float32Array(this._bufferSize);
        for (let i = 0; i < this._bufferSize; i++) {
          chunk[i] = this._buffer[i];
        }
        this.port.postMessage({ type: 'audioData', buffer: chunk }, [chunk.buffer]);
        // Keep the last overlapSize samples for 50% overlap
        this._buffer = this._buffer.slice(this._overlapSize);
      }
    }
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
