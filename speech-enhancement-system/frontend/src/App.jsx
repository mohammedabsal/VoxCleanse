import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from './components/ControlPanel';
import TranscriptPanel from './components/TranscriptPanel';
import AudioStreamer from './services/audioStreamer';
import WebSocketService from './services/websocketService';

const API_BASE = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000/ws/audio';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [originalTranscript, setOriginalTranscript] = useState('');
  const [refinedTranscript, setRefinedTranscript] = useState('');
  const [customFilters, setCustomFilters] = useState({});
  const [downloadLinks, setDownloadLinks] = useState({ audio: '', transcript: '' });
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [inputDevices, setInputDevices] = useState([]);
  const [selectedInputDevice, setSelectedInputDevice] = useState('');

  const wsRef = useRef(null);
  const audioStreamerRef = useRef(null);
  const audioPlaybackContextRef = useRef(null);

  const handleWsMessage = useCallback((message) => {
    if (message.type === 'session_started') {
      setSessionId(message.session_id);
      setConnectionStatus('connected');
      return;
    }

    if (message.type === 'processed') {
      if (message.original_text) {
        setOriginalTranscript((prev) => `${prev} ${message.original_text}`.trim());
      }

      if (message.refined_text) {
        setRefinedTranscript((prev) => `${prev} ${message.refined_text}`.trim());
      }

      // Optional: play cleaned audio chunk
      if (message.cleaned_audio && message.cleaned_audio.length > 0) {
        playAudioChunk(new Float32Array(message.cleaned_audio));
      }
      return;
    }

    if (message.type === 'session_ended') {
      setDownloadLinks({
        audio: `${API_BASE}${message.download_urls.audio}`,
        transcript: `${API_BASE}${message.download_urls.transcript}`,
      });
      setConnectionStatus('disconnected');
      return;
    }

    if (message.type === 'error') {
      setError(message.message || 'Unknown WebSocket error');
    }
  }, []);

  const handleWsError = useCallback(() => {
    setError('WebSocket connection error');
    setConnectionStatus('error');
  }, []);

  const handleWsClose = useCallback(() => {
    setConnectionStatus('disconnected');
  }, []);

  const connectWebSocket = useCallback(async () => {
    setConnectionStatus('connecting');
    const wsService = new WebSocketService(WS_URL, handleWsMessage, handleWsError, handleWsClose);
    await wsService.connect();
    wsRef.current = wsService;

    // Send current custom filters
    if (Object.keys(customFilters).length > 0) {
      wsService.sendConfig(customFilters);
    }

    return wsService;
  }, [customFilters, handleWsClose, handleWsError, handleWsMessage]);

  const playAudioChunk = (audioChunk) => {
    try {
      if (!audioPlaybackContextRef.current) {
        audioPlaybackContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }

      const context = audioPlaybackContextRef.current;
      const buffer = context.createBuffer(1, audioChunk.length, 16000);
      buffer.copyToChannel(audioChunk, 0);

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start();
    } catch (e) {
      // Ignore playback errors to avoid interrupting processing
      console.warn('Audio playback warning:', e);
    }
  };

  const startRecording = async () => {
    try {
      setError('');
      setOriginalTranscript('');
      setRefinedTranscript('');
      setDownloadLinks({ audio: '', transcript: '' });

      const wsService = await connectWebSocket();

      const streamer = new AudioStreamer((audioChunk) => {
        if (wsService.isConnected()) {
          wsService.sendAudioChunk(audioChunk, 16000);
        }
      });

      await streamer.start(selectedInputDevice);
      audioStreamerRef.current = streamer;
      setIsRecording(true);

      // Refresh labels after mic permission is granted.
      const devices = await AudioStreamer.getInputDevices();
      setInputDevices(devices);
    } catch (e) {
      setError(`Failed to start recording: ${e.message}`);
      setIsRecording(false);
      setConnectionStatus('error');
    }
  };

  const stopRecording = () => {
    try {
      if (audioStreamerRef.current) {
        audioStreamerRef.current.stop();
        audioStreamerRef.current = null;
      }

      if (wsRef.current && wsRef.current.isConnected()) {
        wsRef.current.endSession();
        // Keep WS open briefly to receive final message
        setTimeout(() => {
          if (wsRef.current) {
            wsRef.current.disconnect();
            wsRef.current = null;
          }
        }, 1000);
      }

      setIsRecording(false);
    } catch (e) {
      setError(`Failed to stop recording: ${e.message}`);
    }
  };

  const handleUpdateFilter = (word, replacement) => {
    const updated = {
      ...customFilters,
      [word]: replacement,
    };

    setCustomFilters(updated);

    if (wsRef.current && wsRef.current.isConnected()) {
      wsRef.current.sendConfig(updated);
    }
  };

  const handleRemoveFilter = (word) => {
    const updated = { ...customFilters };
    delete updated[word];
    setCustomFilters(updated);

    if (wsRef.current && wsRef.current.isConnected()) {
      wsRef.current.sendConfig(updated);
    }
  };

  const handleFileUpload = async (file) => {
    setIsUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();

      setSessionId(result.session_id);
      setOriginalTranscript(result.original_transcript || '');
      setRefinedTranscript(result.refined_transcript || '');
      setDownloadLinks({
        audio: `${API_BASE}${result.download_urls.audio}`,
        transcript: `${API_BASE}${result.download_urls.transcript}`,
      });
    } catch (e) {
      setError(`File upload error: ${e.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    AudioStreamer.getInputDevices()
      .then((devices) => setInputDevices(devices))
      .catch(() => setInputDevices([]));

    return () => {
      if (audioStreamerRef.current) {
        audioStreamerRef.current.stop();
      }
      if (wsRef.current) {
        wsRef.current.disconnect();
      }
      if (audioPlaybackContextRef.current) {
        audioPlaybackContextRef.current.close();
      }
    };
  }, []);

  const statusLabel = useMemo(() => {
    if (isUploading) return 'Processing uploaded file...';
    return `Status: ${connectionStatus}`;
  }, [connectionStatus, isUploading]);

  return (
    <div className="app-shell">
      <div className="ambient-bg" />
      <header className="hero">
        <p className="eyebrow">AI Speech Enhancement Suite</p>
        <h1>Real-Time Voice Cleanup and Transcript Refinement</h1>
        <p className="subtitle">
          DeepFilterNet denoising + Whisper transcription + professional language polishing
        </p>
        <div className="status-chip">{statusLabel}</div>
      </header>

      <main className="grid-layout">
        <section className="left-column card">
          <ControlPanel
            isRecording={isRecording}
            onStart={startRecording}
            onStop={stopRecording}
            inputDevices={inputDevices}
            selectedInputDevice={selectedInputDevice}
            onSelectInputDevice={setSelectedInputDevice}
            customFilters={customFilters}
            onUpdateFilter={handleUpdateFilter}
            onRemoveFilter={handleRemoveFilter}
            onFileUpload={handleFileUpload}
          />

          {downloadLinks.audio && (
            <div className="downloads">
              <h4>Download Outputs</h4>
              <a href={downloadLinks.audio} className="download-link">Download Cleaned Audio (.wav)</a>
              <a href={downloadLinks.transcript} className="download-link">Download Refined Transcript (.txt)</a>
            </div>
          )}

          {sessionId && <p className="session-id">Session: {sessionId}</p>}
          {error && <p className="error-text">{error}</p>}
        </section>

        <section className="right-column">
          <TranscriptPanel
            title="Original Transcript"
            text={originalTranscript}
            variant="original"
          />
          <TranscriptPanel
            title="Refined Transcript"
            text={refinedTranscript}
            variant="refined"
          />
        </section>
      </main>
    </div>
  );
}

export default App;
