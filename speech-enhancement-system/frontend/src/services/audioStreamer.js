class AudioStreamer {
  constructor(onAudioChunk) {
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;
    this.source = null;
    this.onAudioChunk = onAudioChunk;
    this.isRecording = false;
    this.targetSampleRate = 16000;
    this.chunkSize = 1600; // 100ms at 16kHz
    this.buffer = [];
  }

  static async getInputDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, index) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${index + 1}`,
      }));
  }

  async start(inputDeviceId = '') {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: 1,
      };

      if (inputDeviceId) {
        audioConstraints.deviceId = { exact: inputDeviceId };
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (event) => {
        if (!this.isRecording) return;

        const inputData = event.inputBuffer.getChannelData(0);
        const resampled = this.resampleAudio(inputData, this.audioContext.sampleRate, this.targetSampleRate);

        this.buffer.push(...resampled);

        // Send chunks when buffer reaches chunk size
        while (this.buffer.length >= this.chunkSize) {
          const chunk = this.buffer.splice(0, this.chunkSize);
          this.onAudioChunk(new Float32Array(chunk));
        }
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      this.isRecording = true;
      return true;
    } catch (error) {
      console.error('Failed to start audio streaming:', error);
      throw error;
    }
  }

  stop() {
    this.isRecording = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.buffer = [];
  }

  // Simple linear resampling
  resampleAudio(input, inputSampleRate, outputSampleRate) {
    if (inputSampleRate === outputSampleRate) return input;

    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i += 1) {
      const index = i * ratio;
      const indexFloor = Math.floor(index);
      const indexCeil = Math.min(indexFloor + 1, input.length - 1);
      const fraction = index - indexFloor;

      output[i] = input[indexFloor] * (1 - fraction) + input[indexCeil] * fraction;
    }

    return output;
  }
}

export default AudioStreamer;
