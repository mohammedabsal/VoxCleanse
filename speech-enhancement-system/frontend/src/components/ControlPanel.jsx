import React, { useState } from 'react';

function ControlPanel({
  isRecording,
  onStart,
  onStop,
  inputDevices,
  selectedInputDevice,
  onSelectInputDevice,
  customFilters,
  onUpdateFilter,
  onRemoveFilter,
  onFileUpload,
}) {
  const [word, setWord] = useState('');
  const [replacement, setReplacement] = useState('');

  const handleAddFilter = () => {
    const w = word.trim();
    if (!w) return;

    const r = replacement.trim();
    onUpdateFilter(w, r || null);
    setWord('');
    setReplacement('');
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file && onFileUpload) {
      onFileUpload(file);
    }
  };

  return (
    <div className="control-panel">
      <div className="record-controls">
        <div className="device-picker">
          <label htmlFor="input-device-select">Input device</label>
          <select
            id="input-device-select"
            value={selectedInputDevice}
            onChange={(e) => onSelectInputDevice?.(e.target.value)}
            disabled={isRecording}
          >
            <option value="">System default</option>
            {(inputDevices || []).map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </div>

        <button
          className={`btn ${isRecording ? 'danger' : 'primary'}`}
          onClick={isRecording ? onStop : onStart}
        >
          {isRecording ? 'Stop Live Processing' : 'Start Live Processing'}
        </button>
      </div>

      <div className="upload-section">
        <label htmlFor="file-upload" className="btn secondary">
          Upload Audio File
        </label>
        <input
          id="file-upload"
          type="file"
          accept=".wav,.mp3,.flac,.m4a"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>

      <div className="filter-section">
        <h4>Custom Word Filters</h4>
        <p className="hint">Add words to remove or replace. Example: bro {'>'} (empty to remove)</p>

        <div className="filter-inputs">
          <input
            type="text"
            placeholder="Word to filter"
            value={word}
            onChange={(e) => setWord(e.target.value)}
          />
          <input
            type="text"
            placeholder="Replacement (optional)"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
          />
          <button className="btn accent" onClick={handleAddFilter}>
            Add Filter
          </button>
        </div>

        <div className="filter-list">
          {Object.keys(customFilters).length === 0 ? (
            <span className="placeholder">No custom filters configured</span>
          ) : (
            Object.entries(customFilters).map(([k, v]) => (
              <div key={k} className="filter-item">
                <span>
                  <strong>{k}</strong> {'>'} {v === null ? '(removed)' : v}
                </span>
                <button className="mini-btn" onClick={() => onRemoveFilter(k)}>
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default ControlPanel;
