class WebSocketService {
  constructor(url, onMessage, onError, onClose) {
    this.url = url;
    this.ws = null;
    this.onMessage = onMessage;
    this.onError = onError;
    this.onClose = onClose;
    this.sessionId = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          const data = JSON.parse(event.data);

          if (data.type === 'session_started') {
            this.sessionId = data.session_id;
          }

          if (this.onMessage) {
            this.onMessage(data);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          if (this.onError) this.onError(error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          if (this.onClose) this.onClose();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  sendAudioChunk(audioChunk, sampleRate = 16000) {
    if (!this.isConnected()) return;

    this.ws.send(
      JSON.stringify({
        type: 'audio_chunk',
        data: Array.from(audioChunk),
        sample_rate: sampleRate,
      })
    );
  }

  sendConfig(customFilters) {
    if (!this.isConnected()) return;

    this.ws.send(
      JSON.stringify({
        type: 'config',
        custom_filters: customFilters,
      })
    );
  }

  endSession() {
    if (!this.isConnected()) return;

    this.ws.send(
      JSON.stringify({
        type: 'end_session',
      })
    );
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export default WebSocketService;
