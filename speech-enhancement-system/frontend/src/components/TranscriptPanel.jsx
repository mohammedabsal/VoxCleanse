import React from 'react';

function TranscriptPanel({ title, text, variant = 'original' }) {
  return (
    <div className={`transcript-panel ${variant}`}>
      <h3>{title}</h3>
      <div className="transcript-content">
        {text || <span className="placeholder">No transcript yet...</span>}
      </div>
    </div>
  );
}

export default TranscriptPanel;
